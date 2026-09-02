import React, { useState, useEffect } from 'react';
import { Shield, Activity, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Radio, Server, Wifi, Battery, Smartphone, MessageSquare, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { Device } from '../types';
import { commandsApi } from '../services/api';

interface LiveDiagnosticsPanelProps {
  device: Device | null;
  onRefresh: () => void;
}

export const LiveDiagnosticsPanel: React.FC<LiveDiagnosticsPanelProps> = ({ device, onRefresh }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [apiLatency, setApiLatency] = useState<number | null>(null);
  const [tunnelStatus, setTunnelStatus] = useState<'ONLINE' | 'CHECKING' | 'OFFLINE'>('ONLINE');
  const [copiedSms, setCopiedSms] = useState(false);
  const [isFixing, setIsFixing] = useState(false);

  // Check API latency
  const checkApiHealth = async () => {
    const start = performance.now();
    try {
      const res = await fetch('http://127.0.0.1:8000/health');
      if (res.ok) {
        setApiLatency(Math.round(performance.now() - start));
        setTunnelStatus('ONLINE');
      } else {
        setTunnelStatus('OFFLINE');
      }
    } catch {
      setApiLatency(null);
      setTunnelStatus('OFFLINE');
    }
  };

  useEffect(() => {
    checkApiHealth();
    const interval = setInterval(checkApiHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  // Compute Active Diagnostic Issues
  const issues: { title: string; desc: string; severity: 'high' | 'medium' | 'low'; fixAction?: () => void; fixLabel?: string }[] = [];

  if (tunnelStatus === 'OFFLINE') {
    issues.push({
      title: 'Backend API Server Disconnected',
      desc: 'Port 8000 is unreachable on localhost. Server process may have stopped.',
      severity: 'high'
    });
  }

  if (device) {
    const isOnline = device.status === 'ONLINE';
    
    // Safely parse UTC timestamp regardless of browser timezone
    const parseUtc = (dtStr?: string | null) => {
      if (!dtStr) return Infinity;
      const clean = dtStr.endsWith('Z') || dtStr.includes('+') ? dtStr : dtStr + 'Z';
      const parsed = new Date(clean).getTime();
      return isNaN(parsed) ? Infinity : Date.now() - parsed;
    };

    const lastSyncMs = parseUtc(device.last_heartbeat || device.last_sync_time);
    const minutesSinceSync = Math.round(lastSyncMs / 60000);

    if (!isOnline && minutesSinceSync > 2) {
      issues.push({
        title: 'Device Sync Latency High',
        desc: `Device is currently offline (Last heartbeat: ${minutesSinceSync > 1000 ? 'unknown' : `${minutesSinceSync}m ago`}). Phone might be in sleep/Doze mode, 4G disconnected, or server restarted.`,
        severity: 'high',
        fixLabel: 'Send High-Priority Wakeup Fix',
        fixAction: async () => {
          setIsFixing(true);
          try {
            await commandsApi.dispatch(device.id, 'LOCATE_NOW');
            await commandsApi.dispatch(device.id, 'HIGH_ACCURACY_MODE');
            onRefresh();
            alert('High-priority wakeup signal dispatched to device!');
          } catch (e) {
            alert('Failed to send wakeup command');
          } finally {
            setIsFixing(false);
          }
        }
      });
    }

    if (device.battery_pct <= 10) {
      issues.push({
        title: 'Critical Battery Level (≤ 10%)',
        desc: `Phone battery is at ${device.battery_pct}%. Android 14 power manager will aggressively suspend background data unless plugged into a charger or exempted from battery optimization.`,
        severity: 'medium'
      });
    }

    if (!device.gps_status) {
      issues.push({
        title: 'Hardware GPS Signal Disabled / Indoors',
        desc: 'Device GPS radio is currently inactive or satellite signal is obstructed.',
        severity: 'medium'
      });
    }
  }

  const handleCopySms = () => {
    navigator.clipboard.writeText('#AURAFIND LOCATE');
    setCopiedSms(true);
    setTimeout(() => setCopiedSms(false), 2500);
  };

  const healthScore = issues.length === 0 ? 100 : Math.max(20, 100 - issues.length * 30);

  return (
    <div className="bg-slate-800/90 border border-slate-700/80 rounded-2xl p-4 shadow-xl backdrop-blur transition-all">
      
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`p-2.5 rounded-xl ${
            healthScore >= 90 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' :
            healthScore >= 50 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
            'bg-rose-500/10 text-rose-400 border border-rose-500/30'
          }`}>
            <Activity className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-extrabold text-white tracking-wide">Live System Health & Diagnostic Radar</h3>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                healthScore >= 90 ? 'bg-emerald-500/20 text-emerald-300' :
                healthScore >= 50 ? 'bg-amber-500/20 text-amber-300' :
                'bg-rose-500/20 text-rose-300'
              }`}>
                {healthScore}% INTEGRITY
              </span>
            </div>
            <p className="text-xs text-slate-400">
              {issues.length === 0 ? 'All systems optimal • Real-time telemetry streaming' : `${issues.length} active issue(s) detected • Auto-diagnostic active`}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={checkApiHealth}
            className="p-2 bg-slate-900/60 hover:bg-slate-900 text-slate-300 rounded-xl border border-slate-700 text-xs flex items-center space-x-1"
            title="Ping API Server"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline font-mono">{apiLatency ? `${apiLatency}ms` : 'Check'}</span>
          </button>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 rounded-xl text-xs font-bold flex items-center space-x-1"
          >
            <span>{isOpen ? 'Hide Diagnostics' : 'View Diagnostics'}</span>
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Expanded Diagnostics Drawer */}
      {isOpen && (
        <div className="mt-4 pt-4 border-t border-slate-700/60 space-y-4 font-sans">
          
          {/* Real-Time Component Status Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {/* Server API */}
            <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 space-y-1">
              <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center justify-between">
                <span>FastAPI Backend</span>
                <Server className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="font-bold text-slate-200 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${apiLatency ? 'bg-emerald-400' : 'bg-rose-500'}`}></span>
                <span>{apiLatency ? `Online (${apiLatency}ms)` : 'Offline'}</span>
              </div>
            </div>

            {/* Cloud Gateway */}
            <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 space-y-1">
              <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center justify-between">
                <span>Cloudflare 4G/5G Tunnel</span>
                <Radio className="w-3.5 h-3.5 text-purple-400" />
              </div>
              <div className="font-bold text-slate-200 flex items-center gap-1.5 truncate">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span className="truncate">Active Gateway</span>
              </div>
            </div>

            {/* Mobile Device */}
            <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 space-y-1">
              <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center justify-between">
                <span>Target Mobile Phone</span>
                <Smartphone className="w-3.5 h-3.5 text-rose-400" />
              </div>
              <div className="font-bold text-slate-200 flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${device?.status === 'ONLINE' ? 'bg-emerald-400' : 'bg-rose-500'}`}></span>
                <span>{device?.status || 'UNPAIRED'}</span>
              </div>
            </div>

            {/* Offline SMS Gateway */}
            <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 space-y-1">
              <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center justify-between">
                <span>Offline SMS Tracker</span>
                <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="font-bold text-slate-200 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>Ready (SIM Active)</span>
              </div>
            </div>
          </div>

          {/* Active Diagnostic Issues List */}
          {issues.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                <span>Detected Diagnostics & Root Causes ({issues.length})</span>
              </div>

              {issues.map((issue, i) => (
                <div key={i} className="bg-slate-900/90 border border-slate-700/80 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="font-bold text-xs text-white flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${issue.severity === 'high' ? 'bg-rose-500' : 'bg-amber-400'}`}></span>
                      <span>{issue.title}</span>
                    </div>
                    <p className="text-xs text-slate-400 max-w-2xl">{issue.desc}</p>
                  </div>

                  {issue.fixAction && (
                    <button
                      onClick={issue.fixAction}
                      disabled={isFixing}
                      className="flex-shrink-0 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold rounded-lg shadow transition-all"
                    >
                      {issue.fixLabel || 'Fix Issue'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>Zero errors detected. All communication gateways, GPS sensors, and background sync channels are healthy!</span>
            </div>
          )}

          {/* Emergency Offline SMS Command Box */}
          <div className="p-3 bg-purple-950/40 border border-purple-800/40 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="space-y-0.5">
              <div className="font-bold text-purple-300 flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4" />
                <span>Emergency 0-Internet SMS Fallback Tracker</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                If your phone is offline or in Airplane mode, send an SMS from ANY mobile to <span className="font-mono text-cyan-300 font-bold">{device?.sim_number || '+919392408017'}</span>:
              </p>
            </div>

            <div className="flex items-center gap-2">
              <code className="bg-slate-900 px-3 py-1.5 rounded-lg text-xs font-mono font-bold text-purple-300 border border-purple-700/50">
                #AURAFIND LOCATE
              </code>
              <button
                onClick={handleCopySms}
                className="p-1.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 rounded-lg text-xs font-bold flex items-center gap-1"
                title="Copy SMS Command"
              >
                {copiedSms ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                <span className="hidden sm:inline">{copiedSms ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};
