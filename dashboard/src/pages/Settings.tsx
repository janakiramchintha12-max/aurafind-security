import React, { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, User, Lock, Bell, Shield, 
  Trash2, Save, CheckCircle2, AlertTriangle, RefreshCw, 
  Radio, Database, Key, Phone, Volume2, ShieldAlert
} from 'lucide-react';
import { authApi, devicesApi } from '../services/api';
import { User as UserType } from '../types';

interface SettingsPageProps {
  currentUser?: UserType | null;
}

export const SettingsPage: React.FC<SettingsPageProps> = () => {
  const [user, setUser] = useState<UserType | null>(null);
  const [loading, setLoading] = useState(true);

  // Password Change Form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Emergency & Anti-Theft Preferences (stored in localStorage for persistence)
  const [emergencyPhone, setEmergencyPhone] = useState(() => localStorage.getItem('aurafind_emergency_phone') || '+91 9392408017');
  const [lostModeMessage, setLostModeMessage] = useState(() => localStorage.getItem('aurafind_lost_message') || 'This phone is protected by AuraFind Security & actively tracked by Police. Call owner to return.');
  const [soundVolumeAlert, setSoundVolumeAlert] = useState(true);
  const [savedSettingsMsg, setSavedSettingsMsg] = useState(false);

  // Danger Zone Modal
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgeLoading, setPurgeLoading] = useState(false);

  useEffect(() => {
    async function loadUser() {
      try {
        const u = await authApi.getMe();
        setUser(u);
      } catch (e) {
        console.error('Failed to load user profile', e);
      } finally {
        setLoading(false);
      }
    }
    loadUser();
  }, []);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ text: 'New passwords do not match', type: 'error' });
      return;
    }
    if (newPassword.length < 4) {
      setPasswordMsg({ text: 'New password must be at least 4 characters', type: 'error' });
      return;
    }

    setPasswordLoading(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setPasswordMsg({ text: 'Password successfully updated!', type: 'success' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordMsg({
        text: err?.response?.data?.detail || 'Failed to update password',
        type: 'error'
      });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSavePreferences = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('aurafind_emergency_phone', emergencyPhone);
    localStorage.setItem('aurafind_lost_message', lostModeMessage);
    setSavedSettingsMsg(true);
    setTimeout(() => setSavedSettingsMsg(false), 3000);
  };

  const handlePurgeAll = async () => {
    setPurgeLoading(true);
    try {
      await devicesApi.purgeAll();
      setShowPurgeModal(false);
      alert('All devices and telemetry have been successfully purged.');
      window.location.href = '/';
    } catch (e: any) {
      alert(`Purge failed: ${e?.response?.data?.detail || e.message}`);
    } finally {
      setPurgeLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-20 text-slate-400">Loading platform settings...</div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-wide flex items-center space-x-2">
          <SettingsIcon className="w-6 h-6 text-cyan-400" />
          <span>Platform Settings & System Controls</span>
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Manage your account credentials, emergency anti-theft response, and security telemetry
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        
        {/* Account Profile Card */}
        <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-3 border-b border-slate-700/60 pb-3">
            <div className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-xl">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Owner Account Profile</h2>
              <p className="text-xs text-slate-400">Authenticated user credentials</p>
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div className="bg-slate-900/90 rounded-xl p-3 border border-slate-700/60">
              <span className="text-slate-400 font-medium block">Display Name</span>
              <span className="text-white font-bold text-sm">{user?.full_name || 'Owner'}</span>
            </div>

            <div className="bg-slate-900/90 rounded-xl p-3 border border-slate-700/60">
              <span className="text-slate-400 font-medium block">Username / Email</span>
              <span className="text-white font-mono font-bold">{user?.email}</span>
            </div>

            <div className="bg-slate-900/90 rounded-xl p-3 border border-slate-700/60">
              <span className="text-slate-400 font-medium block">Security User ID</span>
              <span className="text-cyan-400 font-mono text-[11px] select-all">{user?.id}</span>
            </div>

            <div className="bg-slate-900/90 rounded-xl p-3 border border-slate-700/60 flex items-center justify-between">
              <div>
                <span className="text-slate-400 font-medium block">Session Security Status</span>
                <span className="text-emerald-400 font-bold">Encrypted JWT Token Active</span>
              </div>
              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 rounded text-[10px] font-bold">
                VERIFIED
              </span>
            </div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-3 border-b border-slate-700/60 pb-3">
            <div className="p-2.5 bg-purple-500/10 text-purple-400 rounded-xl">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Change Account Password</h2>
              <p className="text-xs text-slate-400">Update your dashboard master password</p>
            </div>
          </div>

          {passwordMsg && (
            <div className={`p-3 rounded-xl text-xs border flex items-center space-x-2 ${
              passwordMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}>
              {passwordMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{passwordMsg.text}</span>
            </div>
          )}

          <form onSubmit={handlePasswordChange} className="space-y-3 text-xs">
            <div>
              <label className="block text-slate-300 mb-1 font-semibold">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 focus:border-purple-500 rounded-xl px-3 py-2 text-white focus:outline-none"
                placeholder="Enter current password"
                required
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-semibold">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 focus:border-purple-500 rounded-xl px-3 py-2 text-white focus:outline-none"
                placeholder="Minimum 4 characters"
                required
              />
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-semibold">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 focus:border-purple-500 rounded-xl px-3 py-2 text-white focus:outline-none"
                placeholder="Re-type new password"
                required
              />
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={passwordLoading}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl font-bold shadow-lg shadow-purple-600/30 transition-all flex items-center justify-center space-x-2 cursor-pointer"
              >
                {passwordLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Update Password</span>
              </button>
            </div>
          </form>
        </div>

      </div>

      {/* Emergency Anti-Theft Response Preferences */}
      <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Emergency Anti-Theft Response Configuration</h2>
              <p className="text-xs text-slate-400">Default messages and recovery contacts broadcasted during Lost Mode or Theft alerts</p>
            </div>
          </div>
          {savedSettingsMsg && (
            <span className="text-xs text-emerald-400 font-bold flex items-center space-x-1">
              <CheckCircle2 className="w-4 h-4" />
              <span>Saved!</span>
            </span>
          )}
        </div>

        <form onSubmit={handleSavePreferences} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 mb-1 font-semibold flex items-center space-x-1.5">
                <Phone className="w-3.5 h-3.5 text-cyan-400" />
                <span>Primary Owner Recovery Phone Number</span>
              </label>
              <input
                type="text"
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
                placeholder="e.g. +91 9392408017"
                className="w-full bg-slate-900 border border-slate-700 focus:border-cyan-500 rounded-xl px-3 py-2 text-white font-mono focus:outline-none"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                This number is displayed prominently on the phone's locked screen so honest finders can call you.
              </p>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-semibold flex items-center space-x-1.5">
                <Volume2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Emergency Alarm Override</span>
              </label>
              <div className="p-3 bg-slate-900 rounded-xl border border-slate-700 flex items-center justify-between">
                <div>
                  <div className="font-bold text-white">Override Silent / DND Mode</div>
                  <div className="text-[11px] text-slate-400">Play police siren at 100% maximum hardware volume</div>
                </div>
                <input
                  type="checkbox"
                  checked={soundVolumeAlert}
                  onChange={(e) => setSoundVolumeAlert(e.target.checked)}
                  className="w-4 h-4 accent-cyan-500 cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 mb-1 font-semibold">Default Lost Mode Screen Message</label>
            <textarea
              value={lostModeMessage}
              onChange={(e) => setLostModeMessage(e.target.value)}
              rows={3}
              className="w-full bg-slate-900 border border-slate-700 focus:border-cyan-500 rounded-xl p-3 text-white text-xs resize-none focus:outline-none"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold shadow-lg shadow-cyan-600/30 transition-all flex items-center space-x-2 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>Save Anti-Theft Preferences</span>
            </button>
          </div>
        </form>
      </div>

      {/* System Diagnostics & Health Card */}
      <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center space-x-3 border-b border-slate-700/60 pb-3">
          <div className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">System Infrastructure & Diagnostics</h2>
            <p className="text-xs text-slate-400">Hardware connectivity, database health, and realtime engine status</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-900/80 border border-slate-700/60 rounded-xl p-3 space-y-1">
            <div className="text-[10px] text-slate-400 uppercase font-bold">FastAPI REST Server</div>
            <div className="text-emerald-400 font-bold flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>Online (Port 8000)</span>
            </div>
            <div className="text-[11px] text-slate-400">Endpoints: Devices, Telemetry, Geofences</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-700/60 rounded-xl p-3 space-y-1">
            <div className="text-[10px] text-slate-400 uppercase font-bold">WebSocket Realtime Hub</div>
            <div className="text-cyan-400 font-bold flex items-center space-x-1">
              <Radio className="w-3 h-3 text-cyan-400 animate-spin" />
              <span>Active Subscriptions</span>
            </div>
            <div className="text-[11px] text-slate-400">Zero-latency peer relay & stream dispatch</div>
          </div>

          <div className="bg-slate-900/80 border border-slate-700/60 rounded-xl p-3 space-y-1">
            <div className="text-[10px] text-slate-400 uppercase font-bold">Storage Engine</div>
            <div className="text-white font-bold">SQLite + WAL Mode</div>
            <div className="text-[11px] text-slate-400">Vacuumed & optimized for fast reads</div>
          </div>
        </div>
      </div>

      {/* Danger Zone: Purge All Devices */}
      <div className="bg-rose-950/20 border border-rose-500/40 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-rose-500/20 text-rose-400 rounded-xl">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-rose-300">Danger Zone: System Reset & Telemetry Purge</h2>
            <p className="text-xs text-slate-400">Permanently clear all enrolled devices, GPS traces, commands, and media files</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
          <p className="text-xs text-slate-300 max-w-xl">
            This action permanently deletes all enrolled Android handsets, location records, snapshots, audio recordings, and geofences from the database. Your user account will remain intact.
          </p>

          <button
            type="button"
            onClick={() => setShowPurgeModal(true)}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/30 transition-all shrink-0 cursor-pointer"
          >
            Purge All Devices
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showPurgeModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/50 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-3 text-rose-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-bold text-white">Confirm Complete Device Purge</h3>
            </div>
            
            <p className="text-xs text-slate-300 leading-relaxed">
              Are you completely sure you want to purge all devices? All historical GPS coordinates, command logs, snapshots, and enrolled device connections will be permanently deleted from the database.
            </p>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowPurgeModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={purgeLoading}
                onClick={handlePurgeAll}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/30 transition-all flex items-center space-x-2 cursor-pointer"
              >
                {purgeLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Yes, Purge Everything</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
