import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Smartphone, Battery, Wifi, Radio, Key, Trash2, ArrowLeft, RefreshCw, MapPin, Bell, BellOff, Lock, Camera, AlertTriangle, ShieldAlert, Volume2, FileText, ShieldCheck, Gauge, Video } from 'lucide-react';
import { devicesApi, commandsApi, snapshotsApi, locationsApi } from '../services/api';
import { Device, Command, Snapshot, LocationRecord } from '../types';
import { PoliceReportModal } from '../components/PoliceReportModal';
import { LiveCameraStreamModal } from '../components/LiveCameraStreamModal';

export const DeviceDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<Device | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Voice Warning Modal State
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [customVoiceText, setCustomVoiceText] = useState("Attention. This device is reported stolen and is actively tracked by police. Drop it immediately.");
  
  // Police FIR Modal State
  const [policeModalOpen, setPoliceModalOpen] = useState(false);

  // Live Camera Stream Modal State
  const [cameraModalOpen, setCameraModalOpen] = useState(false);

  const fetchDetails = async () => {
    if (!id) return;
    try {
      const dev = await devicesApi.get(id);
      setDevice(dev);
      const cmds = await commandsApi.list(id);
      setCommands(cmds);
      const snaps = await snapshotsApi.list(id);
      setSnapshots(snaps);
      const locs = await locationsApi.getHistory(id, 'today');
      setLocations(locs);
    } catch (e) {
      console.error('Failed to load device details', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [id]);

  const handleSendCommand = async (type: string, payload?: object) => {
    if (!id) return;
    try {
      await commandsApi.dispatch(id, type as any, payload);
      fetchDetails();
    } catch (e) {
      alert('Failed to dispatch command');
    }
  };

  const handleSendVoiceWarning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !customVoiceText) return;
    try {
      await commandsApi.dispatch(id, 'SPEAK_TEXT', { text: customVoiceText });
      setVoiceModalOpen(false);
      fetchDetails();
      alert('Voice warning broadcast command dispatched to device speaker!');
    } catch (e) {
      alert('Failed to dispatch voice warning');
    }
  };

  const handleToggleLostMode = async () => {
    if (!id || !device) return;
    const action = device.is_lost_mode ? 'DISABLE_LOST_MODE' : 'ENABLE_LOST_MODE';
    try {
      await commandsApi.dispatch(id, action);
      await devicesApi.update(id, { is_lost_mode: !device.is_lost_mode });
      fetchDetails();
    } catch (e) {
      alert('Failed to update lost mode');
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm('Are you sure you want to remove this device from your account?')) return;
    try {
      await devicesApi.delete(id);
      navigate('/');
    } catch (e) {
      alert('Failed to remove device');
    }
  };

  if (loading) return <div className="text-center py-20 text-slate-400">Loading device details...</div>;
  if (!device) return <div className="text-center py-20 text-slate-400">Device not found.</div>;

  const intruderAlerts = snapshots.filter(s => s.is_intruder_alert);

  // Calculate Security Threat Score (0 to 100)
  let threatScore = 95;
  if (device.is_lost_mode) threatScore -= 30;
  if (device.battery_pct <= 20) threatScore -= 25;
  if (!device.sim_status) threatScore -= 20;
  if (intruderAlerts.length > 0) threatScore -= 15;
  threatScore = Math.max(10, threatScore);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Top Bar Navigation & Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate('/')}
          className="flex items-center space-x-2 text-slate-400 hover:text-slate-200 text-sm font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Devices</span>
        </button>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setPoliceModalOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition-all"
          >
            <FileText className="w-4 h-4" />
            <span>Generate Police FIR Dossier</span>
          </button>

          <button
            onClick={handleDelete}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-semibold"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Remove Device</span>
          </button>
        </div>
      </div>

      {/* Main Info Card */}
      <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-6">
        
        {/* Device Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-700/60 pb-6">
          <div className="flex items-center space-x-4">
            <div className="p-4 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-2xl shadow-inner">
              <Smartphone className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-wide">{device.device_name}</h1>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Model: {device.device_model} • Android {device.android_version} • App v{device.app_version}
              </p>
              <p className="text-xs font-bold text-cyan-300 font-mono mt-0.5">
                SIM Number / Carrier: {device.sim_number || '+919392408017'}
              </p>
            </div>
          </div>

          {/* Threat Score & Live Status */}
          <div className="flex items-center space-x-4">
            {/* Circular Threat Assessment Widget */}
            <div className="bg-slate-900/80 border border-slate-700/80 px-4 py-2 rounded-xl text-center">
              <div className="text-[10px] text-slate-400 font-bold uppercase">Security Integrity</div>
              <div className={`text-lg font-black ${
                threatScore >= 80 ? 'text-emerald-400' : threatScore >= 50 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {threatScore}% SECURE
              </div>
            </div>

            <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${
              device.status === 'ONLINE' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
            }`}>
              {device.status}
            </span>
          </div>
        </div>

        {/* Intruder Alert Warning Card if detected */}
        {intruderAlerts.length > 0 && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center justify-between">
            <div className="flex items-center space-x-3 text-rose-300 text-xs font-bold">
              <ShieldAlert className="w-6 h-6 text-rose-400 animate-pulse" />
              <div>
                <div className="text-sm font-extrabold">INTRUDER ALERT DETECTED ({intruderAlerts.length})</div>
                <div className="text-slate-400 font-normal">Failed PIN attempts captured photo & position telemetry</div>
              </div>
            </div>
          </div>
        )}

        {/* Remote Command Center */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <Camera className="w-4 h-4 text-cyan-400" />
            <span>Remote Tactical Command Center</span>
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            <button
              onClick={() => setCameraModalOpen(true)}
              className="p-3 bg-rose-600/30 hover:bg-rose-600/40 text-rose-200 border border-rose-500/40 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-all"
            >
              <Video className="w-4 h-4 text-rose-400 animate-pulse" />
              <span>Live Stream</span>
            </button>

            <button
              onClick={() => handleSendCommand('LOCATE_NOW')}
              className="p-3 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-all"
            >
              <MapPin className="w-4 h-4" />
              <span>Locate Fix</span>
            </button>

            <button
              onClick={() => handleSendCommand('CAPTURE_SNAPSHOT')}
              className="p-3 bg-cyan-600/30 hover:bg-cyan-600/40 text-cyan-200 border border-cyan-500/40 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-all"
            >
              <Camera className="w-4 h-4 text-cyan-400" />
              <span>Take Selfie</span>
            </button>

            <button
              onClick={() => setVoiceModalOpen(true)}
              className="p-3 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-all"
            >
              <Volume2 className="w-4 h-4 text-purple-400" />
              <span>Voice Warning</span>
            </button>

            <button
              onClick={() => handleSendCommand('PLAY_ALARM')}
              className="p-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-all"
            >
              <Bell className="w-4 h-4 text-amber-400 animate-bounce" />
              <span>Start Ringing</span>
            </button>

            <button
              onClick={handleToggleLostMode}
              className={`p-3 border rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-all ${
                device.is_lost_mode
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
              }`}
            >
              <Lock className="w-4 h-4" />
              <span>{device.is_lost_mode ? 'Unlock Lost Mode' : 'Enable Lost Mode'}</span>
            </button>
          </div>
        </div>

        {/* Intruder Selfies & Camera Snapshots Gallery */}
        <div className="space-y-4 pt-4 border-t border-slate-700/60">
          <h3 className="text-sm font-bold text-white flex items-center justify-between">
            <span className="flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 text-rose-400" />
              <span>Intruder Selfies & Camera Inspection ({snapshots.length})</span>
            </span>
            <button
              onClick={fetchDetails}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-normal flex items-center space-x-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh Selfies</span>
            </button>
          </h3>

          {snapshots.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-400">
              No intruder selfies or camera snapshots captured yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {snapshots.map((snap) => (
                <div key={snap.id} className={`bg-slate-900/80 border rounded-xl p-3 space-y-2 relative overflow-hidden ${
                  snap.is_intruder_alert ? 'border-rose-500/60 ring-1 ring-rose-500/30' : 'border-slate-800'
                }`}>
                  {snap.is_intruder_alert && (
                    <div className="bg-rose-600 text-white text-[10px] font-black px-2 py-0.5 rounded tracking-wider uppercase inline-block mb-1">
                      ⚠️ INTRUDER SELFIE (3 Failed PINs)
                    </div>
                  )}

                  <div className="aspect-video bg-slate-950 rounded-lg flex items-center justify-center overflow-hidden border border-slate-800">
                    <img
                      src={snap.image_data}
                      alt="Intruder Selfie"
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="text-[11px] text-slate-400 space-y-0.5">
                    <div className="flex items-center justify-between text-slate-300 font-mono">
                      <span>{new Date(snap.timestamp).toLocaleString()}</span>
                    </div>
                    {snap.latitude && snap.longitude && (
                      <div className="text-cyan-400 font-mono text-[10px]">
                        📍 {snap.latitude.toFixed(4)}, {snap.longitude.toFixed(4)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Voice Warning Broadcast Modal */}
      {voiceModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-purple-500/40 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-2 text-purple-400 font-bold">
              <Volume2 className="w-5 h-5" />
              <h3 className="text-lg text-white">Remote Text-to-Speech Voice Warning</h3>
            </div>
            <p className="text-xs text-slate-400">
              The phone will speak this message out loud at **100% maximum volume** overriding silent/vibrate mode.
            </p>

            <form onSubmit={handleSendVoiceWarning} className="space-y-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1">Broadcast Speech Message</label>
                <textarea
                  value={customVoiceText}
                  onChange={(e) => setCustomVoiceText(e.target.value)}
                  className="w-full h-24 bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-purple-500 resize-none font-sans"
                  required
                />
              </div>

              {/* Quick Presets */}
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 uppercase font-bold">Quick Presets:</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCustomVoiceText("Attention! This phone is stolen and tracked by police. Drop it immediately.")}
                    className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1 rounded"
                  >
                    🚨 Police Warning
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomVoiceText("Help! This phone is lost. Please call 9014811203 to return to owner.")}
                    className="text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1 rounded"
                  >
                    📞 Call 9014811203
                  </button>
                </div>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setVoiceModalOpen(false)}
                  className="px-4 py-2 bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-purple-600/30"
                >
                  🔊 Speak Loudly Now
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Police FIR Report Modal */}
      {policeModalOpen && (
        <PoliceReportModal
          device={device}
          snapshots={snapshots}
          locations={locations}
          onClose={() => setPoliceModalOpen(false)}
        />
      )}

      {/* Live Camera Stream Modal */}
      {cameraModalOpen && (
        <LiveCameraStreamModal
          device={device}
          onClose={() => setCameraModalOpen(false)}
        />
      )}

    </div>
  );
};
