// src/pages/AdminDashboard.jsx
import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { connectSocket } from '../utils/socket';
import { useAuthStore } from '../store/authStore';

const STATUS_COLORS = {
  REQUESTED: 'text-yellow-400 bg-yellow-400/10',
  MATCHED: 'text-brand-400 bg-brand-400/10',
  PICKUP: 'text-blue-400 bg-blue-400/10',
  IN_PROGRESS: 'text-purple-400 bg-purple-400/10',
  COMPLETED: 'text-green-400 bg-green-400/10',
  CANCELLED: 'text-red-400 bg-red-400/10',
};

function MetricCard({ label, value, sub, icon }) {
  return (
    <div className="card hover:border-brand-500/30 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        <span className="text-xs font-mono text-slate-500 bg-dark-700 px-2 py-0.5 rounded">{sub}</span>
      </div>
      <div className="text-3xl font-bold font-mono text-white mb-1">{value}</div>
      <div className="text-sm text-slate-400">{label}</div>
    </div>
  );
}

export default function AdminDashboard() {
  const { token } = useAuthStore();
  const [dashboard, setDashboard] = useState(null);
  const [trips, setTrips] = useState([]);
  const [users, setUsers] = useState([]);
  const [tab, setTab] = useState('overview');
  const [liveEvents, setLiveEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const addEvent = (msg) => {
    setLiveEvents(prev => [{
      id: Date.now(),
      msg,
      time: new Date().toLocaleTimeString(),
    }, ...prev].slice(0, 20));
  };

  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token);

    // Listen to driver moves (admin only)
    socket.on('driver:moved', ({ driverId, lat, lng }) => {
      addEvent(`🚗 Driver ${driverId.slice(0, 8)}... moved to (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
    });

    return () => socket.off('driver:moved');
  }, [token]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const [dash, tripsData, usersData] = await Promise.all([
        api.get('/api/admin/dashboard'),
        api.get('/api/admin/trips?limit=10'),
        api.get('/api/admin/users?limit=10'),
      ]);
      setDashboard(dash);
      setTrips(tripsData.trips || []);
      setUsers(usersData.users || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !dashboard) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const m = dashboard?.metrics || {};
  const services = dashboard?.services || {};

  const TABS = ['overview', 'trips', 'users', 'live-events'];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-slate-400 text-sm">System overview — auto-refreshes every 15s</p>
        </div>
        <button onClick={loadDashboard} className="btn-secondary text-sm py-2">
          ↻ Refresh
        </button>
      </div>

      {/* Service health */}
      <div className="flex gap-3 mb-6 flex-wrap">
        {Object.entries(services).map(([svc, status]) => (
          <div key={svc} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono border ${
            status.includes('connected') ? 'border-brand-500/30 bg-brand-500/10 text-brand-400' :
            'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
          }`}>
            <span className={`status-dot ${status.includes('connected') ? 'bg-brand-400' : 'bg-yellow-400'}`} />
            {svc}: {status}
          </div>
        ))}
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-6 bg-dark-800 p-1 rounded-lg border border-brand-500/10 w-fit">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all capitalize ${
              tab === t ? 'bg-brand-500/20 text-brand-400' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t.replace('-', ' ')}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Riders" value={m.totalRiders || 0} icon="🙋" sub="registered" />
            <MetricCard label="Total Drivers" value={m.totalDrivers || 0} icon="🚗" sub="registered" />
            <MetricCard label="Active Trips" value={m.activeTrips || 0} icon="📍" sub="live" />
            <MetricCard label="Completed Today" value={m.completedToday || 0} icon="✅" sub="today" />
            <MetricCard label="Revenue" value={`$${m.totalRevenue || '0.00'}`} icon="💰" sub="all time" />
            <MetricCard label="Online Drivers" value={m.activeDrivers || 0} icon="📡" sub="geo-indexed" />
            <MetricCard label="WS Connections" value={m.activeConnections || 0} icon="⚡" sub="live sockets" />
            <MetricCard label="Redis Memory" value={m.redisMemory || '—'} icon="🧠" sub="in use" />
          </div>

          {/* Architecture info */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="font-bold text-white mb-3 flex items-center gap-2">
                <span>⬡</span> Architecture Components
              </h3>
              <div className="space-y-2 font-mono text-xs">
                {[
                  { layer: 'API Gateway', tech: 'Express.js + Helmet', status: '✅' },
                  { layer: 'Geo Index', tech: 'Redis GEORADIUS', status: '✅' },
                  { layer: 'Event Stream', tech: 'Apache Kafka', status: services.kafka?.includes('connected') ? '✅' : '⚠️' },
                  { layer: 'Real-time', tech: 'Socket.io WebSocket', status: '✅' },
                  { layer: 'Primary DB', tech: 'PostgreSQL + Prisma', status: '✅' },
                  { layer: 'Matching', tech: 'Weighted scoring algo', status: '✅' },
                ].map(({ layer, tech, status }) => (
                  <div key={layer} className="flex items-center justify-between py-1.5 border-b border-brand-500/5 last:border-0">
                    <span className="text-slate-400">{layer}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-brand-400/70">{tech}</span>
                      <span>{status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 className="font-bold text-white mb-3">CAP Theorem Choices</h3>
              <div className="space-y-2">
                {[
                  { op: 'Driver availability', choice: 'AP', reason: 'Double-offer recoverable' },
                  { op: 'Trip state machine', choice: 'CP', reason: 'No duplicate trips' },
                  { op: 'Location updates', choice: 'AP', reason: '4s staleness tolerable' },
                  { op: 'Payment processing', choice: 'CP', reason: 'Financial exactness required' },
                  { op: 'Surge pricing', choice: 'AP', reason: 'Approximate data sufficient' },
                ].map(({ op, choice, reason }) => (
                  <div key={op} className="flex items-center gap-3 py-1.5 border-b border-brand-500/5 last:border-0">
                    <span className={`badge font-mono text-xs ${choice === 'CP' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'}`}>
                      {choice}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-300 truncate">{op}</p>
                      <p className="text-xs text-slate-500">{reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Trips */}
      {tab === 'trips' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-500/10 text-left">
                <th className="pb-3 font-mono text-xs text-slate-400">TRIP ID</th>
                <th className="pb-3 font-mono text-xs text-slate-400">RIDER</th>
                <th className="pb-3 font-mono text-xs text-slate-400">DRIVER</th>
                <th className="pb-3 font-mono text-xs text-slate-400">STATUS</th>
                <th className="pb-3 font-mono text-xs text-slate-400">FARE</th>
                <th className="pb-3 font-mono text-xs text-slate-400">DATE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-500/5">
              {trips.map(t => (
                <tr key={t.id} className="hover:bg-brand-500/5 transition-colors">
                  <td className="py-3 font-mono text-xs text-slate-500">{t.id.slice(0, 8)}...</td>
                  <td className="py-3 text-slate-300">{t.rider?.name || '—'}</td>
                  <td className="py-3 text-slate-300">{t.driver?.name || 'Unmatched'}</td>
                  <td className="py-3">
                    <span className={`badge text-xs ${STATUS_COLORS[t.status] || 'text-slate-400'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td className="py-3 font-mono text-brand-400">
                    {t.totalFare ? `$${t.totalFare}` : '—'}
                  </td>
                  <td className="py-3 text-xs text-slate-500">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {trips.length === 0 && (
            <p className="text-center text-slate-500 py-8">No trips found</p>
          )}
        </div>
      )}

      {/* Users */}
      {tab === 'users' && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-500/10 text-left">
                <th className="pb-3 font-mono text-xs text-slate-400">NAME</th>
                <th className="pb-3 font-mono text-xs text-slate-400">EMAIL</th>
                <th className="pb-3 font-mono text-xs text-slate-400">ROLE</th>
                <th className="pb-3 font-mono text-xs text-slate-400">RATING</th>
                <th className="pb-3 font-mono text-xs text-slate-400">JOINED</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-500/5">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-brand-500/5 transition-colors">
                  <td className="py-3 font-medium text-slate-200">{u.name}</td>
                  <td className="py-3 text-slate-400 font-mono text-xs">{u.email}</td>
                  <td className="py-3">
                    <span className={`badge text-xs ${
                      u.role === 'DRIVER' ? 'bg-blue-500/15 text-blue-400' :
                      u.role === 'ADMIN' ? 'bg-purple-500/15 text-purple-400' :
                      'bg-brand-500/15 text-brand-400'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-3 font-mono text-brand-400">⭐ {u.rating?.toFixed(1)}</td>
                  <td className="py-3 text-xs text-slate-500">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Live Events */}
      {tab === 'live-events' && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <div className="status-dot bg-brand-400 animate-pulse" />
            <h3 className="font-bold text-white">Live Event Stream</h3>
            <span className="text-xs text-slate-500">(WebSocket events)</span>
          </div>
          <div className="space-y-1.5 max-h-96 overflow-y-auto font-mono text-xs">
            {liveEvents.length === 0 ? (
              <p className="text-slate-500">Waiting for events... Go online as a driver to see location updates.</p>
            ) : (
              liveEvents.map(e => (
                <div key={e.id} className="flex gap-3 py-1.5 border-b border-brand-500/5 animate-fade-in">
                  <span className="text-slate-600 shrink-0">{e.time}</span>
                  <span className="text-slate-300">{e.msg}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
