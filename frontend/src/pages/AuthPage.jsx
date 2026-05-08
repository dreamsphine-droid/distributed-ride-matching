// src/pages/AuthPage.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export default function AuthPage() {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [role, setRole] = useState('RIDER');
  const [form, setForm] = useState({ email: '', password: '', name: '', phone: '', vehicleModel: '', vehiclePlate: '', vehicleColor: '' });
  const [err, setErr] = useState('');

  const { login, register, loading, user } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate('/');
  }, [user]);

  const update = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        await register({ ...form, role });
      }
      navigate('/');
    } catch (ex) {
      setErr(ex.message);
    }
  };

  return (
    <div className="min-h-screen bg-dark-900 flex">
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 bg-dark-800 border-r border-brand-500/10">
        <div>
          <div className="flex items-center gap-3 mb-16">
            <span className="text-brand-400 text-3xl">⬡</span>
            <span className="font-bold text-2xl text-white">RideFlow</span>
          </div>
          <h1 className="text-5xl font-bold text-white leading-tight mb-6">
            Distributed<br />
            <span className="text-brand-400">Ride Matching</span><br />
            at scale.
          </h1>
          <p className="text-slate-400 text-lg leading-relaxed max-w-md">
            Built on Apache Kafka, Redis geospatial indexing, and real-time WebSocket streams.
            Sub-200ms matching latency.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Matching Latency', value: '<200ms', sub: 'p99' },
            { label: 'Concurrent Users', value: '500K+', sub: 'peak load' },
            { label: 'Availability', value: '99.99%', sub: 'uptime SLA' },
            { label: 'Geo Query', value: '2–5ms', sub: 'Redis GEORADIUS' },
          ].map(({ label, value, sub }) => (
            <div key={label} className="card">
              <div className="text-2xl font-bold text-brand-400 font-mono">{value}</div>
              <div className="text-sm text-slate-300 font-medium">{label}</div>
              <div className="text-xs text-slate-500 font-mono">{sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md animate-slide-up">
          <div className="flex gap-1 mb-8 bg-dark-800 p-1 rounded-lg border border-brand-500/10">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${mode === 'login' ? 'bg-brand-500 text-dark-900' : 'text-slate-400 hover:text-white'}`}
            >
              Login
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all ${mode === 'register' ? 'bg-brand-500 text-dark-900' : 'text-slate-400 hover:text-white'}`}
            >
              Register
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="text-xs font-mono text-slate-400 mb-1.5 block">FULL NAME</label>
                  <input className="input" placeholder="Your name" value={form.name} onChange={update('name')} required />
                </div>

                {/* Role selector */}
                <div>
                  <label className="text-xs font-mono text-slate-400 mb-1.5 block">ROLE</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['RIDER', 'DRIVER'].map(r => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRole(r)}
                        className={`py-2.5 rounded-lg text-sm font-semibold border transition-all ${
                          role === r
                            ? 'border-brand-500 bg-brand-500/15 text-brand-400'
                            : 'border-brand-500/20 text-slate-400 hover:border-brand-500/40'
                        }`}
                      >
                        {r === 'RIDER' ? '🙋 Rider' : '🚗 Driver'}
                      </button>
                    ))}
                  </div>
                </div>

                {role === 'DRIVER' && (
                  <div className="space-y-3 p-3 rounded-lg border border-brand-500/15 bg-brand-500/5">
                    <p className="text-xs font-mono text-brand-400">VEHICLE INFO</p>
                    <input className="input" placeholder="Vehicle Model (e.g. Toyota Camry)" value={form.vehicleModel} onChange={update('vehicleModel')} />
                    <input className="input" placeholder="License Plate" value={form.vehiclePlate} onChange={update('vehiclePlate')} />
                    <input className="input" placeholder="Vehicle Color" value={form.vehicleColor} onChange={update('vehicleColor')} />
                  </div>
                )}
              </>
            )}

            <div>
              <label className="text-xs font-mono text-slate-400 mb-1.5 block">EMAIL</label>
              <input className="input" type="email" placeholder="you@example.com" value={form.email} onChange={update('email')} required />
            </div>
            <div>
              <label className="text-xs font-mono text-slate-400 mb-1.5 block">PASSWORD</label>
              <input className="input" type="password" placeholder="••••••••" value={form.password} onChange={update('password')} required />
            </div>

            {err && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-4 py-3">
                {err}
              </div>
            )}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>

            <p className="text-center text-xs text-slate-500">
              Demo: <span className="font-mono text-slate-400">alice@example.com / password123</span>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
