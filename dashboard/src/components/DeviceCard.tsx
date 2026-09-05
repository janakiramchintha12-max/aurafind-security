import React from 'react';
import { Link } from 'react-router-dom';
import { Smartphone, Battery, BatteryCharging, Wifi, WifiOff, Radio, MapPin, Bell, BellOff, RefreshCw, ChevronRight, Lock, AlertTriangle, Camera, Phone, Shield, FileText } from 'lucide-react';
import { Device } from '../types';

interface DeviceCardProps {
  device: Device;
  onLocate: (deviceId: string) => void;
  onRing: (deviceId: string) => void;
  onStopRing: (deviceId: string) => void;
  onToggleLostMode: (deviceId: string, currentLostMode: boolean) => void;
  onSync?: (deviceId: string) => void;
  onTakeSelfie?: (deviceId: string) => void;
  onOpenLiveCamera?: (device: Device) => void;
  onOpenVoiceCall?: (device: Device) => void;
  onOpenTts?: (device: Device) => void;
  onOpenPoliceReport?: (device: Device) => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({ device, onLocate, onRing, onStopRing, onToggleLostMode, onSync, onTakeSelfie, onOpenLiveCamera, onOpenVoiceCall, onOpenTts, onOpenPoliceReport }) => {
  const isOnline = device.status === 'ONLINE';

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
            className="text-[10px] bg-rose-600 hover:bg-rose-500 text-white px-2 py-0.5 rounded font-bold"
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
            <h3 className="text-base font-bold text-white tracking-wide">{device.device_name}</h3>
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
      <div className="mt-3 px-3 py-1.5 bg-slate-900/80 border border-slate-700/60 rounded-xl flex items-center justify-between text-xs font-mono">
        <span className="flex items-center space-x-1.5 text-slate-400">
          <Phone className="w-3.5 h-3.5 text-cyan-400" />
          <span>SIM Phone / Carrier:</span>
        </span>
        <span className="font-bold text-cyan-300">
          {device.sim_number || 'SIM Active'}
        </span>
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
            <div className="font-semibold text-slate-200">{device.battery_pct ?? 0}%</div>
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
            <div className="font-semibold text-slate-200">{device.gps_status ? 'ACTIVE' : 'OFF'}</div>
          </div>
        </div>
      </div>

      {/* Location info */}
      <div className="text-xs text-slate-400 space-y-1 mb-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-slate-300">
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            Last Location:
          </span>
          <span className="font-mono text-slate-300">
            {device.last_latitude && device.last_longitude
              ? `${device.last_latitude.toFixed(4)}, ${device.last_longitude.toFixed(4)}`
              : 'No location signal'}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>Last Sync:</span>
          <span>{device.last_sync_time ? new Date(device.last_sync_time).toLocaleTimeString() : 'Never'}</span>
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
          onClick={() => onOpenLiveCamera && onOpenLiveCamera(device)}
          className="flex items-center justify-center space-x-1 py-1.5 bg-rose-600/30 hover:bg-rose-600/40 text-rose-200 border border-rose-500/40 rounded-lg text-xs font-bold transition-all"
        >
          <Camera className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
          <span>Live Stream</span>
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
    </div>
  );
};
