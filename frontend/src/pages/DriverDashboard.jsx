// src/pages/DriverDashboard.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { api } from '../utils/api';
import { connectSocket, getSocket } from '../utils/socket';
import RideMap from '../components/RideMap';

// Default position — center of world, will be replaced by real location
const DEFAULT_POS = { lat: 28.6139, lng: 77.2090 }; // New Delhi as neutral default

// Search any address using OpenStreetMap
async function searchLocation(query) {
  if (!query || query.length < 3) return [];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    return data.map(item => ({
      name: item.display_name,
      shortName: item.display_name.split(',').slice(0, 2).join(',').trim(),
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }));
  } catch { return []; }
}

// Simple location search component
function LocationSearch({ onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setResults([]);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    if (val.length < 3) { setResults([]); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const found = await searchLocation(val);
      setResults(found);
      setSearching(false);
    }, 400);
  };

  const handleSelect = (loc) => {
    setQuery(loc.shortName);
    setResults([]);
    onSelect(loc);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          className="input text-sm pr-8"
          placeholder="Search your current location..."
          value={query}
          onChange={handleInput}
          autoComplete="off"
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-dark-700 border border-brand-500/20 rounded-lg shadow-xl overflow-hidden">
          {results.map((r, i) => (
            <button key={i} onClick={() => handleSelect(r)}
              className="w-full text-left px-4 py-3 hover:bg-brand-500/10 transition-colors border-b border-brand-500/5 last:border-0">
              <p className="text-sm text-slate-200 truncate">{r.shortName}</p>
              <p className="text-xs text-slate-500 truncate">{r.name}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DriverDashboard() {
  const { user, token } = useAuthStore();
  const profile = user?.driverProfile;

  const [isOnline, setIsOnline]           = useState(false);
  const [currentLocation, setCurrentLocation] = useState(DEFAULT_POS);
  const [locationLabel, setLocationLabel] = useState('Location not set');
  const [locationSet, setLocationSet]     = useState(false);
  const [assignedTrip, setAssignedTrip]   = useState(null);
  const [tripState, setTripState]         = useState(null);
  const [stats, setStats]                 = useState(null);
  const [notification, setNotification]   = useState(null);
  const locationInterval = useRef(null);

  const notify = (msg, type = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 6000);
  };

  // ── Try to get real browser geolocation on mount ──
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setCurrentLocation(loc);
          setLocationLabel('Current GPS location');
          setLocationSet(true);
          notify('📍 Using your real GPS location', 'success');
        },
        () => {
          // Permission denied or unavailable — user must set manually
          notify('📍 GPS unavailable — please search your location below', 'warning');
        },
        { timeout: 5000 }
      );
    }
  }, []);

  // ── Connect socket ──
  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token);

    socket.off('trip:assigned');
    socket.off('trip:cancelled');
    socket.off('driver:status_changed');
    socket.off('trip:accepted');
    socket.off('trip:started_ack');
    socket.off('trip:completed_ack');

    socket.on('trip:assigned', (data) => {
      console.log('[Driver] trip:assigned', data);
      setAssignedTrip(data);
      setTripState('assigned');
      notify(`🔔 New trip! Pickup: ${data.pickupAddress}`, 'success');
    });

    socket.on('trip:cancelled', ({ reason }) => {
      setAssignedTrip(null);
      setTripState(null);
      notify(`Trip cancelled: ${reason || 'Rider cancelled'}`, 'warning');
    });

    socket.on('driver:status_changed', ({ status }) => {
      setIsOnline(status === 'AVAILABLE');
    });

    socket.on('trip:accepted',     () => setTripState('accepted'));
    socket.on('trip:started_ack',  () => setTripState('started'));
    socket.on('trip:completed_ack', ({ totalFare }) => {
      notify(`✅ Trip completed! Earned: $${totalFare}`, 'success');
      setAssignedTrip(null);
      setTripState(null);
      loadStats();
    });

    return () => {
      socket.off('trip:assigned');
      socket.off('trip:cancelled');
      socket.off('driver:status_changed');
      socket.off('trip:accepted');
      socket.off('trip:started_ack');
      socket.off('trip:completed_ack');
    };
  }, [token]);

  // ── Send location updates every 4s when online ──
  useEffect(() => {
    if (!isOnline) {
      clearInterval(locationInterval.current);
      return;
    }

    if (!locationSet) {
      notify('⚠️ Please set your location before going online', 'warning');
      setIsOnline(false);
      return;
    }

    const socket = getSocket();

    const sendLocation = () => {
      // Add tiny random movement to simulate driving
      const jitter = () => (Math.random() - 0.5) * 0.001;
      const newPos = {
        lat: currentLocation.lat + jitter(),
        lng: currentLocation.lng + jitter(),
      };
      setCurrentLocation(newPos);

      socket?.emit('driver:location_update', {
        lat: newPos.lat,
        lng: newPos.lng,
        speed: 20 + Math.random() * 40,
        heading: Math.random() * 360,
        name: user?.name,
        rating: user?.rating,
        vehicleModel: profile?.vehicleModel,
        vehiclePlate: profile?.vehiclePlate,
        vehicleColor: profile?.vehicleColor,
        acceptanceRate: profile?.acceptanceRate,
      });
    };

    sendLocation(); // Send immediately on going online
    locationInterval.current = setInterval(sendLocation, 4000);
    return () => clearInterval(locationInterval.current);
  }, [isOnline, locationSet]);

  const handleLocationSelect = (loc) => {
    setCurrentLocation({ lat: loc.lat, lng: loc.lng });
    setLocationLabel(loc.shortName);
    setLocationSet(true);
    notify(`📍 Location set: ${loc.shortName}`, 'success');
  };

  const toggleOnline = () => {
    if (!locationSet) {
      notify('⚠️ Please set your location first', 'warning');
      return;
    }
    const socket = getSocket();
    if (isOnline) {
      socket?.emit('driver:go_offline');
      setIsOnline(false);
      clearInterval(locationInterval.current);
    } else {
      socket?.emit('driver:go_online');
      setIsOnline(true);
    }
  };

  const acceptTrip = () => {
    const socket = getSocket();
    socket?.emit('driver:accept_trip', { tripId: assignedTrip.tripId });
    setTripState('accepted');
    notify('Trip accepted! Head to pickup location.', 'info');
  };

  const startTrip = () => {
    const socket = getSocket();
    socket?.emit('driver:start_trip', { tripId: assignedTrip.tripId });
    setTripState('started');
    notify('Trip started! Drive safely.', 'info');
  };

  const completeTrip = () => {
    const socket = getSocket();
    socket?.emit('driver:complete_trip', { tripId: assignedTrip.tripId });
  };

  const loadStats = async () => {
    try {
      const data = await api.get('/api/drivers/stats');
      setStats(data);
    } catch {}
  };

  useEffect(() => { loadStats(); }, []);

  const mapMarkers = [
    { type: 'driver', lat: currentLocation.lat, lng: currentLocation.lng, tooltip: '🚗 You are here' },
    ...(assignedTrip ? [
      { type: 'pickup',  lat: assignedTrip.pickupLat,  lng: assignedTrip.pickupLng,  tooltip: `📍 ${assignedTrip.pickupAddress}`  },
      { type: 'dropoff', lat: assignedTrip.dropoffLat, lng: assignedTrip.dropoffLng, tooltip: `🏁 ${assignedTrip.dropoffAddress}` },
    ] : []),
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 animate-fade-in">
      {notification && (
        <div className={`fixed top-16 right-4 z-50 px-5 py-3 rounded-xl font-medium text-sm shadow-xl animate-slide-up border max-w-sm ${
          notification.type === 'success' ? 'bg-brand-500/20 border-brand-500/40 text-brand-300' :
          notification.type === 'warning' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' :
          notification.type === 'error'   ? 'bg-red-500/20   border-red-500/40   text-red-300'   :
                                            'bg-blue-500/20  border-blue-500/40  text-blue-300'
        }`}>
          {notification.msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left Panel ── */}
        <div className="space-y-4">

          {/* Driver info card */}
          <div className="card">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-brand-500/15 flex items-center justify-center text-2xl border border-brand-500/20">
                🧑‍✈️
              </div>
              <div>
                <p className="font-bold text-white">{user?.name}</p>
                <p className="text-sm text-slate-400">⭐ {user?.rating?.toFixed(1)} · {profile?.vehicleModel}</p>
                <p className="text-xs font-mono text-brand-400">{profile?.vehiclePlate}</p>
              </div>
            </div>

            {/* Location setter */}
            <div className="mb-4 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-mono text-slate-400">YOUR LOCATION</label>
                {locationSet && (
                  <span className="text-xs text-brand-400 flex items-center gap-1">
                    <span className="status-dot bg-brand-400" />
                    Set
                  </span>
                )}
              </div>
              <LocationSearch onSelect={handleLocationSelect} />
              {locationSet && (
                <p className="text-xs text-slate-500 truncate">📍 {locationLabel}</p>
              )}
            </div>

            {/* Online toggle */}
            <button
              onClick={toggleOnline}
              className={`w-full py-3 rounded-lg font-bold text-sm transition-all ${
                isOnline
                  ? 'bg-brand-500/20 border-2 border-brand-500 text-brand-400'
                  : locationSet
                  ? 'bg-dark-700 border-2 border-slate-500 text-slate-300 hover:border-brand-500/50'
                  : 'bg-dark-700 border-2 border-slate-700 text-slate-600 cursor-not-allowed'
              }`}
            >
              <span className={`status-dot mr-2 ${isOnline ? 'bg-brand-400 animate-pulse' : 'bg-slate-500'}`} />
              {isOnline
                ? 'ONLINE — Available for rides'
                : locationSet
                ? 'OFFLINE — Click to go online'
                : 'Set location to go online'}
            </button>
          </div>

          {/* Assigned trip */}
          {assignedTrip && (
            <div className="card border border-brand-500/30 bg-brand-500/5 animate-slide-up">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-white">Trip Request</h3>
                <span className={`badge text-xs ${
                  tripState === 'assigned' ? 'bg-yellow-500/20 text-yellow-400' :
                  tripState === 'accepted' ? 'bg-blue-500/20 text-blue-400' :
                                            'bg-purple-500/20 text-purple-400'
                }`}>
                  {tripState === 'assigned' ? 'New!' : tripState === 'accepted' ? 'Accepted' : 'In Progress'}
                </span>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">📍</span>
                  <div>
                    <p className="text-xs text-slate-400">PICKUP</p>
                    <p className="text-sm text-slate-200">{assignedTrip.pickupAddress}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-yellow-400 mt-0.5">🏁</span>
                  <div>
                    <p className="text-xs text-slate-400">DROPOFF</p>
                    <p className="text-sm text-slate-200">{assignedTrip.dropoffAddress}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center mb-4">
                <div className="bg-dark-700 rounded-lg p-2">
                  <div className="text-brand-400 font-bold font-mono">{assignedTrip.distanceKm?.toFixed(1)}km</div>
                  <div className="text-xs text-slate-500">Distance</div>
                </div>
                <div className="bg-dark-700 rounded-lg p-2">
                  <div className="text-brand-400 font-bold font-mono">{assignedTrip.durationMin?.toFixed(0)}m</div>
                  <div className="text-xs text-slate-500">Duration</div>
                </div>
                <div className="bg-dark-700 rounded-lg p-2">
                  <div className="text-brand-400 font-bold font-mono">${assignedTrip.totalFare}</div>
                  <div className="text-xs text-slate-500">Fare</div>
                </div>
              </div>

              {tripState === 'assigned' && (
                <button onClick={acceptTrip} className="btn-primary w-full">
                  ✅ Accept Trip
                </button>
              )}
              {tripState === 'accepted' && (
                <button onClick={startTrip} className="btn-primary w-full">
                  🚀 Start Trip (Rider picked up)
                </button>
              )}
              {tripState === 'started' && (
                <button onClick={completeTrip} className="btn-primary w-full">
                  🏁 Complete Trip
                </button>
              )}
            </div>
          )}

          {/* Stats */}
          {stats && (
            <div className="card">
              <h3 className="font-bold text-white mb-3">Your Stats</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-dark-700 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-brand-400 font-mono">{stats.profile?.totalTrips || 0}</div>
                  <div className="text-xs text-slate-500">Total Trips</div>
                </div>
                <div className="bg-dark-700 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-brand-400 font-mono">${parseFloat(stats.totalEarnings || 0).toFixed(0)}</div>
                  <div className="text-xs text-slate-500">Earnings</div>
                </div>
                <div className="bg-dark-700 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-brand-400 font-mono">{((stats.profile?.acceptanceRate || 0) * 100).toFixed(0)}%</div>
                  <div className="text-xs text-slate-500">Acceptance</div>
                </div>
                <div className="bg-dark-700 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-brand-400 font-mono">⭐ {user?.rating?.toFixed(1)}</div>
                  <div className="text-xs text-slate-500">Rating</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Map ── */}
        <div className="lg:col-span-2">
          <div className="card p-0 overflow-hidden h-[600px]">
            <div className="px-4 py-3 border-b border-brand-500/10 flex items-center justify-between">
              <span className="text-sm font-mono text-slate-400">DRIVER MAP</span>
              <div className="flex items-center gap-2 text-xs">
                <span className={`status-dot ${isOnline ? 'bg-brand-400 animate-pulse' : 'bg-slate-500'}`} />
                <span className={isOnline ? 'text-brand-400' : 'text-slate-500'}>
                  {isOnline ? 'Broadcasting location every 4s' : 'Offline'}
                </span>
              </div>
            </div>
            <RideMap
              center={[currentLocation.lat, currentLocation.lng]}
              zoom={locationSet ? 13 : 4}
              markers={mapMarkers}
              className="h-[550px] w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
