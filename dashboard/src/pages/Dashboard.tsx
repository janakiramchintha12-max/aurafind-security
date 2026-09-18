import React, { useState, useEffect } from 'react';
import { 
  Plus, RefreshCw, Smartphone, ShieldCheck, AlertTriangle, 
  Download, QrCode, Shield, Compass, Video, Volume2, Key, Radio 
} from 'lucide-react';
import { devicesApi, commandsApi, connectWebSocket } from '../services/api';
import { Device } from '../types';
import { DeviceCard } from '../components/DeviceCard';
import { DeviceEnrollmentModal } from '../components/DeviceEnrollmentModal';
import { LiveCameraStreamModal } from '../components/LiveCameraStreamModal';
import { LiveScreenMirrorModal } from '../components/LiveScreenMirrorModal';
import { VoiceCallModal } from '../components/VoiceCallModal';
import { TtsVoiceModal } from '../components/TtsVoiceModal';
import { PoliceReportModal } from '../components/PoliceReportModal';
import { LiveDiagnosticsPanel } from '../components/LiveDiagnosticsPanel';

export const DashboardPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [enrollmentDevice, setEnrollmentDevice] = useState<Device | null>(null);
  const [activeCameraDevice, setActiveCameraDevice] = useState<Device | null>(null);
  const [activeScreenMirrorDevice, setActiveScreenMirrorDevice] = useState<Device | null>(null);
  const [activeVoiceDevice, setActiveVoiceDevice] = useState<Device | null>(null);
  const [activeTtsDevice, setActiveTtsDevice] = useState<Device | null>(null);
  const [activeReportDevice, setActiveReportDevice] = useState<Device | null>(null);
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

    // Live auto-polling every 3 seconds to keep all numbers and telemetry fresh
    const pollInterval = setInterval(() => {
      fetchDevices();
    }, 3000);

    const cleanupWs = connectWebSocket((eventData) => {
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

    return () => {
      clearInterval(pollInterval);
      cleanupWs();
    };
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

  const handleOpenEnrollment = (dev: Device | null = null) => {
    setEnrollmentDevice(dev);
    setEnrollmentOpen(true);
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
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition-all cursor-pointer"
            title="Refresh Devices"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          
          <button
            onClick={() => handleOpenEnrollment(null)}
            className="flex items-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-semibold rounded-xl text-sm shadow-lg shadow-cyan-600/30 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Pair New Device</span>
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
        <div className="space-y-6">
          {/* Hero Welcome Banner */}
          <div className="bg-gradient-to-br from-slate-800/90 via-slate-900/90 to-cyan-950/40 border border-slate-700/80 rounded-3xl p-8 sm:p-10 shadow-2xl backdrop-blur relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>
            
            <div className="max-w-2xl space-y-4 relative z-10">
              <div className="inline-flex items-center space-x-2 px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded-full text-cyan-400 text-xs font-bold">
                <Shield className="w-3.5 h-3.5" />
                <span>Next-Gen Anti-Theft & Handset Security</span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                Protect & Track Your Handset in Real-Time
              </h2>

              <p className="text-slate-300 text-xs sm:text-sm leading-relaxed">
                Connect your personal Android phone, family devices, or backup phones to monitor live GPS satellite location, stream dual cameras in HD, mirror screen, and sound loud anti-theft alarms.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={() => handleOpenEnrollment(null)}
                  className="px-6 py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs sm:text-sm rounded-xl shadow-xl shadow-cyan-600/30 transition-all flex items-center space-x-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Pair First Android Device</span>
                </button>

                <a
                  href="/download/app.apk"
                  download="AuraFind-Security.apk"
                  className="px-5 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs sm:text-sm rounded-xl transition-all flex items-center space-x-2"
                >
                  <Download className="w-4 h-4 text-cyan-400" />
                  <span>Download APK Client</span>
                </a>
              </div>
            </div>
          </div>

          {/* 3 Simple Setup Steps */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-5 space-y-2.5">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-400 font-black text-xs flex items-center justify-center">
                1
              </div>
              <h3 className="text-sm font-bold text-white">Install Handset APK</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Download and install the lightweight APK client on your Android device (Android 8 to Android 14).
              </p>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-5 space-y-2.5">
              <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-400 font-black text-xs flex items-center justify-center">
                2
              </div>
              <h3 className="text-sm font-bold text-white">Scan Pairing QR Code</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Click "Pair First Android Device" above to generate your instant QR code and pairing credentials.
              </p>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-5 space-y-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 font-black text-xs flex items-center justify-center">
                3
              </div>
              <h3 className="text-sm font-bold text-white">Continuous Protection</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Receive live GPS fixes, intruder selfies upon wrong PINs, remote siren override, and route history.
              </p>
            </div>
          </div>
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
              onOpenScreenMirror={(dev) => setActiveScreenMirrorDevice(dev)}
              onOpenVoiceCall={(dev) => setActiveVoiceDevice(dev)}
              onOpenTts={(dev) => setActiveTtsDevice(dev)}
              onOpenPoliceReport={(dev) => setActiveReportDevice(dev)}
              onOpenPairing={(dev) => handleOpenEnrollment(dev)}
            />
          ))}
        </div>
      )}

      {/* Live Screen Mirror Modal */}
      {activeScreenMirrorDevice && (
        <LiveScreenMirrorModal
          device={activeScreenMirrorDevice}
          onClose={() => setActiveScreenMirrorDevice(null)}
        />
      )}

      {/* Live Camera Stream Modal */}
      {activeCameraDevice && (
        <LiveCameraStreamModal
          device={activeCameraDevice}
          onClose={() => setActiveCameraDevice(null)}
        />
      )}

      {/* Two-Way Voice Call Intercom Modal */}
      {activeVoiceDevice && (
        <VoiceCallModal
          device={activeVoiceDevice}
          onClose={() => setActiveVoiceDevice(null)}
        />
      )}

      {/* Remote Voice Megaphone Modal */}
      {activeTtsDevice && (
        <TtsVoiceModal
          device={activeTtsDevice}
          onClose={() => setActiveTtsDevice(null)}
        />
      )}

      {/* Police & Insurance Theft Report Modal */}
      {activeReportDevice && (
        <PoliceReportModal
          device={activeReportDevice}
          onClose={() => setActiveReportDevice(null)}
        />
      )}

      {/* Device Enrollment / Pairing Modal */}
      <DeviceEnrollmentModal
        isOpen={enrollmentOpen}
        initialDevice={enrollmentDevice}
        onClose={() => {
          setEnrollmentOpen(false);
          setEnrollmentDevice(null);
        }}
        onSuccess={() => {
          fetchDevices();
        }}
      />

    </div>
  );
};
