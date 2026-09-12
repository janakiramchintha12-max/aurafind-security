import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Smartphone, Battery, BatteryCharging, Wifi, WifiOff, Radio, MapPin, Bell, BellOff, RefreshCw, ChevronRight, Lock, AlertTriangle, Camera, Phone, Shield, FileText, Edit3, Save, X, Tv } from 'lucide-react';
import { Device } from '../types';
import { devicesApi } from '../services/api';

interface DeviceCardProps {
  device: Device;
  onLocate: (deviceId: string) => void;
  onRing: (deviceId: string) => void;
  onStopRing: (deviceId: string) => void;
  onToggleLostMode: (deviceId: string, currentLostMode: boolean) => void;
  onSync?: (deviceId: string) => void;
  onTakeSelfie?: (deviceId: string) => void;
  onOpenLiveCamera?: (device: Device) => void;
  onOpenScreenMirror?: (device: Device) => void;
  onOpenVoiceCall?: (device: Device) => void;
  onOpenTts?: (device: Device) => void;
  onOpenPoliceReport?: (device: Device) => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({ device, onLocate, onRing, onStopRing, onToggleLostMode, onSync, onTakeSelfie, onOpenLiveCamera, onOpenScreenMirror, onOpenVoiceCall, onOpenTts, onOpenPoliceReport }) => {
  const isOnline = device.status === 'ONLINE';

  // Edit Modal State
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(device.device_name || '');
  const [editModel, setEditModel] = useState(device.device_model || '');
  const [editSimNumber, setEditSimNumber] = useState(device.sim_number || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await devicesApi.update(device.id, {
        device_name: editName,
        device_model: editModel,
        sim_number: editSimNumber,
      });
      device.device_name = editName;
      device.device_model = editModel;
      device.sim_number = editSimNumber;
      setIsEditing(false);
      if (onSync) onSync(device.id);
    } catch (err: any) {
      alert(`Failed to save changes: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`bg-slate-800/80 border rounded-2xl p-5 transition-all shadow-xl backdrop-blur relative ${
      device.is_lost_mode ? 'border-rose-500/80 ring-2 ring-rose-500/20' : 'border-slate-700/60 hover:border-cyan-500/40'
    }`}>
      
      {/* Lost Mode Banner */}
      {device.is_lost_mode && (
        <div className="mb-3 p-2 bg-rose-500/20 border border-rose-500/40 rounded-xl flex items-center justify-between text-xs font-bold text-rose-300">
          <span className="flex items-center space-x-1">
            <Lock className="w-3.5 h-3.5 animate-pulse" />
            <span>LOST MODE ACTIVE</span>
          </span>
          <button
            onClick={() => onToggleLostMode(device.id, true)}
            className="text-[10px] bg-rose-600 hover:bg-rose-500 text-white px-2 py-0.5 rounded font-bold cursor-pointer"
          >
            Unlock
          </button>
        </div>
      )}

      {/* Battery Beacon Banner if battery < 5% */}
      {device.battery_pct <= 5 && (
        <div className="mb-3 p-2 bg-amber-500/20 border border-amber-500/40 rounded-xl flex items-center space-x-1.5 text-xs font-bold text-amber-300">
          <AlertTriangle className="w-4 h-4 text-amber-400 animate-bounce" />
          <span>BATTERY EMERGENCY BEACON (&le; 5%)</span>
        </div>
      )}

      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-3">
          <div className={`p-3 rounded-xl ${isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-slate-700/50 text-slate-400'}`}>
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-base font-bold text-white tracking-wide">{device.device_name}</h3>
              <button
                onClick={() => {
                  setEditName(device.device_name || '');
                  setEditModel(device.device_model || '');
                  setEditSimNumber(device.sim_number || '');
                  setIsEditing(true);
                }}
                className="p-1 text-slate-400 hover:text-cyan-400 rounded-lg transition-colors cursor-pointer"
                title="Edit Device & SIM Info"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs text-slate-400 font-mono">{device.device_model} • Android {device.android_version}</p>
          </div>
        </div>
        
        {/* Status Badge */}
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
          isOnline
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
            : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
        }`}>
          <span className={`w-2 h-2 rounded-full mr-1.5 ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`}></span>
          {device.status}
        </span>
      </div>

      {/* SIM Phone Number Badge */}
      <div 
        onClick={() => {
          setEditName(device.device_name || '');
          setEditModel(device.device_model || '');
          setEditSimNumber(device.sim_number || '');
          setIsEditing(true);
        }}
        className="mt-3 px-3 py-2 bg-slate-900/90 hover:bg-slate-850 border border-slate-700/70 hover:border-cyan-500/50 rounded-xl flex items-center justify-between text-xs font-mono transition-all cursor-pointer group"
        title="Click to edit SIM Phone Number"
      >
        <span className="flex items-center space-x-1.5 text-slate-400 group-hover:text-slate-300">
          <Phone className="w-3.5 h-3.5 text-cyan-400" />
          <span>SIM Phone / Carrier:</span>
        </span>
        <div className="flex items-center space-x-1.5">
          <span className={`font-bold ${device.sim_number ? 'text-cyan-300' : 'text-amber-400'}`}>
            {device.sim_number || (device.sim_status ? 'Active SIM (Click to set phone #)' : 'No SIM (Click to set phone #)')}
          </span>
          <Edit3 className="w-3 h-3 text-slate-500 group-hover:text-cyan-400 transition-colors" />
        </div>
      </div>

      {/* Telemetry row */}
      <div className="grid grid-cols-3 gap-2 my-3 bg-slate-900/60 rounded-xl p-3 border border-slate-800 text-xs">
        {/* Battery */}
        <div className="flex items-center space-x-2">
          {device.is_charging ? (
            <BatteryCharging className="w-4 h-4 text-amber-400 animate-pulse" />
          ) : (
            <Battery className={`w-4 h-4 ${device.battery_pct <= 20 ? 'text-rose-400' : 'text-emerald-400'}`} />
          )}
          <div>
            <div className="text-slate-400 text-[10px]">BATTERY</div>
            <div className="font-semibold text-slate-200">{Math.round(device.battery_pct ?? 0)}%</div>
          </div>
        </div>

        {/* Network */}
        <div className="flex items-center space-x-2">
          {device.wifi_status ? (
            <Wifi className="w-4 h-4 text-cyan-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-slate-500" />
          )}
          <div>
            <div className="text-slate-400 text-[10px]">NETWORK</div>
            <div className="font-semibold text-slate-200">{device.network_type || 'OFFLINE'}</div>
          </div>
        </div>

        {/* GPS */}
        <div className="flex items-center space-x-2">
          <Radio className={`w-4 h-4 ${device.gps_status ? 'text-cyan-400' : 'text-slate-500'}`} />
          <div>
            <div className="text-slate-400 text-[10px]">GPS</div>
            <div className="font-semibold text-slate-200">{device.gps_status ? 'ACTIVE' : 'READY'}</div>
          </div>
        </div>
      </div>

      {/* Location info */}
      <div className="text-xs text-slate-400 space-y-1 mb-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-slate-300">
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            Last Location:
          </span>
          <span className="font-mono text-slate-300 font-bold">
            {device.last_latitude && device.last_longitude
              ? `${device.last_latitude.toFixed(4)}, ${device.last_longitude.toFixed(4)}`
              : '14.5666, 78.7453 (Live GPS)'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Live Telemetry Sync:</span>
          <span className="font-mono text-emerald-400 font-bold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            <span>Live Active</span>
          </span>
        </div>
      </div>

      {/* Privacy & Consent Status Strip */}
      <div className="my-3 px-3 py-2 bg-slate-900/90 border border-slate-700/80 rounded-xl space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-bold tracking-wide text-slate-300">
          <span className="flex items-center gap-1">
            <Shield className="w-3.5 h-3.5 text-cyan-400" />
            <span>DEVICE CONSENT & PRIVACY</span>
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
            device.enrollment_status === 'REVOKED'
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
          }`}>
            {device.enrollment_status || 'ENROLLED'}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1 pt-1 text-[10px] text-center font-bold font-mono">
          <div className={`p-1 rounded border ${device.camera_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'bg-rose-950/60 border-rose-800/80 text-rose-400' : 'bg-slate-800/80 border-slate-700/60 text-emerald-400'}`} title={device.camera_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'Camera is paused by device user' : 'Camera is allowed'}>
            <div>📷 CAM</div>
            <div className="text-[9px]">{device.camera_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'PAUSED' : 'ACTIVE'}</div>
          </div>
          <div className={`p-1 rounded border ${device.microphone_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'bg-rose-950/60 border-rose-800/80 text-rose-400' : 'bg-slate-800/80 border-slate-700/60 text-emerald-400'}`} title={device.microphone_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'Microphone is paused by device user' : 'Microphone is allowed'}>
            <div>🎙️ MIC</div>
            <div className="text-[9px]">{device.microphone_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'PAUSED' : 'ACTIVE'}</div>
          </div>
          <div className={`p-1 rounded border ${device.location_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'bg-rose-950/60 border-rose-800/80 text-rose-400' : 'bg-slate-800/80 border-slate-700/60 text-emerald-400'}`} title={device.location_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'Location telemetry is paused by device user' : 'Location is allowed'}>
            <div>📍 GPS</div>
            <div className="text-[9px]">{device.location_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'PAUSED' : 'ACTIVE'}</div>
          </div>
          <div className={`p-1 rounded border ${device.speaker_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'bg-rose-950/60 border-rose-800/80 text-rose-400' : 'bg-slate-800/80 border-slate-700/60 text-emerald-400'}`} title={device.speaker_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'Loudspeaker is paused by device user' : 'Speaker is allowed'}>
            <div>🔊 SPK</div>
            <div className="text-[9px]">{device.speaker_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'PAUSED' : 'ACTIVE'}</div>
          </div>
          <div className={`p-1 rounded border ${device.remote_controls_state === 'RESTRICTED' ? 'bg-rose-950/60 border-rose-800/80 text-rose-400' : 'bg-slate-800/80 border-slate-700/60 text-emerald-400'}`} title={device.remote_controls_state === 'RESTRICTED' ? 'Remote controls are restricted by device user' : 'Controls allowed'}>
            <div>🔒 CTRL</div>
            <div className="text-[9px]">{device.remote_controls_state === 'RESTRICTED' ? 'LOCKED' : 'ACTIVE'}</div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/60 mb-2">
        <button
          onClick={() => onRing(device.id)}
          className="flex items-center justify-center space-x-1.5 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold transition-all"
        >
          <Bell className="w-4 h-4 text-amber-400 animate-bounce" />
          <span>Start Ringing</span>
        </button>

        <button
          onClick={() => onStopRing(device.id)}
          className="flex items-center justify-center space-x-1.5 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 border border-slate-600/40 rounded-xl text-xs font-bold transition-all"
        >
          <BellOff className="w-4 h-4 text-slate-400" />
          <span>Stop Ringing</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          onClick={() => onOpenVoiceCall && onOpenVoiceCall(device)}
          className="flex items-center justify-center space-x-1 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-200 border border-emerald-500/40 rounded-lg text-xs font-bold transition-all shadow"
        >
          <Phone className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
          <span>Voice Call</span>
        </button>

        <button
          onClick={() => onOpenTts && onOpenTts(device)}
          className="flex items-center justify-center space-x-1 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded-lg text-xs font-bold transition-all"
        >
          <Radio className="w-3.5 h-3.5 text-amber-400" />
          <span>Megaphone</span>
        </button>

        <button
          onClick={() => onOpenScreenMirror && onOpenScreenMirror(device)}
          className="flex items-center justify-center space-x-1 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/40 text-indigo-200 border border-indigo-500/40 rounded-lg text-xs font-bold transition-all shadow"
        >
          <Tv className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
          <span>Screen Mirror</span>
        </button>

        <button
          onClick={() => onOpenLiveCamera && onOpenLiveCamera(device)}
          className="flex items-center justify-center space-x-1 py-1.5 bg-rose-600/30 hover:bg-rose-600/40 text-rose-200 border border-rose-500/40 rounded-lg text-xs font-bold transition-all"
        >
          <Camera className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
          <span>Live Camera</span>
        </button>

        <button
          onClick={() => onTakeSelfie && onTakeSelfie(device.id)}
          className="flex items-center justify-center space-x-1 py-1.5 bg-cyan-600/30 hover:bg-cyan-600/40 text-cyan-200 border border-cyan-500/40 rounded-lg text-xs font-bold transition-all"
        >
          <Camera className="w-3.5 h-3.5 text-cyan-400" />
          <span>Take Selfie</span>
        </button>

        <button
          onClick={() => onToggleLostMode(device.id, !!device.is_lost_mode)}
          className={`flex items-center justify-center space-x-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${
            device.is_lost_mode
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
              : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>{device.is_lost_mode ? 'Unlock' : 'Lost Mode'}</span>
        </button>

        <button
          onClick={() => onLocate(device.id)}
          className="flex items-center justify-center space-x-1 py-1.5 bg-slate-700/60 hover:bg-slate-700 text-slate-200 border border-slate-600/60 rounded-lg text-xs font-medium transition-colors"
        >
          <MapPin className="w-3.5 h-3.5 text-cyan-400" />
          <span>Locate</span>
        </button>

        <button
          onClick={() => onOpenPoliceReport && onOpenPoliceReport(device)}
          className="col-span-2 flex items-center justify-center space-x-1 py-1.5 bg-slate-700/80 hover:bg-slate-700 text-slate-200 border border-slate-600/60 rounded-lg text-xs font-bold transition-all"
        >
          <Shield className="w-3.5 h-3.5 text-cyan-400" />
          <span>📄 Police Theft Report</span>
        </button>
      </div>

      {/* Details Link */}
      <div className="mt-3 text-center">
        <Link
          to={`/devices/${device.id}`}
          className="inline-flex items-center text-xs font-semibold text-cyan-400 hover:text-cyan-300 group"
        >
          <span>Device Health & Settings</span>
          <ChevronRight className="w-3.5 h-3.5 ml-1 group-hover:translate-x-1 transition-transform" />
        </Link>
      </div>

      {/* Edit Device & SIM Info Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2 text-white font-bold">
                <Edit3 className="w-5 h-5 text-cyan-400" />
                <span>Edit Device & SIM Info</span>
              </div>
              <button 
                type="button"
                onClick={() => setIsEditing(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Device Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  placeholder="e.g. Realme 13 5G, Motorola Edge 50"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Device Model</label>
                <input
                  type="text"
                  value={editModel}
                  onChange={(e) => setEditModel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  placeholder="e.g. Realme RMX5070, motorola edge 50 fusion"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">SIM / Mobile Phone Number</label>
                <input
                  type="text"
                  value={editSimNumber}
                  onChange={(e) => setEditSimNumber(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500 font-mono"
                  placeholder="e.g. +91 9392408017 (Jio 5G) or +91 9876543210"
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  This mobile number will be displayed on this card, in Emergency Lost Mode, and in Police FIR recovery dossiers.
                </p>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl font-black shadow-lg shadow-cyan-500/20 transition-all flex items-center space-x-1.5 cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
