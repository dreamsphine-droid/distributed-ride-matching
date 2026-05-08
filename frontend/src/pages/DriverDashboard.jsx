// src/pages/DriverDashboard.jsx
import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { api } from '../utils/api';
import { connectSocket, getSocket } from '../utils/socket';
import RideMap from '../components/RideMap';

// Simulated GPS positions near NYC
const NYC_POSITIONS = [
  { lat: 40.7580, lng: -73.9855 },
  { lat: 40.7614, lng: -73.9776 },
  { lat: 40.7549, lng: -73.9840 },
  { lat: 40.7488, lng: -73.9856 },
  { lat: 40.7530, lng: -73.9820 },
];

export default function DriverDashboard() {
  const { user, token } = useAuthStore();
  const profile = user?.driverProfile;

  const [isOnline, setIsOnline] = useState(false);
  const [currentLocation, setCurrentLocation] = useState(NYC_POSITIONS[0]);
  const [assignedTrip, setAssignedTrip] = useState(null);
  const [tripState, setTripState] = useState(null); // 'assigned' | 'accepted' | 'started' | 'completed'
  const [stats, setStats] = useState(null);
  const [notification, setNotification] = useState(null);
  const locationInterval = useRef(null);
  const posIdx = useRef(0);

  const notify = (msg, type = 'info') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 6000);
  };

  // Connect socket
  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token);

    socket.on('trip:assigned', (data) => {
      setAssignedTrip(data);
      setTripState('assigned');
      notify(`🔔 New trip request! Pickup: ${data.pickupAddress}`, 'success');
    });

    socket.on('trip:cancelled', ({ tripId, reason }) => {
      if (assignedTrip?.tripId === tripId) {
        setAssignedTrip(null);
        setTripState(null);
        notify(`Trip cancelled by rider: ${reason}`, 'warning');
      }
    });

    socket.on('driver:status_changed', ({ status }) => {
      setIsOnline(status === 'AVAILABLE');
    });

    socket.on('trip:accepted', () => setTripState('accepted'));
    socket.on('trip:started_ack', () => setTripState('started'));
    socket.on('trip:completed_ack', () => {
      notify('✅ Trip completed! Great work!', 'success');
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

  // Simulate GPS location updates when online
  useEffect(() => {
    if (!isOnline) {
      clearInterval(locationInterval.current);
      return;
    }

    const socket = getSocket();
    const sendLocation = () => {
      posIdx.current = (posIdx.current + 1) % NYC_POSITIONS.length;
      const pos = NYC_POSITIONS[posIdx.current];
      // Add small random offset to simulate movement
      const jitter = () => (Math.random() - 0.5) * 0.003;
      const newPos = { lat: pos.lat + jitter(), lng: pos.lng + jitter() };
      setCurrentLocation(newPos);

      socket?.emit('driver:location_update', {
        lat: newPos.lat,
        lng: newPos.lng,
        speed: 25 + Math.random() * 30,
        heading: Math.random() * 360,
        name: user.name,
        rating: user.rating,
        vehicleModel: profile?.vehicleModel,
        vehiclePlate: profile?.vehiclePlate,
        vehicleColor: profile?.vehicleColor,
        acceptanceRate: profile?.acceptanceRate,
      });
    };

    sendLocation();
    locationInterval.current = setInterval(sendLocation, 4000);
    return () => clearInterval(locationInterval.current);
  }, [isOnline]);

  const toggleOnline = () => {
    const socket = getSocket();
    if (isOnline) {
      socket?.emit('driver:go_offline');
      setIsOnline(false);
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
    { type: 'driver', lat: currentLocation.lat, lng: currentLocation.lng, tooltip: 'You are here' },
    ...(assignedTrip ? [
      { type: 'pickup', lat: assignedTrip.pickupLat, lng: assignedTrip.pickupLng, tooltip: `📍 Pickup: ${assignedTrip.pickupAddress}` },
      { type: 'dropoff', lat: assignedTrip.dropoffLat, lng: assignedTrip.dropoffLng, tooltip: `🏁 Dropoff: ${assignedTrip.dropoffAddress}` },
    ] : []),
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 animate-fade-in">
      {notification && (
        <div className={`fixed top-16 right-4 z-50 px-5 py-3 rounded-xl font-medium text-sm shadow-xl animate-slide-up border max-w-sm ${
          notification.type === 'success' ? 'bg-brand-500/20 border-brand-500/40 text-brand-300' :
          notification.type === 'warning' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' :
          'bg-blue-500/20 border-blue-500/40 text-blue-300'
        }`}>
          {notification.msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel */}
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

            <button
              onClick={toggleOnline}
              className={`w-full py-3 rounded-lg font-bold text-sm transition-all ${
                isOnline
                  ? 'bg-brand-500/20 border-2 border-brand-500 text-brand-400'
                  : 'bg-dark-700 border-2 border-slate-600 text-slate-400 hover:border-slate-400'
              }`}
            >
              <span className={`status-dot mr-2 ${isOnline ? 'bg-brand-400 animate-pulse' : 'bg-slate-500'}`} />
              {isOnline ? 'ONLINE — Available for rides' : 'OFFLINE — Go online to receive trips'}
            </button>
          </div>

          {/* Assigned trip */}
          {assignedTrip && (
            <div className="card border border-brand-500/30 bg-brand-500/5 animate-slide-up">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-white">Trip Request</h3>
                <span className="badge bg-brand-500/20 text-brand-400 border border-brand-500/30">
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
                  <div className="text-xl font-bold text-brand-400 font-mono">
                    {stats.profile?.totalTrips || 0}
                  </div>
                  <div className="text-xs text-slate-500">Total Trips</div>
                </div>
                <div className="bg-dark-700 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-brand-400 font-mono">
                    ${parseFloat(stats.totalEarnings || 0).toFixed(0)}
                  </div>
                  <div className="text-xs text-slate-500">Recent Earnings</div>
                </div>
                <div className="bg-dark-700 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-brand-400 font-mono">
                    {((stats.profile?.acceptanceRate || 0) * 100).toFixed(0)}%
                  </div>
                  <div className="text-xs text-slate-500">Acceptance</div>
                </div>
                <div className="bg-dark-700 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-brand-400 font-mono">
                    ⭐ {user?.rating?.toFixed(1)}
                  </div>
                  <div className="text-xs text-slate-500">Rating</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="lg:col-span-2">
          <div className="card p-0 overflow-hidden h-[600px]">
            <div className="px-4 py-3 border-b border-brand-500/10 flex items-center justify-between">
              <span className="text-sm font-mono text-slate-400">DRIVER MAP</span>
              <div className="flex items-center gap-2 text-xs">
                <span className={`status-dot ${isOnline ? 'bg-brand-400 animate-pulse' : 'bg-slate-500'}`} />
                <span className={isOnline ? 'text-brand-400' : 'text-slate-500'}>
                  {isOnline ? 'Broadcasting location' : 'Offline'}
                </span>
              </div>
            </div>
            <RideMap
              center={[currentLocation.lat, currentLocation.lng]}
              markers={mapMarkers}
              className="h-[550px] w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
