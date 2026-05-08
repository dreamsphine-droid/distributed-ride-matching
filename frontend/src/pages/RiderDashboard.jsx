// src/pages/RiderDashboard.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { api } from '../utils/api';
import { connectSocket, getSocket } from '../utils/socket';
import RideMap from '../components/RideMap';

const TRIP_STATUS_LABELS = {
  REQUESTED: { label: 'Finding driver...', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  MATCHED:   { label: 'Driver matched!',   color: 'text-brand-400',  bg: 'bg-brand-400/10'  },
  PICKUP:    { label: 'Driver en route',   color: 'text-blue-400',   bg: 'bg-blue-400/10'   },
  IN_PROGRESS:{ label: 'On the way',       color: 'text-purple-400', bg: 'bg-purple-400/10' },
  COMPLETED: { label: 'Trip complete',     color: 'text-brand-400',  bg: 'bg-brand-400/10'  },
  CANCELLED: { label: 'Cancelled',         color: 'text-red-400',    bg: 'bg-red-400/10'    },
};

// Search any address worldwide using OpenStreetMap Nominatim (free, no API key)
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

function LocationSearchInput({ label, value, onChange, placeholder }) {
  const [query, setQuery] = useState(value?.shortName || '');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    setOpen(true);
    clearTimeout(debounceRef.current);
    if (val.length < 3) { setResults([]); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const found = await searchLocation(val);
      setResults(found);
      setSearching(false);
    }, 400);
  };

  const handleSelect = (location) => {
    setQuery(location.shortName);
    setResults([]);
    setOpen(false);
    onChange(location);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <label className="text-xs font-mono text-slate-400 mb-1.5 block">{label}</label>
      <div className="relative">
        <input
          className="input pr-8"
          placeholder={placeholder}
          value={query}
          onChange={handleInput}
          onFocus={() => results.length > 0 && setOpen(true)}
          autoComplete="off"
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {open && results.length > 0 && (
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
      {open && !searching && query.length >= 3 && results.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-dark-700 border border-brand-500/20 rounded-lg shadow-xl px-4 py-3">
          <p className="text-sm text-slate-500">No locations found</p>
        </div>
      )}
    </div>
  );
}

export default function RiderDashboard() {
  const { user, token } = useAuthStore();

  const [pickup, setPickup]           = useState(null);
  const [dropoff, setDropoff]         = useState(null);
  const [estimate, setEstimate]       = useState(null);
  const [trip, setTrip]               = useState(null);
  const [nearbyDrivers, setNearbyDrivers] = useState([]);
  const [loading, setLoading]         = useState(false);
  const [cancelling, setCancelling]   = useState(false);
  const [notification, setNotification] = useState(null);
  const [tripHistory, setTripHistory] = useState([]);
  const [mapCenter, setMapCenter]     = useState([20, 0]);

  // ── BUG FIX: Store tripId in a ref so cancel always has the latest value ──
  const activeTripIdRef = useRef(null);

  const notify = (msg, type = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 6000);
  };

  // ── BUG FIX: Use refs for socket handlers to avoid stale closures ──
  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token);

    // ── BUG FIX: Remove ALL old listeners before adding new ones ──
    // Prevents stacking duplicate listeners across re-renders
    socket.off('trip:matched');
    socket.off('trip:driver_en_route');
    socket.off('trip:started');
    socket.off('trip:completed');
    socket.off('trip:cancelled');
    socket.off('trip:no_drivers');

    socket.on('trip:matched', (data) => {
      console.log('[Socket] trip:matched', data);
      // ── BUG FIX: Store the real tripId from server response ──
      activeTripIdRef.current = data.tripId;
      setTrip({ ...data, id: data.tripId });
      notify(`🎉 Driver matched! ${data.driverName} arriving in ~${data.etaMinutes} min`, 'success');
    });

    socket.on('trip:driver_en_route', () => {
      setTrip(t => t ? { ...t, status: 'PICKUP' } : t);
      notify('🚗 Driver is on the way!', 'info');
    });

    socket.on('trip:started', () => {
      setTrip(t => t ? { ...t, status: 'IN_PROGRESS' } : t);
      notify('🏎️ Trip started! Enjoy your ride.', 'info');
    });

    socket.on('trip:completed', ({ totalFare }) => {
      setTrip(t => t ? { ...t, status: 'COMPLETED', totalFare } : t);
      notify(`✅ Trip completed! Fare: $${totalFare}`, 'success');
      activeTripIdRef.current = null;
      loadHistory();
      setTimeout(() => setTrip(null), 8000);
    });

    socket.on('trip:cancelled', ({ reason }) => {
      console.log('[Socket] trip:cancelled', reason);
      setTrip(null);
      activeTripIdRef.current = null;
      notify(`Trip cancelled: ${reason || 'Ride cancelled'}`, 'warning');
    });

    socket.on('trip:no_drivers', () => {
      setTrip(null);
      activeTripIdRef.current = null;
      notify('No drivers available nearby. Please try again.', 'warning');
    });

    return () => {
      socket.off('trip:matched');
      socket.off('trip:driver_en_route');
      socket.off('trip:started');
      socket.off('trip:completed');
      socket.off('trip:cancelled');
      socket.off('trip:no_drivers');
    };
  }, [token]);

  // Load fare estimate when both locations set
  useEffect(() => {
    if (!pickup || !dropoff) return;
    const timer = setTimeout(async () => {
      try {
        const data = await api.get(
          `/api/rides/estimate?pickupLat=${pickup.lat}&pickupLng=${pickup.lng}&dropoffLat=${dropoff.lat}&dropoffLng=${dropoff.lng}`
        );
        setEstimate(data);
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [pickup, dropoff]);

  // Update map center and poll drivers when pickup changes
  useEffect(() => {
    if (!pickup) return;
    setMapCenter([pickup.lat, pickup.lng]);
    const poll = async () => {
      try {
        const data = await api.get(`/api/rides/nearby-drivers?lat=${pickup.lat}&lng=${pickup.lng}&radius=5`);
        setNearbyDrivers(data.drivers || []);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 8000);
    return () => clearInterval(interval);
  }, [pickup]);

  const loadHistory = async () => {
    try {
      const data = await api.get('/api/trips?limit=5');
      setTripHistory(data.trips || []);
    } catch {}
  };

  useEffect(() => { loadHistory(); }, []);

  const requestRide = async () => {
    if (!pickup || !dropoff) return;
    setLoading(true);
    try {
      const data = await api.post('/api/rides/request', {
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        pickupAddress: pickup.shortName || pickup.name,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        dropoffAddress: dropoff.shortName || dropoff.name,
      });
      // ── BUG FIX: Store tripId immediately on request ──
      activeTripIdRef.current = data.tripId;
      setTrip({ tripId: data.tripId, id: data.tripId, status: 'REQUESTED', surgeMultiplier: data.surgeMultiplier });
      notify('Ride requested — finding nearest driver...', 'info');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const cancelTrip = async () => {
    // ── BUG FIX: Use ref to always have the current tripId ──
    const tripId = activeTripIdRef.current || trip?.tripId || trip?.id;
    if (!tripId) {
      notify('No active trip to cancel', 'warning');
      return;
    }
    setCancelling(true);
    try {
      await api.post(`/api/rides/${tripId}/cancel`, { reason: 'Cancelled by rider' });
      setTrip(null);
      activeTripIdRef.current = null;
      notify('Trip cancelled.', 'info');
    } catch (err) {
      notify(`Cancel failed: ${err.message}`, 'error');
    } finally {
      setCancelling(false);
    }
  };

  // Map markers
  const mapMarkers = [
    ...(pickup  ? [{ type: 'pickup',  lat: pickup.lat,  lng: pickup.lng,  tooltip: `📍 ${pickup.shortName}`  }] : []),
    ...(dropoff ? [{ type: 'dropoff', lat: dropoff.lat, lng: dropoff.lng, tooltip: `🏁 ${dropoff.shortName}` }] : []),
    ...nearbyDrivers.map(d => ({
      type: 'driver', lat: d.lat, lng: d.lng,
      tooltip: `🚗 ${d.vehicleModel || 'Driver'} — ⭐ ${d.rating?.toFixed(1)}`,
    })),
    ...(trip?.driverLat ? [{
      type: 'driver', lat: trip.driverLat, lng: trip.driverLng,
      tooltip: `🚗 Your driver: ${trip.driverName}`,
    }] : []),
  ];

  const statusInfo = trip ? (TRIP_STATUS_LABELS[trip.status] || TRIP_STATUS_LABELS.REQUESTED) : null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 animate-fade-in">
      {notification && (
        <div className={`fixed top-16 right-4 z-50 px-5 py-3 rounded-xl font-medium text-sm shadow-xl animate-slide-up border max-w-sm ${
          notification.type === 'success' ? 'bg-brand-500/20 border-brand-500/40 text-brand-300' :
          notification.type === 'error'   ? 'bg-red-500/20   border-red-500/40   text-red-300'   :
          notification.type === 'warning' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' :
                                            'bg-blue-500/20  border-blue-500/40  text-blue-300'
        }`}>
          {notification.msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left Panel ── */}
        <div className="space-y-4">

          {/* Active trip card */}
          {trip && (
            <div className={`card border ${statusInfo?.bg} animate-slide-up`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-white">Active Trip</h3>
                <span className={`badge ${statusInfo?.bg} ${statusInfo?.color} border border-current/20`}>
                  {statusInfo?.label}
                </span>
              </div>

              {trip.status === 'REQUESTED' && (
                <div className="flex items-center gap-3 py-2">
                  <div className="w-6 h-6 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-slate-300">Searching for drivers...</span>
                </div>
              )}

              {trip.driverName && (
                <div className="space-y-2 mt-2">
                  <div className="flex items-center gap-3 bg-dark-700 rounded-lg p-3">
                    <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center text-lg">🧑</div>
                    <div>
                      <p className="font-semibold text-white">{trip.driverName}</p>
                      <p className="text-xs text-slate-400">⭐ {trip.driverRating?.toFixed(1)} · {trip.vehicleColor} {trip.vehicleModel}</p>
                      <p className="text-xs font-mono text-brand-400">{trip.vehiclePlate}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-dark-700 rounded-lg p-2">
                      <div className="text-brand-400 font-bold font-mono">{trip.etaMinutes}m</div>
                      <div className="text-xs text-slate-500">ETA</div>
                    </div>
                    <div className="bg-dark-700 rounded-lg p-2">
                      <div className="text-brand-400 font-bold font-mono">${trip.totalFare}</div>
                      <div className="text-xs text-slate-500">Total fare</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Cancel button — show for any non-terminal status */}
              {!['COMPLETED', 'CANCELLED', 'IN_PROGRESS'].includes(trip.status) && (
                <button
                  onClick={cancelTrip}
                  disabled={cancelling}
                  className="btn-danger w-full mt-3 text-sm py-2"
                >
                  {cancelling ? 'Cancelling...' : 'Cancel Trip'}
                </button>
              )}

              {trip.status === 'COMPLETED' && (
                <div className="text-center py-3">
                  <div className="text-3xl mb-1">🎉</div>
                  <p className="text-brand-400 font-semibold">Trip completed!</p>
                  <p className="text-slate-400 text-sm">Total: ${trip.totalFare}</p>
                </div>
              )}
            </div>
          )}

          {/* Book ride form */}
          {!trip && (
            <div className="card space-y-4">
              <h2 className="font-bold text-white text-lg">Book a Ride</h2>
              <p className="text-xs text-slate-500">Search any location worldwide</p>

              <LocationSearchInput
                label="📍 PICKUP LOCATION"
                value={pickup}
                onChange={setPickup}
                placeholder="Search pickup address..."
              />

              <LocationSearchInput
                label="🏁 DROPOFF LOCATION"
                value={dropoff}
                onChange={setDropoff}
                placeholder="Search dropoff address..."
              />

              {estimate && pickup && dropoff && (
                <div className="bg-dark-700 rounded-lg p-4 space-y-2 border border-brand-500/10">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Distance</span>
                    <span className="text-slate-200 font-mono">{estimate.distanceKm} km</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Est. duration</span>
                    <span className="text-slate-200 font-mono">{estimate.estimatedDurationMin} min</span>
                  </div>
                  {estimate.surgeMultiplier > 1 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-yellow-400">⚡ Surge</span>
                      <span className="text-yellow-400 font-mono font-bold">{estimate.surgeMultiplier}x</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t border-brand-500/10 pt-2">
                    <span className="text-white">Estimated fare</span>
                    <span className="text-brand-400 font-mono text-lg">${estimate.estimatedFare}</span>
                  </div>
                </div>
              )}

              {pickup && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <div className="status-dot bg-brand-400 animate-pulse-slow" />
                  {nearbyDrivers.length} driver{nearbyDrivers.length !== 1 ? 's' : ''} nearby
                </div>
              )}

              <button
                onClick={requestRide}
                disabled={loading || !pickup || !dropoff}
                className="btn-primary w-full"
              >
                {loading       ? 'Requesting...'          :
                 !pickup       ? 'Enter pickup location'  :
                 !dropoff      ? 'Enter dropoff location' :
                                 '🚗 Request Ride'}
              </button>
            </div>
          )}

          {/* Trip history */}
          <div className="card">
            <h3 className="font-bold text-white mb-3">Recent Trips</h3>
            {tripHistory.length === 0 ? (
              <p className="text-slate-500 text-sm">No trips yet</p>
            ) : (
              <div className="space-y-2">
                {tripHistory.slice(0, 3).map(t => (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-brand-500/5 last:border-0">
                    <div>
                      <p className="text-sm text-slate-300 truncate max-w-[150px]">{t.dropoffAddress}</p>
                      <p className="text-xs text-slate-500">{new Date(t.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-mono text-brand-400">${t.totalFare || '—'}</p>
                      <span className={`text-xs font-mono ${TRIP_STATUS_LABELS[t.status]?.color || 'text-slate-400'}`}>
                        {t.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Map ── */}
        <div className="lg:col-span-2">
          <div className="card p-0 overflow-hidden h-[600px]">
            <div className="px-4 py-3 border-b border-brand-500/10 flex items-center justify-between">
              <span className="text-sm font-mono text-slate-400">
                LIVE MAP {pickup ? `— ${pickup.shortName?.split(',')[0]}` : '— WORLDWIDE'}
              </span>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span>🚗 Driver</span>
                <span>📍 Pickup</span>
                <span>🏁 Dropoff</span>
              </div>
            </div>
            <RideMap
              center={mapCenter}
              zoom={pickup ? 13 : 2}
              markers={mapMarkers}
              className="h-[550px] w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
