import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Shield, LayoutDashboard, MapPin, History, Map, Radio, ShieldAlert, LogOut } from 'lucide-react';
import { authApi } from '../services/api';
import { User } from '../types';

interface NavbarProps {
  user: User | null;
  setUser: (u: User | null) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, setUser }) => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await authApi.logout();
    setUser(null);
    navigate('/login');
  };

  const navItems = [
    { label: 'Overview', path: '/', icon: LayoutDashboard },
    { label: 'Live Location', path: '/live', icon: MapPin },
    { label: 'History', path: '/history', icon: History },
    { label: 'Geofences', path: '/geofences', icon: Map },
    { label: 'Commands', path: '/commands', icon: Radio },
    { label: 'Audit Logs', path: '/audit', icon: ShieldAlert },
  ];

  return (
    <nav className="bg-slate-900/90 backdrop-blur border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Brand */}
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="p-2 bg-gradient-to-tr from-cyan-600 to-blue-600 rounded-xl shadow-lg shadow-cyan-500/20 group-hover:scale-105 transition-transform">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="font-bold text-lg text-white tracking-wide">AuraFind</span>
              <span className="text-xs block text-cyan-400 font-medium">Multi-Device Security</span>
            </div>
          </Link>

          {/* Navigation links */}
          {user && (
            <div className="hidden md:flex items-center space-x-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          )}

          {/* User profile / Logout */}
          {user ? (
            <div className="flex items-center space-x-4">
              <div className="hidden sm:block text-right">
                <div className="text-sm font-semibold text-slate-200">{user.full_name || 'Owner'}</div>
                <div className="text-xs text-slate-400">{user.email}</div>
              </div>
              <button
                onClick={handleLogout}
                className="p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                title="Sign out"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-semibold shadow-lg shadow-cyan-600/30 transition-all"
            >
              Sign In
            </Link>
          )}

        </div>
      </div>
    </nav>
  );
};
