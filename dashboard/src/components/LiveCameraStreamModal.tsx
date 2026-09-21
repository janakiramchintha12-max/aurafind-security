import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  Camera,
  RefreshCw,
  X,
  Maximize2,
  Minimize2,
  RotateCw,
  Radio,
  Download,
  Gauge,
  Sparkles,
  Film,
  Play,
  Trash2,
  Volume2,
  CheckCircle2,
} from 'lucide-react';
import { commandsApi, cameraApi, videoApi, connectWebSocket } from '../services/api';
import { Device, VideoRecording } from '../types';
import { HardwareStreamPlayer } from './HardwareStreamPlayer';

interface LiveCameraStreamModalProps {
  device: Device;
  onClose: () => void;
}

interface QueuedFrame {
  img: HTMLImageElement;
  timestamp: number;
  seq?: number;
}

function getVideoBlobUrl(videoData: string, mimeType: string = 'video/mp4'): string {
  try {
    let base64 = videoData;
    let mime = mimeType || 'video/mp4';
    if (videoData.startsWith('data:')) {
      const parts = videoData.split('base64,');
      if (parts.length === 2) {
        mime = parts[0].replace('data:', '').replace(';', '') || mime;
        base64 = parts[1];
      }
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch (e) {
    return videoData;
  }
}

export const LiveCameraStreamModal: React.FC<LiveCameraStreamModalProps> = ({ device, onClose }) => {
  const [activeTab, setActiveTab] = useState<'STREAM' | 'RECORDINGS'>('STREAM');
  const [currentFacing, setCurrentFacing] = useState<'FRONT' | 'BACK'>('FRONT');
  const [isStreaming] = useState(true);
  const [frameCount, setFrameCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [isMirrored, setIsMirrored] = useState<boolean>(false);
  const [enhanceFilter] = useState<boolean>(true);
  const [streamEngine] = useState<'NATIVE_MJPEG' | 'SMOOTH_BUFFER' | 'DIRECT_LIVE'>('NATIVE_MJPEG');
  const [displayFps, setDisplayFps] = useState<number>(0);
  const [hasReceivedFirstFrame, setHasReceivedFirstFrame] = useState<boolean>(false);
  const [rawFrameSrc, setRawFrameSrc] = useState<string | null>(null);

  // Recordings tab
  const [videoRecordings, setVideoRecordings] = useState<VideoRecording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState<boolean>(false);
  const [activePlaybackVideo, setActivePlaybackVideo] = useState<VideoRecording | null>(null);
  const [activePlaybackBlobUrl, setActivePlaybackBlobUrl] = useState<string>('');

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);
  const frameQueueRef = useRef<QueuedFrame[]>([]);
  const latestImgRef = useRef<HTMLImageElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const lastSeenKeyRef = useRef<string>('');
  const lastFrameReceivedTimeRef = useRef<number>(performance.now());
  const fpsCounterRef = useRef<{ frames: number; lastTime: number }>({ frames: 0, lastTime: performance.now() });
  const currentFacingRef = useRef<'FRONT' | 'BACK'>('FRONT');

  const fetchVideoRecordings = async () => {
    setLoadingRecordings(true);
    try {
      const records = await videoApi.listRecordings(device.id);
      setVideoRecordings(records || []);
      if (records && records.length > 0 && !activePlaybackVideo) {
        setActivePlaybackVideo(records[0]);
      }
    } catch (e) {
      console.error('Failed to load recordings', e);
    } finally {
      setLoadingRecordings(false);
    }
  };

  useEffect(() => { fetchVideoRecordings(); }, [device.id]);

  useEffect(() => {
    if (activePlaybackVideo) {
      const url = getVideoBlobUrl(activePlaybackVideo.video_data, activePlaybackVideo.mime_type);
      setActivePlaybackBlobUrl(url);
      return () => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); };
    } else {
      setActivePlaybackBlobUrl('');
    }
  }, [activePlaybackVideo]);

  // WebSocket + frame ingestion
  useEffect(() => {
    if (activeTab === 'STREAM') {
      commandsApi.dispatch(device.id, 'START_CAMERA_STREAM', { facing: currentFacingRef.current }).catch(console.error);
    }

    const handleIncomingFrame = (dataUrl: string, facing?: string, timestamp?: string, seq?: number) => {
      if (!dataUrl) return;
      const fullSrc = dataUrl.startsWith('data:') ? dataUrl : `data:image/jpeg;base64,${dataUrl}`;
      const frameKey = seq ? `seq_${seq}` : (timestamp ? `ts_${timestamp}` : fullSrc.slice(-30));
      if (lastSeenKeyRef.current === frameKey) return;
      lastSeenKeyRef.current = frameKey;
      lastFrameReceivedTimeRef.current = performance.now();

      setRawFrameSrc(fullSrc);
      setHasReceivedFirstFrame(true);

      const img = new Image();
      img.onload = () => {
        latestImgRef.current = img;
        frameQueueRef.current.push({ img, timestamp: performance.now(), seq });
        if (frameQueueRef.current.length > 300) frameQueueRef.current.shift();
        setFrameCount(c => c + 1);
        if (facing) {
          const norm = facing.toUpperCase() as 'FRONT' | 'BACK';
          if (norm !== currentFacingRef.current) { currentFacingRef.current = norm; setCurrentFacing(norm); }
        }
      };
      img.src = fullSrc;
    };

    cameraApi.getLatestFrame(device.id).then((data) => {
      if (data?.has_frame && data.image_data) handleIncomingFrame(data.image_data, data.facing, data.timestamp, data.seq);
    }).catch(() => {});

    const cleanupWs = connectWebSocket((eventData: any) => {
      if (eventData?.event === 'LIVE_CAMERA_FRAME' && eventData?.device_id === device.id && eventData.image_data) {
        handleIncomingFrame(eventData.image_data, eventData.facing, eventData.timestamp, eventData.seq);
      }
      if (eventData?.event === 'NEW_VIDEO_RECORDING' && eventData?.device_id === device.id) {
        fetchVideoRecordings();
      }
    });

    const watchdogInterval = setInterval(async () => {
      if (!isStreaming || activeTab !== 'STREAM') return;
      if (performance.now() - lastFrameReceivedTimeRef.current > 500) {
        try {
          const data = await cameraApi.getLatestFrame(device.id);
          if (data?.has_frame && data.image_data) handleIncomingFrame(data.image_data, data.facing, data.timestamp, data.seq);
        } catch (e) {}
      }
    }, 400);

    return () => {
      cleanupWs();
      clearInterval(watchdogInterval);
      if (activeTab === 'STREAM') commandsApi.dispatch(device.id, 'STOP_CAMERA_STREAM').catch(console.error);
    };
  }, [device.id, activeTab]);

  // 60 FPS render loop for canvas engine
  useEffect(() => {
    let active = true;
    const renderLoop = (now: number) => {
      if (!active) return;
      const canvas = canvasRef.current;
      if (canvas && streamEngine !== 'NATIVE_MJPEG' && activeTab === 'STREAM') {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          const img = latestImgRef.current;
          if (img && img.complete && img.naturalWidth > 0) {
            const w = img.naturalWidth; const h = img.naturalHeight;
            const isRot = rotationDegrees === 90 || rotationDegrees === 270;
            const cw = isRot ? h : w; const ch = isRot ? w : h;
            if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.filter = enhanceFilter ? 'contrast(1.06) brightness(1.03) saturate(1.08)' : 'none';
            ctx.translate(cw / 2, ch / 2);
            ctx.rotate((rotationDegrees * Math.PI) / 180);
            if (isMirrored) ctx.scale(-1, 1);
            ctx.drawImage(img, -w / 2, -h / 2, w, h);
            ctx.restore();
          }
        }
      }
      fpsCounterRef.current.frames++;
      if (now - fpsCounterRef.current.lastTime >= 500) {
        setDisplayFps(Math.max(0, Math.min(120, Math.round((fpsCounterRef.current.frames * 1000) / (now - fpsCounterRef.current.lastTime)))));
        fpsCounterRef.current.frames = 0;
        fpsCounterRef.current.lastTime = now;
      }
      animFrameIdRef.current = requestAnimationFrame(renderLoop);
    };
    animFrameIdRef.current = requestAnimationFrame(renderLoop);
    return () => { active = false; if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current); };
  }, [streamEngine, rotationDegrees, isMirrored, enhanceFilter, activeTab]);

  const handleSwitchLens = async (targetFacing: 'FRONT' | 'BACK') => {
    if (loading) return;
    if (currentFacing === targetFacing) return;
    setLoading(true);
    try {
      currentFacingRef.current = targetFacing;
      setCurrentFacing(targetFacing);
      setHasReceivedFirstFrame(false);
      frameQueueRef.current = [];
      await commandsApi.dispatch(device.id, 'SWITCH_CAMERA', { facing: targetFacing });
    } catch (e) {
      alert('Failed to switch camera lens');
    } finally {
      setLoading(false);
    }
  };

  const handleCaptureSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.download = `aurafind-snapshot-${currentFacing}-${Date.now()}.jpg`;
    a.click();
  };

  const handleDownloadVideo = (rec: VideoRecording) => {
    const url = getVideoBlobUrl(rec.video_data, rec.mime_type);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date(rec.created_at).toISOString().slice(0, 10);
    const durStr = Math.round(rec.duration_seconds || 0);
    a.download = `AuraFind_${device.device_name.replace(/[^a-zA-Z0-9]/g, '_')}_${rec.facing || 'LENS'}_${durStr}s_${dateStr}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDeleteVideoRecording = async (recordingId: string) => {
    if (!confirm('Delete this recording?')) return;
    try {
      await videoApi.deleteRecording(device.id, recordingId);
      setVideoRecordings(prev => prev.filter(r => r.id !== recordingId));
      if (activePlaybackVideo?.id === recordingId) {
        const remaining = videoRecordings.filter(r => r.id !== recordingId);
        setActivePlaybackVideo(remaining.length > 0 ? remaining[0] : null);
      }
    } catch (e) {
      alert('Failed to delete recording');
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(console.error);
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(console.error);
      setIsFullscreen(false);
    }
  };

  const authToken = localStorage.getItem('token') || localStorage.getItem('access_token') || '';
  const mjpegStreamUrl = `/api/v1/devices/${device.id}/camera/mjpeg?token=${encodeURIComponent(authToken)}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div
        ref={containerRef}
        className={`bg-slate-900 border border-slate-700/80 rounded-3xl max-w-5xl w-full text-slate-100 shadow-2xl transition-all ${
          isFullscreen ? 'max-w-none h-screen rounded-none flex flex-col' : ''
        }`}
      >
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 p-5 pb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-rose-500/20 text-rose-400 rounded-2xl border border-rose-500/30">
              <Video className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                Live Camera
                <span className="text-[11px] bg-rose-600 text-white font-black px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
                  {activeTab === 'STREAM' ? `LIVE · ${currentFacing === 'FRONT' ? '👤 FRONT' : '🏙️ REAR'}` : `🎬 SAVED (${videoRecordings.length})`}
                </span>
              </h2>
              <p className="text-xs text-slate-400">{device.device_name}</p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs font-bold">
              <button
                onClick={() => setActiveTab('STREAM')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'STREAM' ? 'bg-rose-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>Live</span>
              </button>
              <button
                onClick={() => { setActiveTab('RECORDINGS'); fetchVideoRecordings(); }}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'RECORDINGS' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>Saved ({videoRecordings.length})</span>
              </button>
            </div>
            <button onClick={toggleFullscreen} className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 cursor-pointer">
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button onClick={onClose} className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl border border-slate-700 cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ══════════════════════ TAB 1: LIVE STREAM ══════════════════════ */}
        {activeTab === 'STREAM' && (
          <div className="p-5 space-y-4">

            {/* Status bar */}
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl px-4 py-2 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-white font-bold">{currentFacing === 'BACK' ? '🏙️ REAR' : '👤 FRONT'}</span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-400">{displayFps} FPS</span>
                <span className="text-slate-500">·</span>
                <span className="text-slate-400">{frameCount} frames</span>
              </div>
              <div className="flex items-center gap-1 text-slate-400">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>Live surveillance active</span>
              </div>
            </div>

            {/* Video canvas - clean, full width */}
            <div className={`relative bg-black rounded-2xl overflow-hidden border border-slate-800 shadow-2xl flex items-center justify-center ${
              isFullscreen ? 'flex-1' : 'aspect-video'
            }`}>
              {streamEngine === 'NATIVE_MJPEG' && (
                <img
                  src={mjpegStreamUrl}
                  alt="Live stream"
                  style={{
                    transform: `rotate(${rotationDegrees}deg) scaleX(${isMirrored ? -1 : 1})`,
                    filter: enhanceFilter ? 'contrast(1.06) brightness(1.03) saturate(1.08)' : 'none'
                  }}
                  className="w-full h-full object-contain select-none"
                  onError={() => {}}
                />
              )}
              {streamEngine !== 'NATIVE_MJPEG' && (
                <>
                  <canvas
                    ref={canvasRef}
                    className={`w-full h-full object-contain select-none ${hasReceivedFirstFrame ? 'block' : 'hidden'}`}
                  />
                  {!hasReceivedFirstFrame && rawFrameSrc && (
                    <img src={rawFrameSrc} alt="Stream" style={{ transform: `rotate(${rotationDegrees}deg)`, filter: enhanceFilter ? 'contrast(1.06) brightness(1.03) saturate(1.08)' : 'none' }} className="w-full h-full object-contain" />
                  )}
                </>
              )}

              {!hasReceivedFirstFrame && !rawFrameSrc && streamEngine !== 'NATIVE_MJPEG' && (
                <div className="text-center space-y-3 text-slate-400 p-8">
                  <RefreshCw className="w-10 h-10 text-cyan-400 animate-spin mx-auto" />
                  <div className="text-sm font-black text-white">Opening Remote Camera...</div>
                  <div className="text-xs text-slate-400">Connecting to {currentFacing} lens on {device.device_name}</div>
                </div>
              )}

              {/* HUD overlays */}
              <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl text-[11px] font-mono text-cyan-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                <span className="font-bold">⚡ LIVE</span>
              </div>
              <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl text-[11px] font-mono text-slate-200 flex items-center gap-2">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-cyan-400 font-bold">{displayFps} FPS</span>
              </div>
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                <div className="bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl text-[10px] font-mono text-emerald-400">
                  📍 {device.last_latitude ? `${device.last_latitude.toFixed(4)}, ${device.last_longitude?.toFixed(4)}` : 'GPS Active'} · {new Date().toLocaleTimeString()}
                </div>
                <div className="bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl text-[10px] font-mono text-slate-300">
                  🔋 {device.battery_pct}%
                </div>
              </div>
            </div>

            {/* ── Simple Control Bar (lens switch + utils only) ── */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Lens toggle */}
              <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs font-bold">
                <button
                  onClick={() => handleSwitchLens('FRONT')}
                  disabled={loading}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                    currentFacing === 'FRONT' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  👤 Front
                </button>
                <button
                  onClick={() => handleSwitchLens('BACK')}
                  disabled={loading}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                    currentFacing === 'BACK' ? 'bg-cyan-500 text-slate-950 font-black shadow' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  🏙️ Rear
                </button>
              </div>

              <button
                onClick={() => setRotationDegrees(prev => (prev + 90) % 360)}
                className="p-2.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCw className="w-4 h-4" />
                <span>{rotationDegrees}°</span>
              </button>

              <button
                onClick={handleCaptureSnapshot}
                disabled={!hasReceivedFirstFrame}
                className="p-2.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
              >
                <Camera className="w-4 h-4" />
                <span>Snapshot</span>
              </button>

              <button
                onClick={() => commandsApi.dispatch(device.id, 'PLAY_ALARM')}
                className="p-2.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Radio className="w-4 h-4" />
                <span>Siren</span>
              </button>

              <button
                onClick={() => { setActiveTab('RECORDINGS'); fetchVideoRecordings(); }}
                className="ml-auto p-2.5 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Film className="w-4 h-4" />
                <span>View Saved Videos ({videoRecordings.length})</span>
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════ TAB 2: SAVED RECORDINGS ══════════════════════ */}
        {activeTab === 'RECORDINGS' && (
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Film className="w-5 h-5 text-cyan-400" />
                <div>
                  <h3 className="text-base font-bold text-white">Saved Video Recordings ({videoRecordings.length})</h3>
                  <p className="text-xs text-slate-400">HD video with synchronized audio · click any to play or download</p>
                </div>
              </div>
              <button
                onClick={fetchVideoRecordings}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingRecordings ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {loadingRecordings && videoRecordings.length === 0 ? (
              <div className="py-16 text-center space-y-3">
                <RefreshCw className="w-8 h-8 animate-spin text-cyan-400 mx-auto" />
                <div className="text-xs font-bold text-slate-400">Loading recordings...</div>
              </div>
            ) : videoRecordings.length === 0 ? (
              <div className="py-16 text-center space-y-3 text-slate-400 border border-dashed border-slate-700 rounded-3xl">
                <Film className="w-12 h-12 text-slate-600 mx-auto" />
                <div className="text-sm font-bold text-slate-300">No Saved Recordings Yet</div>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  Use the <strong>Video & Audio Recordings</strong> section on the device page to record videos.
                  They'll appear here automatically when done.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Main Player */}
                <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
                  {activePlaybackVideo && activePlaybackBlobUrl ? (
                    <>
                      <div className="relative aspect-video bg-black">
                        <video
                          ref={videoPlayerRef}
                          key={activePlaybackVideo.id}
                          src={activePlaybackBlobUrl}
                          controls
                          autoPlay
                          className="w-full h-full object-contain"
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-xs font-mono bg-slate-900 border-t border-slate-800">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                            {activePlaybackVideo.facing === 'FRONT' ? '👤 Front' : '🏙️ Rear'}
                          </span>
                          <span className="text-emerald-400 font-bold flex items-center gap-1">
                            <Volume2 className="w-3.5 h-3.5" /> Audio
                          </span>
                          <span className="text-slate-300">⏱ {activePlaybackVideo.duration_seconds.toFixed(1)}s</span>
                          <span className="text-slate-500">{new Date(activePlaybackVideo.created_at).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDownloadVideo(activePlaybackVideo)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded-lg font-bold cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Download MP4
                          </button>
                          <button
                            onClick={() => handleDeleteVideoRecording(activePlaybackVideo.id)}
                            className="p-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="py-20 text-center text-slate-400 text-xs flex-1 flex items-center justify-center">
                      Select a video from the list →
                    </div>
                  )}
                </div>

                {/* Video List */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col max-h-[480px] overflow-hidden">
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800 p-3">
                    {videoRecordings.length} Recording{videoRecordings.length !== 1 ? 's' : ''}
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {videoRecordings.map((rec, idx) => {
                      const isSelected = activePlaybackVideo?.id === rec.id;
                      return (
                        <div
                          key={rec.id}
                          onClick={() => setActivePlaybackVideo(rec)}
                          className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                            isSelected ? 'bg-cyan-950/80 border-cyan-400 ring-2 ring-cyan-500/20' : 'bg-slate-950/70 border-slate-800 hover:border-cyan-500/40'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-14 h-10 bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center border border-slate-800 shrink-0 relative">
                              {rec.thumbnail_data
                                ? <img src={rec.thumbnail_data} alt="thumb" className="w-full h-full object-cover" />
                                : <Film className="w-4 h-4 text-slate-600" />}
                              <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                                <Play className="w-3.5 h-3.5 fill-white text-white opacity-80" />
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between text-xs font-bold">
                                <span className={isSelected ? 'text-cyan-300' : 'text-white'}>Video #{videoRecordings.length - idx}</span>
                                <span className="text-[10px] text-slate-400 font-mono">{rec.duration_seconds.toFixed(0)}s</span>
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono truncate mt-0.5">{new Date(rec.created_at).toLocaleString()}</div>
                              <div className="text-[10px] text-cyan-400 font-bold mt-0.5">{rec.facing === 'FRONT' ? '👤 Front' : '🏙️ Rear'} · Audio</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
