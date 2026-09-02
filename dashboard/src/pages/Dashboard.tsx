import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw, Smartphone, ShieldCheck, AlertTriangle } from 'lucide-react';
import { devicesApi, commandsApi, connectWebSocket } from '../services/api';
import { Device } from '../types';
import { DeviceCard } from '../components/DeviceCard';
import { LiveCameraStreamModal } from '../components/LiveCameraStreamModal';
import { LiveDiagnosticsPanel } from '../components/LiveDiagnosticsPanel';

export const DashboardPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [activeCameraDevice, setActiveCameraDevice] = useState<Device | null>(null);
  const [newDevName, setNewDevName] = useState('');
  const [newDevModel, setNewDevModel] = useState('Pixel 8 Pro');
  const [alertMsg, setAlertMsg] = useState<{ text: string; type: 'info' | 'success' | 'error' } | null>(null);

  const fetchDevices = async () => {
    try {
      const list = await devicesApi.list();
      setDevices(list);
    } catch (e) {
      console.error('Failed to fetch devices', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();

    const cleanup = connectWebSocket((eventData) => {
      if (eventData.event === 'DEVICE_STATUS_UPDATE' || eventData.event === 'NEW_LOCATION' || eventData.event === 'OFFLINE_LOCATIONS_SYNCED') {
        fetchDevices();
        if (eventData.event === 'OFFLINE_LOCATIONS_SYNCED') {
          setAlertMsg({
            text: `Synchronized ${eventData.synced_count} offline locations for device ${eventData.device_id}`,
            type: 'success'
          });
        }
      }
    });

    return () => cleanup();
  }, []);

  const handleLocate = async (id: string) => {
    try {
      await commandsApi.dispatch(id, 'LOCATE_NOW');
      setAlertMsg({ text: 'Location request sent to device', type: 'info' });
    } catch (e) {
      setAlertMsg({ text: 'Failed to send locate command', type: 'error' });
    }
  };

  const handleRing = async (id: string) => {
    try {
      await commandsApi.dispatch(id, 'PLAY_ALARM', { duration_seconds: 60 });
      setAlertMsg({ text: 'Emergency alarm started on device', type: 'info' });
    } catch (e) {
      setAlertMsg({ text: 'Failed to send start ring command', type: 'error' });
    }
  };

  const handleStopRing = async (id: string) => {
    try {
      await commandsApi.dispatch(id, 'STOP_ALARM');
      setAlertMsg({ text: 'Silence alarm command sent to device', type: 'success' });
    } catch (e) {
      setAlertMsg({ text: 'Failed to send stop ring command', type: 'error' });
    }
  };

  const handleTakeSelfie = async (id: string) => {
    try {
      await commandsApi.dispatch(id, 'CAPTURE_SNAPSHOT');
      setAlertMsg({ text: 'Remote camera selfie snapshot command sent to device!', type: 'success' });
    } catch (e) {
      setAlertMsg({ text: 'Failed to send selfie command', type: 'error' });
    }
  };

  const handleToggleLostMode = async (id: string, currentLostState: boolean) => {
    const action = currentLostState ? 'DISABLE_LOST_MODE' : 'ENABLE_LOST_MODE';
    try {
      await commandsApi.dispatch(id, action);
      await devicesApi.update(id, { is_lost_mode: !currentLostState });
      fetchDevices();
      setAlertMsg({
        text: currentLostState ? 'Lost mode deactivated for device' : 'Emergency Lost Mode enabled on device!',
        type: currentLostState ? 'info' : 'error'
      });
    } catch (e) {
      setAlertMsg({ text: 'Failed to update lost mode', type: 'error' });
    }
  };

  const handleSync = async (id: string) => {
    try {
      await commandsApi.dispatch(id, 'FORCE_SYNC');
      setAlertMsg({ text: 'Sync request sent to device', type: 'info' });
    } catch (e) {
      setAlertMsg({ text: 'Failed to send sync command', type: 'error' });
    }
  };

  const handleRegisterDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDevName) return;
    try {
      await devicesApi.register(newDevName, newDevModel, '14.0');
      setNewDevName('');
      setRegisterOpen(false);
      fetchDevices();
      setAlertMsg({ text: 'Device registered successfully', type: 'success' });
    } catch (e) {
      setAlertMsg({ text: 'Failed to register device', type: 'error' });
    }
  };

  const onlineCount = devices.filter(d => d.status === 'ONLINE').length;
  const offlineCount = devices.length - onlineCount;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Header stats */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">My Devices</h1>
          <p className="text-sm text-slate-400">Managing {devices.length} registered Android devices</p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchDevices}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition-all"
            title="Refresh Devices"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          
          <button
            onClick={() => setRegisterOpen(true)}
            className="flex items-center space-x-2 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl text-sm shadow-lg shadow-cyan-600/30 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Register Device</span>
          </button>
        </div>
      </div>

      {/* Banner alert */}
      {alertMsg && (
        <div className={`p-4 rounded-xl text-sm border flex items-center justify-between ${
          alertMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
          alertMsg.type === 'error' ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' :
          'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
        }`}>
          <span>{alertMsg.text}</span>
          <button onClick={() => setAlertMsg(null)} className="font-bold text-xs opacity-70 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {/* Live System Health & Error Finder Panel */}
      <LiveDiagnosticsPanel
        device={devices.length > 0 ? devices[0] : null}
        onRefresh={fetchDevices}
      />

      {/* Stats Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 flex items-center space-x-4">
          <div className="p-3 bg-cyan-500/10 text-cyan-400 rounded-xl">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{devices.length}</div>
            <div className="text-xs text-slate-400">Total Registered</div>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 flex items-center space-x-4">
          <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-xl">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{onlineCount}</div>
            <div className="text-xs text-slate-400">Online Devices</div>
          </div>
        </div>

        <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 flex items-center space-x-4">
          <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{offlineCount}</div>
            <div className="text-xs text-slate-400">Offline / Queueing</div>
          </div>
        </div>
      </div>

      {/* Device Cards Grid */}
      {loading ? (
        <div className="text-center py-16 text-slate-400">Loading devices...</div>
      ) : devices.length === 0 ? (
        <div className="bg-slate-800/40 border border-slate-700/60 rounded-2xl p-12 text-center space-y-3">
          <Smartphone className="w-12 h-12 mx-auto text-slate-500" />
          <h3 className="text-lg font-bold text-white">No devices registered yet</h3>
          <p className="text-sm text-slate-400 max-w-sm mx-auto">
            Click "Register Device" to add your primary phone, backup phone, tablet, or spare phone.
          </p>
          <button
            onClick={() => setRegisterOpen(true)}
            className="px-4 py-2 bg-cyan-600 text-white text-sm font-semibold rounded-xl"
          >
            Register First Device
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              onLocate={handleLocate}
              onRing={handleRing}
              onStopRing={handleStopRing}
              onToggleLostMode={handleToggleLostMode}
              onSync={handleSync}
              onTakeSelfie={handleTakeSelfie}
              onOpenLiveCamera={(dev) => setActiveCameraDevice(dev)}
            />
          ))}
        </div>
      )}

      {/* Live Camera Stream Modal */}
      {activeCameraDevice && (
        <LiveCameraStreamModal
          device={activeCameraDevice}
          onClose={() => setActiveCameraDevice(null)}
        />
      )}

      {/* Register Device Modal */}
      {registerOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">Register New Device</h3>
            <p className="text-xs text-slate-400 mb-4">Assign a clear user-defined name for tracking</p>

            <form onSubmit={handleRegisterDevice} className="space-y-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Device Name</label>
                <input
                  type="text"
                  placeholder="e.g. My Main Phone, Spare Tablet"
                  value={newDevName}
                  onChange={(e) => setNewDevName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">Device Model</label>
                <input
                  type="text"
                  placeholder="e.g. Pixel 8, Galaxy S24"
                  value={newDevModel}
                  onChange={(e) => setNewDevModel(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setRegisterOpen(false)}
                  className="px-4 py-2 bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl hover:bg-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-xl"
                >
                  Confirm Registration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
