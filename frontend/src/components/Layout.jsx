// src/components/Layout.jsx
import React from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { disconnectSocket } from '../utils/socket';

export default function Layout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    disconnectSocket();
    logout();
    navigate('/auth');
  };

  const navLink = (path, label) => (
    <Link
      to={path}
      className={`text-sm font-medium transition-colors px-3 py-1.5 rounded-lg ${
        location.pathname === path
          ? 'bg-brand-500/15 text-brand-400'
          : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-brand-500/10 bg-dark-800/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2">
              <span className="text-brand-400 text-xl">⬡</span>
              <span className="font-bold text-lg tracking-tight text-white">RideFlow</span>
            </Link>
            <div className="flex items-center gap-1">
              {user?.role === 'RIDER' && navLink('/ride', 'Request Ride')}
              {user?.role === 'DRIVER' && navLink('/driver', 'Driver Panel')}
              {user?.role === 'ADMIN' && navLink('/admin', 'Dashboard')}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-medium text-slate-200">{user.name}</p>
                  <p className="text-xs text-brand-400 font-mono">{user.role}</p>
                </div>
                <button onClick={handleLogout} className="btn-secondary text-sm py-1.5">
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
