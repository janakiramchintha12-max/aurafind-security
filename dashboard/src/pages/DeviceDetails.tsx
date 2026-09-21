import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Smartphone, Battery, Wifi, Radio, Key, Trash2, ArrowLeft, RefreshCw, MapPin, Bell, BellOff, Lock, Camera, AlertTriangle, ShieldAlert, Volume2, FileText, ShieldCheck, Gauge, Video, Edit3, Save, X, Phone, QrCode, BarChart3, MessageSquare, Clock, Film, Download, Play, Disc, Square } from 'lucide-react';
import { devicesApi, commandsApi, snapshotsApi, locationsApi, parentalApi, videoApi, audioApi } from '../services/api';
import { Device, Command, Snapshot, LocationRecord, VideoRecording, AudioRecording } from '../types';
import { PoliceReportModal } from '../components/PoliceReportModal';
import { LiveCameraStreamModal } from '../components/LiveCameraStreamModal';
import { DeviceEnrollmentModal } from '../components/DeviceEnrollmentModal';

export const DeviceDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [device, setDevice] = useState<Device | null>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [appUsage, setAppUsage] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [pairingModalOpen, setPairingModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Edit Device & SIM State
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editSimNumber, setEditSimNumber] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  // Voice Warning Modal State
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [customVoiceText, setCustomVoiceText] = useState("Attention. This device is reported stolen and is actively tracked by police. Drop it immediately.");
  
  // Police FIR Modal State
  const [policeModalOpen, setPoliceModalOpen] = useState(false);

  // Live Camera Stream Modal State
  const [cameraModalOpen, setCameraModalOpen] = useState(false);

  // ── Video & Audio Recordings State ──────────────────────────────────────────
  const [videoRecordings, setVideoRecordings] = useState<VideoRecording[]>([]);
  const [audioRecordings, setAudioRecordings] = useState<AudioRecording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(false);
  const [activeVideo, setActiveVideo] = useState<VideoRecording | null>(null);
  const [activeVideoBlobUrl, setActiveVideoBlobUrl] = useState('');
  const [activeAudio, setActiveAudio] = useState<AudioRecording | null>(null);
  const [activeAudioBlobUrl, setActiveAudioBlobUrl] = useState('');
  const [mediaTab, setMediaTab] = useState<'VIDEO' | 'AUDIO'>('VIDEO');

  // Recording controls state
  const [recordDuration, setRecordDuration] = useState(300); // 5 min default
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingCountdown, setRecordingCountdown] = useState<number | null>(null);
  const [recordTimerRef, setRecordTimerRef] = useState<any>(null);
  const [recordFacing, setRecordFacing] = useState<'FRONT' | 'BACK'>('BACK');

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

      try {
        const usageRes = await parentalApi.getAppUsage(id);
        setAppUsage(usageRes?.has_report ? usageRes.report : null);
      } catch (e) {
        // App usage telemetry not pushed yet
      }

      try {
        const notifRes = await parentalApi.getNotifications(id);
        const notifList = Array.isArray(notifRes) ? notifRes : (notifRes?.notifications || []);
        setNotifications(notifList);
      } catch (e) {
        // Notifications stream not pushed yet
      }
    } catch (e) {
      console.error('Failed to load device details', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetails();
  }, [id]);

  // ── Recordings helpers ──────────────────────────────────────────────────────
  const getBlobUrl = (data: string, mimeType: string): string => {
    try {
      let base64 = data;
      let mime = mimeType;
      if (data.startsWith('data:')) {
        const parts = data.split('base64,');
        if (parts.length === 2) { mime = parts[0].replace('data:', '').replace(';', '') || mime; base64 = parts[1]; }
      }
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch (e) { return data; }
  };

  const fetchRecordings = async () => {
    if (!id) return;
    setLoadingRecordings(true);
    try {
      const [vids, auds] = await Promise.all([
        videoApi.listRecordings(id).catch(() => [] as VideoRecording[]),
        audioApi.listRecordings(id).catch(() => [] as AudioRecording[]),
      ]);
      setVideoRecordings(vids);
      setAudioRecordings(auds);
      if (vids.length > 0 && !activeVideo) setActiveVideo(vids[0]);
      if (auds.length > 0 && !activeAudio) setActiveAudio(auds[0]);
    } catch (e) {
      console.error('Failed to load recordings', e);
    } finally {
      setLoadingRecordings(false);
    }
  };

  useEffect(() => { fetchRecordings(); }, [id]);

  useEffect(() => {
    if (activeVideo) {
      const url = getBlobUrl(activeVideo.video_data, activeVideo.mime_type);
      setActiveVideoBlobUrl(url);
      return () => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); };
    } else { setActiveVideoBlobUrl(''); }
  }, [activeVideo]);

  useEffect(() => {
    if (activeAudio) {
      const url = getBlobUrl(activeAudio.audio_data, activeAudio.mime_type);
      setActiveAudioBlobUrl(url);
      return () => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); };
    } else { setActiveAudioBlobUrl(''); }
  }, [activeAudio]);

  const formatDuration = (s: number): string => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), rem = s % 60;
    if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
    const h = Math.floor(m / 60), remM = m % 60;
    return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
  };

  const formatTimer = (secs: number): string => {
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStartRecording = async () => {
    if (!id) return;
    try {
      setIsRecording(true);
      setRecordingSeconds(0);
      setRecordingCountdown(recordDuration);
      await commandsApi.dispatch(id, 'START_VIDEO_RECORDING', { facing: recordFacing, duration_seconds: recordDuration, max_duration: recordDuration });
      const timer = setInterval(() => {
        setRecordingSeconds(s => s + 1);
        setRecordingCountdown(c => {
          if (c !== null && c > 1) return c - 1;
          clearInterval(timer);
          setIsRecording(false);
          setRecordingCountdown(null);
          setTimeout(() => fetchRecordings(), 4000);
          return 0;
        });
      }, 1000);
      setRecordTimerRef(timer);
    } catch (e: any) {
      alert(`Failed to start recording: ${e?.response?.data?.detail || e.message}`);
      setIsRecording(false);
    }
  };

  const handleStopRecording = async () => {
    if (!id) return;
    try {
      await commandsApi.dispatch(id, 'STOP_VIDEO_RECORDING');
      if (recordTimerRef) clearInterval(recordTimerRef);
      setIsRecording(false);
      setRecordingSeconds(0);
      setRecordingCountdown(null);
      setTimeout(() => fetchRecordings(), 4000);
    } catch (e: any) {
      alert(`Failed to stop recording: ${e?.response?.data?.detail || e.message}`);
    }
  };

  const handleDownloadVideo = (rec: VideoRecording) => {
    const url = getBlobUrl(rec.video_data, rec.mime_type);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date(rec.created_at).toISOString().slice(0, 10);
    a.download = `AuraFind_${device?.device_name.replace(/[^a-zA-Z0-9]/g, '_')}_${rec.facing}_${Math.round(rec.duration_seconds)}s_${d}.mp4`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleDownloadAudio = (rec: AudioRecording) => {
    const url = getBlobUrl(rec.audio_data, rec.mime_type);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date(rec.created_at).toISOString().slice(0, 10);
    const ext = rec.mime_type?.includes('mp4') ? 'mp4' : rec.mime_type?.includes('wav') ? 'wav' : 'mp3';
    a.download = `AuraFind_Audio_${Math.round(rec.duration_seconds)}s_${d}.${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleDeleteVideo = async (recId: string) => {
    if (!id || !confirm('Delete this video recording?')) return;
    try {
      await videoApi.deleteRecording(id, recId);
      setVideoRecordings(prev => prev.filter(r => r.id !== recId));
      if (activeVideo?.id === recId) {
        const rem = videoRecordings.filter(r => r.id !== recId);
        setActiveVideo(rem.length > 0 ? rem[0] : null);
      }
    } catch (e) { alert('Failed to delete video'); }
  };

  const handleDeleteAudio = async (recId: string) => {
    if (!id || !confirm('Delete this audio recording?')) return;
    try {
      await audioApi.deleteRecording(id, recId);
      setAudioRecordings(prev => prev.filter(r => r.id !== recId));
      if (activeAudio?.id === recId) {
        const rem = audioRecordings.filter(r => r.id !== recId);
        setActiveAudio(rem.length > 0 ? rem[0] : null);
      }
    } catch (e) { alert('Failed to delete audio'); }
  };

  const handleSendCommand = async (type: string, payload?: object) => {
    if (!id) return;
    try {
      await commandsApi.dispatch(id, type as any, payload);
      fetchDetails();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || 'Failed to dispatch command';
      alert(`Command Rejected: ${msg}`);
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

  // Lost Mode Modal State
  const [lostModeModalOpen, setLostModeModalOpen] = useState(false);
  const [lostModePhone, setLostModePhone] = useState('');
  const [lostModeKey] = useState('944095');

  const handleToggleLostMode = async () => {
    if (!id || !device) return;
    if (device.is_lost_mode) {
      // Disable – no modal needed
      try {
        await commandsApi.dispatch(id, 'DISABLE_LOST_MODE');
        await devicesApi.update(id, { is_lost_mode: false });
        fetchDetails();
        alert('Lost Mode deactivated successfully.');
      } catch (e) {
        alert('Failed to deactivate lost mode');
      }
    } else {
      // Show modal to collect owner's alternate number
      setLostModePhone('');
      setLostModeModalOpen(true);
    }
  };

  const handleEnableLostMode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !lostModePhone.trim()) {
      alert('Please enter the owner\'s alternate contact number.');
      return;
    }
    try {
      await commandsApi.dispatch(id, 'ENABLE_LOST_MODE', {
        phone_number: lostModePhone.trim(),
        unlock_key: lostModeKey,
        message: 'This device has been reported LOST or STOLEN. All activity is being monitored.',
      });
      await devicesApi.update(id, { is_lost_mode: true });
      setLostModeModalOpen(false);
      fetchDetails();
      alert(`Lost Mode ENABLED!\nPhone displayed: ${lostModePhone.trim()}\nExit key: ${lostModeKey}`);
    } catch (e) {
      alert('Failed to enable lost mode');
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

  const handleRevoke = async () => {
    if (!id || !confirm('Are you sure you want to revoke this device enrollment? Revoking prevents all remote commands and marks the device as untrusted.')) return;
    try {
      await devicesApi.revoke(id);
      fetchDetails();
      alert('Device enrollment revoked successfully.');
    } catch (e: any) {
      alert('Failed to revoke device enrollment');
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
            onClick={() => setPairingModalOpen(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer"
            title="View Device Pairing QR Code & Credentials"
          >
            <QrCode className="w-3.5 h-3.5 text-cyan-400" />
            <span>Pairing QR Code</span>
          </button>

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
              <div className="flex items-center space-x-2">
                <h1 className="text-2xl font-bold text-white tracking-wide">{device.device_name}</h1>
                <button
                  onClick={() => {
                    setEditName(device.device_name || '');
                    setEditModel(device.device_model || '');
                    setEditSimNumber(device.sim_number || '');
                    setIsEditing(true);
                  }}
                  className="p-1.5 bg-slate-700/60 hover:bg-cyan-500 hover:text-slate-950 text-slate-300 rounded-lg transition-all cursor-pointer"
                  title="Edit Device Name & SIM Number"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Model: {device.device_model} • Android {device.android_version} • App v{device.app_version}
              </p>
              <div 
                onClick={() => {
                  setEditName(device.device_name || '');
                  setEditModel(device.device_model || '');
                  setEditSimNumber(device.sim_number || '');
                  setIsEditing(true);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-bold font-mono mt-1 px-2.5 py-1 bg-slate-900/80 hover:bg-slate-950 border border-slate-700/80 hover:border-cyan-500/50 rounded-lg text-cyan-300 cursor-pointer transition-all"
                title="Click to edit SIM Phone Number"
              >
                <Phone className="w-3.5 h-3.5 text-cyan-400" />
                <span>SIM Number / Carrier: {device.sim_number || (device.sim_status ? 'Active SIM (Click to set phone #)' : 'No SIM (Click to set phone #)')}</span>
                <Edit3 className="w-3 h-3 text-slate-500 hover:text-cyan-400 ml-1" />
              </div>
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

        {/* Device Privacy & Consent Architecture Card */}
        <div className="bg-slate-900/90 border border-cyan-500/30 rounded-2xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-700/60 pb-3">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-5 h-5 text-cyan-400" />
              <div>
                <h3 className="text-sm font-bold text-white">Device-Controlled Privacy & Consent Center</h3>
                <p className="text-[11px] text-slate-400">The device user physically holds non-overrideable authority over sensitive sensors.</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                device.enrollment_status === 'REVOKED'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              }`}>
                Enrollment: {device.enrollment_status || 'ENROLLED'}
              </span>
              {device.enrollment_status !== 'REVOKED' && (
                <button
                  onClick={handleRevoke}
                  className="text-xs px-2.5 py-1 bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40 rounded-lg font-semibold transition-all"
                >
                  Revoke Device
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/60">
              <div className="text-[10px] text-slate-400 font-bold uppercase">Camera Sensor</div>
              <div className={`text-xs font-bold mt-1 ${device.camera_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'text-rose-400' : 'text-emerald-400'}`}>
                {device.camera_privacy_state === 'PAUSED_BY_DEVICE_USER' ? '🔴 PAUSED BY USER' : '🟢 ALLOWED'}
              </div>
            </div>

            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/60">
              <div className="text-[10px] text-slate-400 font-bold uppercase">Microphone Sensor</div>
              <div className={`text-xs font-bold mt-1 ${device.microphone_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'text-rose-400' : 'text-emerald-400'}`}>
                {device.microphone_privacy_state === 'PAUSED_BY_DEVICE_USER' ? '🔴 PAUSED BY USER' : '🟢 ALLOWED'}
              </div>
            </div>

            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/60">
              <div className="text-[10px] text-slate-400 font-bold uppercase">GPS Satellite Telemetry</div>
              <div className={`text-xs font-bold mt-1 ${device.location_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'text-rose-400' : 'text-emerald-400'}`}>
                {device.location_privacy_state === 'PAUSED_BY_DEVICE_USER' ? '🔴 PAUSED BY USER' : '🟢 ALLOWED'}
              </div>
            </div>

            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/60">
              <div className="text-[10px] text-slate-400 font-bold uppercase">Loudspeaker & Siren</div>
              <div className={`text-xs font-bold mt-1 ${device.speaker_privacy_state === 'PAUSED_BY_DEVICE_USER' ? 'text-rose-400' : 'text-emerald-400'}`}>
                {device.speaker_privacy_state === 'PAUSED_BY_DEVICE_USER' ? '🔴 PAUSED BY USER' : '🟢 ALLOWED'}
              </div>
            </div>

            <div className="p-3 bg-slate-800/80 rounded-xl border border-slate-700/60">
              <div className="text-[10px] text-slate-400 font-bold uppercase">Remote Lockdown Controls</div>
              <div className={`text-xs font-bold mt-1 ${device.remote_controls_state === 'RESTRICTED' ? 'text-rose-400' : 'text-emerald-400'}`}>
                {device.remote_controls_state === 'RESTRICTED' ? '🔴 RESTRICTED' : '🟢 ALLOWED'}
              </div>
            </div>
          </div>
        </div>


        {/* ── Quick Commands ──────────────────────────────────────── */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <Camera className="w-4 h-4 text-cyan-400" />
            <span>Remote Commands</span>
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCameraModalOpen(true)}
              className="px-3 py-2 bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 border border-rose-500/40 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all"
            >
              <Video className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              Live Camera
            </button>
            <button onClick={() => handleSendCommand('LOCATE_NOW')} className="px-3 py-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all">
              <MapPin className="w-3.5 h-3.5" /> Locate Now
            </button>
            <button onClick={() => handleSendCommand('CAPTURE_SNAPSHOT')} className="px-3 py-2 bg-slate-700/60 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all">
              <Camera className="w-3.5 h-3.5 text-cyan-400" /> Take Selfie
            </button>
            <button onClick={() => setVoiceModalOpen(true)} className="px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all">
              <Volume2 className="w-3.5 h-3.5" /> Voice Warning
            </button>
            <button onClick={() => handleSendCommand('PLAY_ALARM')} className="px-3 py-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all">
              <Bell className="w-3.5 h-3.5 animate-bounce" /> Alarm
            </button>
            <button
              onClick={handleToggleLostMode}
              className={`px-3 py-2 border rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                device.is_lost_mode ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              {device.is_lost_mode ? 'Disable Lost Mode' : 'Enable Lost Mode'}
            </button>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════
            VIDEO & AUDIO RECORDINGS LIBRARY
            ═══════════════════════════════════════════════════════════════ */}
        <div className="space-y-4 pt-2 border-t border-slate-700/60">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <Film className="w-4 h-4 text-cyan-400" />
              <span>Video &amp; Audio Recordings Library</span>
              <span className="text-[11px] bg-cyan-500/20 text-cyan-300 font-bold px-2 py-0.5 rounded-full border border-cyan-500/30">
                {videoRecordings.length} videos · {audioRecordings.length} audio
              </span>
            </h3>
            <button
              onClick={fetchRecordings}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingRecordings ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          {/* ── New Recording Controls ── */}
          <div className="bg-slate-900/80 border border-slate-700/60 rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                <Disc className="w-4 h-4 text-rose-400" />
                <span>Record Video + Audio</span>
              </div>
              {/* Lens selector */}
              <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs">
                <button onClick={() => setRecordFacing('FRONT')} className={`px-2.5 py-1 rounded-lg font-bold transition-all ${recordFacing === 'FRONT' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'}`}>
                  👤 Front
                </button>
                <button onClick={() => setRecordFacing('BACK')} className={`px-2.5 py-1 rounded-lg font-bold transition-all ${recordFacing === 'BACK' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>
                  🏙️ Rear
                </button>
              </div>
              {/* Duration presets */}
              <div className="flex flex-wrap gap-1.5">
                {[{l:'30s',v:30},{l:'5m',v:300},{l:'15m',v:900},{l:'30m',v:1800},{l:'1h',v:3600},{l:'3h',v:10800}].map(p => (
                  <button
                    key={p.v}
                    onClick={() => setRecordDuration(p.v)}
                    disabled={isRecording}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      recordDuration === p.v ? 'bg-cyan-500 text-slate-950 border-cyan-400' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-cyan-500/50'
                    } disabled:opacity-40`}
                  >{p.l}</button>
                ))}
              </div>
            </div>

            {!isRecording ? (
              <button
                onClick={handleStartRecording}
                className="w-full sm:w-auto px-6 py-2.5 bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-500 hover:to-pink-500 text-white font-black text-xs rounded-xl flex items-center gap-2 shadow-lg shadow-rose-600/20 transition-all"
              >
                <Disc className="w-4 h-4 animate-spin" />
                Start {formatDuration(recordDuration)} Recording on {recordFacing === 'BACK' ? '🏙️ Rear' : '👤 Front'} Camera
              </button>
            ) : (
              <div className="space-y-2 bg-slate-950/80 border border-rose-500/40 rounded-xl p-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-2 text-rose-400 font-black animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    REC · {formatTimer(recordingSeconds)} elapsed
                  </div>
                  <span className="text-slate-400">
                    {recordingCountdown !== null ? `${formatTimer(recordingCountdown)} remaining` : ''}
                  </span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-rose-500 to-pink-400 h-1.5 rounded-full transition-all duration-1000"
                    style={{ width: `${Math.min(100, (recordingSeconds / recordDuration) * 100)}%` }}
                  />
                </div>
                <button
                  onClick={handleStopRecording}
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl flex items-center gap-1.5 shadow-lg"
                >
                  <Square className="w-3.5 h-3.5 fill-current" /> Stop & Save Now
                </button>
              </div>
            )}
          </div>

          {/* ── Video / Audio Tab Switcher ── */}
          <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs font-bold w-fit">
            <button
              onClick={() => setMediaTab('VIDEO')}
              className={`px-4 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                mediaTab === 'VIDEO' ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" /> Videos ({videoRecordings.length})
            </button>
            <button
              onClick={() => setMediaTab('AUDIO')}
              className={`px-4 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                mediaTab === 'AUDIO' ? 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Volume2 className="w-3.5 h-3.5" /> Audio ({audioRecordings.length})
            </button>
          </div>

          {/* ── VIDEO RECORDINGS ── */}
          {mediaTab === 'VIDEO' && (
            <>
              {videoRecordings.length === 0 ? (
                <div className="py-10 text-center text-slate-500 border border-dashed border-slate-700 rounded-2xl">
                  <Film className="w-10 h-10 text-slate-700 mx-auto mb-2" />
                  <div className="text-sm font-bold text-slate-400">No video recordings yet</div>
                  <p className="text-xs text-slate-500 mt-1">Start a recording above — it will appear here when done.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* Player */}
                  <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
                    {activeVideo && activeVideoBlobUrl ? (
                      <>
                        <div className="aspect-video bg-black">
                          <video key={activeVideo.id} src={activeVideoBlobUrl} controls autoPlay className="w-full h-full object-contain" />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs font-mono bg-slate-900 border-t border-slate-800">
                          <div className="flex items-center gap-2 text-slate-300">
                            <span className="bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded font-bold">
                              {activeVideo.facing === 'FRONT' ? '👤 Front' : '🏙️ Rear'}
                            </span>
                            <span className="text-emerald-400 flex items-center gap-1"><Volume2 className="w-3 h-3" /> Audio</span>
                            <span>⏱ {activeVideo.duration_seconds.toFixed(0)}s</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleDownloadVideo(activeVideo)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded-lg font-bold cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" /> Download MP4
                            </button>
                            <button onClick={() => handleDeleteVideo(activeVideo.id)} className="p-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 rounded-lg cursor-pointer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="py-16 text-center text-slate-500 text-xs">Select a video →</div>
                    )}
                  </div>

                  {/* Video list */}
                  <div className="bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col max-h-[400px] overflow-hidden">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 p-3">
                      {videoRecordings.length} Video{videoRecordings.length !== 1 ? 's' : ''}
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                      {videoRecordings.map((rec, idx) => {
                        const sel = activeVideo?.id === rec.id;
                        return (
                          <div
                            key={rec.id}
                            onClick={() => setActiveVideo(rec)}
                            className={`p-2.5 rounded-xl border transition-all cursor-pointer ${sel ? 'bg-cyan-950/80 border-cyan-400 ring-1 ring-cyan-500/20' : 'bg-slate-950/70 border-slate-800 hover:border-cyan-500/40'}`}
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-14 h-10 bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center border border-slate-800 shrink-0 relative">
                                {rec.thumbnail_data ? <img src={rec.thumbnail_data} alt="" className="w-full h-full object-cover" /> : <Film className="w-4 h-4 text-slate-600" />}
                                <div className="absolute inset-0 bg-black/30 flex items-center justify-center"><Play className="w-3 h-3 fill-white text-white" /></div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between text-xs font-bold">
                                  <span className={sel ? 'text-cyan-300' : 'text-white'}>Video #{videoRecordings.length - idx}</span>
                                  <span className="text-[10px] text-slate-400">{rec.duration_seconds.toFixed(0)}s</span>
                                </div>
                                <div className="text-[10px] text-slate-400 truncate mt-0.5">{new Date(rec.created_at).toLocaleString()}</div>
                                <div className="text-[10px] text-cyan-400 mt-0.5">{rec.facing === 'FRONT' ? '👤 Front' : '🏙️ Rear'} · Audio</div>
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); handleDownloadVideo(rec); }} className="p-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 rounded-lg cursor-pointer shrink-0" title="Download">
                                <Download className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── AUDIO RECORDINGS ── */}
          {mediaTab === 'AUDIO' && (
            <>
              {audioRecordings.length === 0 ? (
                <div className="py-10 text-center text-slate-500 border border-dashed border-slate-700 rounded-2xl">
                  <Volume2 className="w-10 h-10 text-slate-700 mx-auto mb-2" />
                  <div className="text-sm font-bold text-slate-400">No audio recordings yet</div>
                  <p className="text-xs text-slate-500 mt-1">Audio recordings captured from the device microphone will appear here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Audio player */}
                  {activeAudio && activeAudioBlobUrl && (
                    <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between text-xs font-mono text-slate-300">
                        <div className="flex items-center gap-2">
                          <Volume2 className="w-4 h-4 text-purple-400" />
                          <span className="font-bold text-white">Playing Audio #{audioRecordings.findIndex(r => r.id === activeAudio.id) + 1}</span>
                          <span className="text-slate-400">⏱ {activeAudio.duration_seconds.toFixed(0)}s</span>
                          <span className="text-slate-500">{new Date(activeAudio.created_at).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleDownloadAudio(activeAudio)} className="flex items-center gap-1 px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 border border-purple-500/40 rounded-lg font-bold cursor-pointer">
                            <Download className="w-3.5 h-3.5" /> Download
                          </button>
                          <button onClick={() => handleDeleteAudio(activeAudio.id)} className="p-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 rounded-lg cursor-pointer">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <audio key={activeAudio.id} src={activeAudioBlobUrl} controls autoPlay className="w-full" />
                    </div>
                  )}

                  {/* Audio list */}
                  <div className="space-y-2">
                    {audioRecordings.map((rec, idx) => {
                      const sel = activeAudio?.id === rec.id;
                      return (
                        <div
                          key={rec.id}
                          onClick={() => setActiveAudio(rec)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${sel ? 'bg-purple-950/60 border-purple-400 ring-1 ring-purple-500/20' : 'bg-slate-900/70 border-slate-800 hover:border-purple-500/40'}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl border ${sel ? 'bg-purple-500/20 border-purple-500/40' : 'bg-slate-800 border-slate-700'}`}>
                              <Volume2 className={`w-4 h-4 ${sel ? 'text-purple-400' : 'text-slate-400'}`} />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-white">Audio #{audioRecordings.length - idx}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{new Date(rec.created_at).toLocaleString()} · {rec.duration_seconds.toFixed(0)}s</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={(e) => { e.stopPropagation(); handleDownloadAudio(rec); }} className="p-1.5 bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/30 rounded-lg cursor-pointer" title="Download">
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteAudio(rec.id); }} className="p-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 rounded-lg cursor-pointer" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
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

        {/* Child & Device App Usage / Screen Time Analytics */}
        <div className="space-y-4 pt-4 border-t border-slate-700/60">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
              <span>Handset Screen Time & App Usage</span>
            </h3>
            {appUsage?.date && (
              <span className="text-[11px] font-mono text-slate-400">Date: {appUsage.date}</span>
            )}
          </div>

          {!appUsage || !appUsage.apps || appUsage.apps.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 text-center text-xs text-slate-400 space-y-1">
              <p>No app usage telemetry synchronized yet.</p>
              <p className="text-[11px] text-slate-500">
                Grant "Usage Access" in the AuraFind Android app settings to enable automated daily screen time reports.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 bg-slate-900/90 border border-slate-700/60 rounded-xl flex items-center justify-between text-xs">
                <span className="text-slate-400 font-semibold">Total Screen Time Foreground</span>
                <span className="text-cyan-400 font-bold font-mono">
                  {Math.floor(appUsage.total_screen_time_seconds / 3600)}h {Math.floor((appUsage.total_screen_time_seconds % 3600) / 60)}m
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {appUsage.apps.slice(0, 10).map((app: any, idx: number) => {
                  const maxSec = appUsage.total_screen_time_seconds || 1;
                  const pct = Math.min(100, Math.round((app.total_time_foreground_seconds / maxSec) * 100));
                  return (
                    <div key={idx} className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white truncate max-w-[180px]">{app.app_name || app.package_name}</span>
                        <span className="text-slate-400 font-mono text-[11px]">
                          {Math.floor(app.total_time_foreground_seconds / 60)}m
                        </span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-cyan-500 h-1.5 rounded-full" style={{ width: `${pct}%` }}></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Real-time Notification Logs Stream */}
        <div className="space-y-4 pt-4 border-t border-slate-700/60">
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <MessageSquare className="w-4 h-4 text-purple-400" />
            <span>Captured Handset Notification Stream ({notifications.length})</span>
          </h3>

          {notifications.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 text-center text-xs text-slate-400 space-y-1">
              <p>No notifications captured yet.</p>
              <p className="text-[11px] text-slate-500">
                Grant "Notification Listener" permission in the Android app to intercept emergency incoming alerts and messages.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {notifications.slice(0, 30).map((notif: any, i: number) => (
                <div key={i} className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-cyan-300">{notif.app_name || notif.package_name}</span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {notif.timestamp ? new Date(notif.timestamp).toLocaleTimeString() : ''}
                    </span>
                  </div>
                  {notif.title && <div className="font-semibold text-white text-[11px]">{notif.title}</div>}
                  <div className="text-slate-400 text-[11px]">{notif.text}</div>
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

            <form 
              onSubmit={async (e) => {
                e.preventDefault();
                setIsSaving(true);
                try {
                  const updated = await devicesApi.update(device.id, {
                    device_name: editName,
                    device_model: editModel,
                    sim_number: editSimNumber,
                  });
                  setDevice(updated);
                  setIsEditing(false);
                } catch (err: any) {
                  alert(`Failed to save changes: ${err?.response?.data?.detail || err.message}`);
                } finally {
                  setIsSaving(false);
                }
              }} 
              className="space-y-3 text-xs"
            >
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
                  This mobile number will be displayed on the device card, Emergency Lost Mode, and Police FIR recovery dossiers.
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

      {/* Device Pairing / Enrollment Modal */}
      {device && (
        <DeviceEnrollmentModal
          isOpen={pairingModalOpen}
          initialDevice={device}
          onClose={() => setPairingModalOpen(false)}
          onSuccess={fetchDetails}
        />
      )}

      {/* ── Lost Mode Activation Modal ─────────────────────────────────── */}
      {lostModeModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-rose-500/40 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-rose-400 flex items-center space-x-2">
                <Lock className="w-5 h-5" />
                <span>Enable Lost Mode</span>
              </h2>
              <button onClick={() => setLostModeModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-rose-900/20 border border-rose-500/30 rounded-xl p-4 text-xs text-rose-300 space-y-1">
              <p className="font-bold">⚠️ LOST MODE LOCKDOWN</p>
              <p>The phone will be completely locked. Only the owner's contact number and the exit key will be shown. No other functions will work, even the power button.</p>
            </div>

            <form onSubmit={handleEnableLostMode} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wide block mb-1">
                  📞 Owner's Alternate Contact Number
                </label>
                <input
                  type="tel"
                  value={lostModePhone}
                  onChange={e => setLostModePhone(e.target.value)}
                  placeholder="e.g. +91 9876543210"
                  required
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:border-rose-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">This number will be displayed on the locked screen for people to call.</p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-300 uppercase tracking-wide block mb-1">
                  🔑 Master Exit Key
                </label>
                <div className="flex items-center space-x-2 px-4 py-3 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <span className="text-white font-mono font-bold text-lg tracking-widest">{lostModeKey}</span>
                  <span className="text-slate-500 text-xs">(fixed — used to exit lost mode on device)</span>
                </div>
              </div>

              <div className="flex space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setLostModeModalOpen(false)}
                  className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-xl text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-bold"
                >
                  🔒 Activate Lost Mode
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
