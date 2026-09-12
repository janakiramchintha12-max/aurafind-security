import React, { useState, useEffect, useRef } from 'react';
import { 
  Video, 
  Camera, 
  RefreshCw, 
  X, 
  Maximize2, 
  Minimize2, 
  RotateCw, 
  FlipHorizontal, 
  Radio, 
  Download, 
  Zap, 
  Sparkles, 
  Gauge, 
  Sliders, 
  Disc, 
  Square, 
  Play, 
  Pause, 
  Clock, 
  Trash2, 
  Film, 
  CheckCircle2, 
  Volume2
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

// Helper: Convert Base64 data to seekable Blob Object URL for Chrome/Edge/Safari/Firefox
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
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.error('Failed to convert base64 video to Blob URL', e);
    return videoData;
  }
}

export const LiveCameraStreamModal: React.FC<LiveCameraStreamModalProps> = ({ device, onClose }) => {
  const [activeTab, setActiveTab] = useState<'STREAM' | 'RECORDINGS'>('STREAM');
  const [currentFacing, setCurrentFacing] = useState<'FRONT' | 'BACK'>('FRONT');
  const [isStreaming, setIsStreaming] = useState(true);
  const [frameCount, setFrameCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [isMirrored, setIsMirrored] = useState<boolean>(false);
  const [enhanceFilter, setEnhanceFilter] = useState<boolean>(true);
  const [streamEngine, setStreamEngine] = useState<'HARDWARE_H264' | 'SMOOTH_BUFFER' | 'NATIVE_MJPEG' | 'DIRECT_LIVE'>('HARDWARE_H264');
  const [bufferDelayMs, setBufferDelayMs] = useState<number>(2500); // 2.5s smooth playout delay
  const [displayFps, setDisplayFps] = useState<number>(60);
  const [bufferQueueDepth, setBufferQueueDepth] = useState<number>(0);
  const [hasReceivedFirstFrame, setHasReceivedFirstFrame] = useState<boolean>(false);
  const [rawFrameSrc, setRawFrameSrc] = useState<string | null>(null);

  // Video with Audio Recording State
  const [isRecordingVideo, setIsRecordingVideo] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [recordingStatusMsg, setRecordingStatusMsg] = useState<string>('');
  const [isStoppingRecording, setIsStoppingRecording] = useState<boolean>(false);

  // Video Recordings Archive State
  const [videoRecordings, setVideoRecordings] = useState<VideoRecording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState<boolean>(false);
  const [activePlaybackVideo, setActivePlaybackVideo] = useState<VideoRecording | null>(null);
  const [activePlaybackBlobUrl, setActivePlaybackBlobUrl] = useState<string>('');

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recordTimerRef = useRef<any>(null);
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);
  
  // High-performance ring buffer for 60 FPS jitter-free playback
  const frameQueueRef = useRef<QueuedFrame[]>([]);
  const latestImgRef = useRef<HTMLImageElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const lastSeenKeyRef = useRef<string>('');
  const lastFrameReceivedTimeRef = useRef<number>(performance.now());
  const fpsCounterRef = useRef<{ frames: number; lastTime: number }>({ frames: 0, lastTime: performance.now() });

  // Fetch Cloud Video Recordings
  const fetchVideoRecordings = async () => {
    setLoadingRecordings(true);
    try {
      const records = await videoApi.listRecordings(device.id);
      setVideoRecordings(records || []);
      if (records && records.length > 0 && !activePlaybackVideo) {
        setActivePlaybackVideo(records[0]);
      }
    } catch (e) {
      console.error('Failed to load video recordings', e);
    } finally {
      setLoadingRecordings(false);
    }
  };

  useEffect(() => {
    fetchVideoRecordings();
  }, [device.id]);

  // Set active video blob url when active playback video changes
  useEffect(() => {
    if (activePlaybackVideo) {
      const url = getVideoBlobUrl(activePlaybackVideo.video_data, activePlaybackVideo.mime_type);
      setActivePlaybackBlobUrl(url);
      return () => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      };
    } else {
      setActivePlaybackBlobUrl('');
    }
  }, [activePlaybackVideo]);

  // 1. WebSocket & Fast Frame Ingestion Pipeline
  useEffect(() => {
    if (activeTab === 'STREAM') {
      commandsApi.dispatch(device.id, 'START_CAMERA_STREAM', { facing: currentFacing }).catch(console.error);
    }

    const handleIncomingFrame = (dataUrl: string, facing?: string, timestamp?: string, seq?: number) => {
      if (!dataUrl) return;
      const fullSrc = dataUrl.startsWith('data:') ? dataUrl : `data:image/jpeg;base64,${dataUrl}`;
      
      const frameKey = seq ? `seq_${seq}` : (timestamp ? `ts_${timestamp}` : fullSrc.slice(-30));
      if (lastSeenKeyRef.current === frameKey) {
        return; // deduplicate
      }
      lastSeenKeyRef.current = frameKey;
      lastFrameReceivedTimeRef.current = performance.now();

      setRawFrameSrc(fullSrc);
      setHasReceivedFirstFrame(true);

      const img = new Image();
      img.onload = () => {
        const now = performance.now();
        latestImgRef.current = img;
        frameQueueRef.current.push({ img, timestamp: now, seq });
        
        // Retain max 300 frames in queue (~10s max)
        if (frameQueueRef.current.length > 300) {
          frameQueueRef.current.shift();
        }
        setBufferQueueDepth(frameQueueRef.current.length);
        setFrameCount(c => c + 1);
        if (facing) setCurrentFacing(facing.toUpperCase() as 'FRONT' | 'BACK');
      };
      img.src = fullSrc;
    };

    // Initial frame load
    cameraApi.getLatestFrame(device.id).then((data) => {
      if (data && data.has_frame && data.image_data) {
        handleIncomingFrame(data.image_data, data.facing, data.timestamp, data.seq);
      }
    }).catch(() => {});

    // Live WebSocket stream ingestion
    const cleanupWs = connectWebSocket((eventData: any) => {
      if (eventData?.event === 'LIVE_CAMERA_FRAME' && eventData?.device_id === device.id) {
        if (eventData.image_data) {
          handleIncomingFrame(eventData.image_data, eventData.facing, eventData.timestamp, eventData.seq);
        }
      }

      if (eventData?.event === 'NEW_VIDEO_RECORDING' && eventData?.device_id === device.id) {
        setRecordingStatusMsg('✅ New crystal-clear video with audio saved to cloud!');
        setIsRecordingVideo(false);
        setIsStoppingRecording(false);
        setRecordingSeconds(0);
        if (recordTimerRef.current) clearInterval(recordTimerRef.current);
        fetchVideoRecordings();
      }
    });

    // Smart Watchdog Poller: only queries backend if WebSocket has been silent for > 500ms
    const watchdogInterval = setInterval(async () => {
      if (!isStreaming || activeTab !== 'STREAM') return;
      const silentDuration = performance.now() - lastFrameReceivedTimeRef.current;
      if (silentDuration > 500) {
        try {
          const data = await cameraApi.getLatestFrame(device.id);
          if (data && data.has_frame && data.image_data) {
            handleIncomingFrame(data.image_data, data.facing, data.timestamp, data.seq);
          }
        } catch (e) {
          // quiet
        }
      }
    }, 400);

    return () => {
      cleanupWs();
      clearInterval(watchdogInterval);
      if (activeTab === 'STREAM') {
        commandsApi.dispatch(device.id, 'STOP_CAMERA_STREAM').catch(console.error);
      }
    };
  }, [device.id, currentFacing, activeTab]);

  // 2. Hardware-Accelerated 60 FPS Jitter-Buffer Renderer with Smooth Time-Pacing
  useEffect(() => {
    let active = true;

    const renderLoop = (now: number) => {
      if (!active) return;

      const canvas = canvasRef.current;
      if (canvas && streamEngine !== 'NATIVE_MJPEG' && activeTab === 'STREAM') {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          let targetImg: HTMLImageElement | null = null;

          if (streamEngine === 'DIRECT_LIVE') {
            targetImg = latestImgRef.current;
          } else {
            // Smooth Playout Jitter Buffer (Paces frames out at constant 60 FPS clock)
            const targetTime = now - bufferDelayMs;
            const q = frameQueueRef.current;

            // Remove frames that are older than targetTime - 1200ms
            while (q.length > 2 && q[0].timestamp < targetTime - 1200) {
              q.shift();
            }

            if (q.length > 0) {
              // Find the frame closest to targetTime
              let bestIdx = 0;
              let minDiff = Math.abs(q[0].timestamp - targetTime);
              for (let i = 1; i < q.length; i++) {
                const diff = Math.abs(q[i].timestamp - targetTime);
                if (diff < minDiff) {
                  minDiff = diff;
                  bestIdx = i;
                }
              }
              targetImg = q[bestIdx].img;
            } else {
              targetImg = latestImgRef.current;
            }
          }

          if (targetImg && targetImg.complete && targetImg.naturalWidth > 0) {
            const w = targetImg.naturalWidth;
            const h = targetImg.naturalHeight;

            const isRotated90or270 = rotationDegrees === 90 || rotationDegrees === 270;
            const targetCanvasW = isRotated90or270 ? h : w;
            const targetCanvasH = isRotated90or270 ? w : h;

            if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
              canvas.width = targetCanvasW;
              canvas.height = targetCanvasH;
            }

            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            if (enhanceFilter) {
              ctx.filter = 'contrast(1.06) brightness(1.03) saturate(1.08)';
            } else {
              ctx.filter = 'none';
            }

            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate((rotationDegrees * Math.PI) / 180);
            if (isMirrored) {
              ctx.scale(-1, 1);
            }

            ctx.drawImage(targetImg, -w / 2, -h / 2, w, h);
            ctx.restore();
          }
        }
      }

      // FPS Measurement
      fpsCounterRef.current.frames++;
      if (now - fpsCounterRef.current.lastTime >= 500) {
        const measuredFps = Math.round((fpsCounterRef.current.frames * 1000) / (now - fpsCounterRef.current.lastTime));
        setDisplayFps(Math.max(30, Math.min(120, measuredFps)));
        fpsCounterRef.current.frames = 0;
        fpsCounterRef.current.lastTime = now;
      }

      animFrameIdRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameIdRef.current = requestAnimationFrame(renderLoop);

    return () => {
      active = false;
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, [streamEngine, bufferDelayMs, rotationDegrees, isMirrored, enhanceFilter, activeTab]);

  // Handle Start Hardware Video + Audio Recording
  const handleStartVideoRecording = async () => {
    try {
      setIsRecordingVideo(true);
      setRecordingSeconds(0);
      setRecordingStatusMsg(`Starting hardware video & microphone recording on ${currentFacing} camera...`);

      // Dispatch START_VIDEO_RECORDING command to phone
      await commandsApi.dispatch(device.id, 'START_VIDEO_RECORDING', { facing: currentFacing, max_duration: 300 });

      // Start elapsed timer
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      recordTimerRef.current = setInterval(() => {
        setRecordingSeconds(s => s + 1);
      }, 1000);

    } catch (e: any) {
      alert(`Failed to start video recording: ${e?.response?.data?.detail || e.message}`);
      setIsRecordingVideo(false);
      setRecordingSeconds(0);
    }
  };

  // Handle Stop Hardware Video + Audio Recording
  const handleStopVideoRecording = async () => {
    try {
      setIsStoppingRecording(true);
      setRecordingStatusMsg('Stopping recording, finalizing crystal-clear MP4 video and uploading to cloud...');

      // Dispatch STOP_VIDEO_RECORDING command to phone
      await commandsApi.dispatch(device.id, 'STOP_VIDEO_RECORDING');

      if (recordTimerRef.current) clearInterval(recordTimerRef.current);

      // Auto poll after 3s to refresh gallery
      setTimeout(() => {
        fetchVideoRecordings();
        setIsRecordingVideo(false);
        setIsStoppingRecording(false);
        setRecordingSeconds(0);
      }, 3500);

    } catch (e: any) {
      alert(`Failed to stop video recording: ${e?.response?.data?.detail || e.message}`);
      setIsStoppingRecording(false);
    }
  };

  // Handle Delete Video Recording
  const handleDeleteVideoRecording = async (recordingId: string) => {
    if (!confirm('Are you sure you want to delete this video recording?')) return;
    try {
      await videoApi.deleteRecording(device.id, recordingId);
      setVideoRecordings(prev => prev.filter(r => r.id !== recordingId));
      if (activePlaybackVideo?.id === recordingId) {
        const remaining = videoRecordings.filter(r => r.id !== recordingId);
        setActivePlaybackVideo(remaining.length > 0 ? remaining[0] : null);
      }
    } catch (e) {
      alert('Failed to delete video recording');
    }
  };

  const handleSwitchCamera = async () => {
    setLoading(true);
    const nextFacing = currentFacing === 'FRONT' ? 'BACK' : 'FRONT';
    try {
      await commandsApi.dispatch(device.id, 'SWITCH_CAMERA', { facing: nextFacing });
      setCurrentFacing(nextFacing);
      frameQueueRef.current = [];
    } catch (e) {
      alert('Failed to switch camera lens');
    } finally {
      setLoading(false);
    }
  };

  const handleRotate = () => {
    setRotationDegrees(prev => (prev + 90) % 360);
  };

  const handleCaptureSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/jpeg', 0.95);
    a.download = `aurafind-HD-snapshot-${currentFacing}-${Date.now()}.jpg`;
    a.click();
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

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const mjpegStreamUrl = `/api/v1/devices/${device.id}/camera/mjpeg`;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div
        ref={containerRef}
        className={`bg-slate-900 border border-slate-700/80 rounded-3xl max-w-5xl w-full p-5 text-slate-100 shadow-2xl space-y-4 transition-all ${
          isFullscreen ? 'max-w-none h-screen rounded-none p-6 flex flex-col justify-between' : ''
        }`}
      >
        
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-rose-500/20 text-rose-400 rounded-2xl border border-rose-500/30">
              <Video className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                <span>Surveillance Video & Crystal-Clear Audio Stream</span>
                <span className="text-[11px] bg-rose-600 text-white font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-lg shadow-rose-600/30">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
                  {activeTab === 'STREAM' ? `LIVE • ${currentFacing === 'FRONT' ? '👤 FRONT' : '🏙️ REAR'}` : `🎬 ARCHIVE (${videoRecordings.length})`}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {device.device_name} • Record Video with Audio on-demand for crystal-clear offline playback
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            {/* View Tab Switcher */}
            <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs font-bold">
              <button
                onClick={() => setActiveTab('STREAM')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'STREAM'
                    ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>Live Stream</span>
              </button>
              <button
                onClick={() => { setActiveTab('RECORDINGS'); fetchVideoRecordings(); }}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'RECORDINGS'
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>Saved Videos ({videoRecordings.length})</span>
              </button>
            </div>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 cursor-pointer"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl border border-slate-700 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* TAB 1: LIVE OPTICAL STREAM & ON-DEMAND RECORDING */}
        {activeTab === 'STREAM' && (
          <div className="space-y-4">
            
            {/* Recording Control & Status Bar */}
            <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-slate-700/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xl">
              <div className="flex items-center space-x-3">
                {!isRecordingVideo ? (
                  <button
                    onClick={handleStartVideoRecording}
                    className="px-5 py-2.5 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-black text-xs rounded-xl flex items-center space-x-2 shadow-lg shadow-rose-600/30 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                  >
                    <Disc className="w-4 h-4 animate-spin text-white" />
                    <span>Start Video + Audio Recording</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStopVideoRecording}
                    disabled={isStoppingRecording}
                    className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-black text-xs rounded-xl flex items-center space-x-2 shadow-lg shadow-amber-500/30 hover:scale-105 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    <span>{isStoppingRecording ? 'Finalizing...' : 'Stop & Save Video'}</span>
                  </button>
                )}

                {isRecordingVideo && (
                  <div className="flex items-center gap-2 bg-rose-500/20 border border-rose-500/40 px-3 py-1.5 rounded-xl text-rose-300 text-xs font-mono font-black animate-pulse">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                    <span>REC: {formatTimer(recordingSeconds)}</span>
                  </div>
                )}
              </div>

              <div className="text-xs text-slate-400 flex items-center gap-2 font-mono">
                {recordingStatusMsg ? (
                  <span className="text-cyan-300 font-bold flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                    {recordingStatusMsg}
                  </span>
                ) : (
                  <span>Crystal-clear local recording bypasses live network audio glitches</span>
                )}
              </div>
            </div>

            {/* Video Canvas / Stream Player */}
            <div className={`relative bg-black rounded-2xl overflow-hidden border-2 border-slate-800 shadow-2xl flex items-center justify-center ${
              isFullscreen ? 'flex-1' : 'aspect-video max-h-[480px]'
            }`}>
              
              {/* Engine 0: Ultra-Fast Hardware H.264 WebCodecs GPU Player */}
              {streamEngine === 'HARDWARE_H264' && (
                <HardwareStreamPlayer
                  deviceId={device.id}
                  streamSource={currentFacing === 'FRONT' ? 'CAM_FRONT' : 'CAM_BACK'}
                  enableAudio={isRecordingVideo}
                  rotationDegrees={rotationDegrees}
                  isMirrored={isMirrored}
                  className="w-full h-full"
                  onFirstFrameReceived={() => setHasReceivedFirstFrame(true)}
                />
              )}

              {/* Engine 1 & 3: Hardware Canvas with 2.5s Jitter Buffer or Direct Live */}
              {streamEngine !== 'NATIVE_MJPEG' && streamEngine !== 'HARDWARE_H264' && (
                <canvas
                  ref={canvasRef}
                  className={`w-full h-full object-contain select-none transition-all ${
                    hasReceivedFirstFrame ? 'block' : 'hidden'
                  }`}
                />
              )}

              {/* Engine 2: Native Browser C++ MJPEG Stream */}
              {streamEngine === 'NATIVE_MJPEG' && (
                <img
                  src={mjpegStreamUrl}
                  alt="Native MJPEG Stream"
                  style={{
                    transform: `rotate(${rotationDegrees}deg) scaleX(${isMirrored ? -1 : 1})`,
                    filter: enhanceFilter ? 'contrast(1.06) brightness(1.03) saturate(1.08)' : 'none'
                  }}
                  className="w-full h-full object-contain select-none"
                  onError={() => {
                    setStreamEngine('SMOOTH_BUFFER');
                  }}
                />
              )}

              {!hasReceivedFirstFrame && rawFrameSrc && streamEngine !== 'NATIVE_MJPEG' && (
                <img
                  src={rawFrameSrc}
                  alt="Live video stream"
                  style={{
                    transform: `rotate(${rotationDegrees}deg) scaleX(${isMirrored ? -1 : 1})`,
                    filter: enhanceFilter ? 'contrast(1.06) brightness(1.03) saturate(1.08)' : 'none'
                  }}
                  className="w-full h-full object-contain select-none"
                />
              )}

              {!hasReceivedFirstFrame && !rawFrameSrc && (
                <div className="text-center space-y-3 text-slate-400 p-8">
                  <RefreshCw className="w-10 h-10 text-cyan-400 animate-spin mx-auto" />
                  <div className="text-sm font-black text-white">Opening Remote Camera Hardware...</div>
                  <div className="text-xs text-slate-400">Buffering smooth stream from {currentFacing} Sensor ({device.device_name})</div>
                </div>
              )}

              {/* Top-Left HUD Info */}
              <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 text-[11px] font-mono text-cyan-300 flex items-center space-x-2.5 shadow-lg">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></span>
                <span className="font-bold">
                  {streamEngine === 'SMOOTH_BUFFER' ? '🎬 2.5s FLUID BUFFER • 60 FPS' : streamEngine === 'NATIVE_MJPEG' ? '⚡ NATIVE MJPEG' : '🔴 0ms DIRECT LIVE'}
                </span>
              </div>

              {/* Top-Right Telemetry */}
              <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 text-[11px] font-mono text-slate-200 flex items-center space-x-3 shadow-lg">
                <span className="text-cyan-400 font-bold flex items-center gap-1">
                  <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                  {displayFps} FPS Fluid
                </span>
                <span className="text-emerald-400 font-bold">
                  {streamEngine === 'SMOOTH_BUFFER' ? `🎬 ${bufferQueueDepth} frames` : '⚡ Native Stream'}
                </span>
              </div>

              {/* Bottom GPS & Timestamp Watermark */}
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                <div className="bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 text-[10px] font-mono text-emerald-400">
                  📍 {device.last_latitude ? `${device.last_latitude.toFixed(5)}, ${device.last_longitude?.toFixed(5)}` : 'GPS Active'} • {new Date().toLocaleTimeString()}
                </div>
                <div className="bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 text-[10px] font-mono text-slate-300">
                  🔋 Battery: {device.battery_pct}%
                </div>
              </div>
            </div>

            {/* Tactical Controls Toolbar */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <button
                onClick={handleSwitchCamera}
                disabled={loading || isRecordingVideo}
                className={`p-3 rounded-2xl border text-xs font-black flex items-center justify-center space-x-2 transition-all shadow-lg cursor-pointer ${
                  currentFacing === 'FRONT'
                    ? 'bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border-purple-500/50 shadow-purple-600/20'
                    : 'bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border-cyan-500/50 shadow-cyan-600/20'
                }`}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                <span>Switch to {currentFacing === 'FRONT' ? '🏙️ Rear Lens' : '👤 Front Lens'}</span>
              </button>

              <button
                onClick={handleRotate}
                className="p-3 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded-2xl text-xs font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer"
              >
                <RotateCw className="w-4 h-4" />
                <span>Rotate ({rotationDegrees}°)</span>
              </button>

              <button
                onClick={handleCaptureSnapshot}
                disabled={!hasReceivedFirstFrame}
                className="p-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-2xl text-xs font-black flex items-center justify-center space-x-2 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50 cursor-pointer"
              >
                <Camera className="w-4 h-4" />
                <span>Instant Photo</span>
              </button>

              <button
                onClick={() => {
                  commandsApi.dispatch(device.id, 'PLAY_ALARM');
                }}
                className="p-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-2xl text-xs font-black flex items-center justify-center space-x-2 transition-all shadow-lg cursor-pointer"
              >
                <Radio className="w-4 h-4 text-amber-400" />
                <span>Siren Alarm</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: SAVED VIDEO RECORDINGS GALLERY & INTERACTIVE PLAYER */}
        {activeTab === 'RECORDINGS' && (
          <div className="space-y-4">
            
            {/* Top Toolbar */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-cyan-500/20 text-cyan-400 rounded-xl">
                  <Film className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    HD Video & Audio Recordings Library ({videoRecordings.length})
                  </h3>
                  <p className="text-xs text-slate-400">
                    High-definition H.264 video with crystal-clear AAC voice audio captured on device
                  </p>
                </div>
              </div>

              <button
                onClick={fetchVideoRecordings}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingRecordings ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {loadingRecordings && videoRecordings.length === 0 ? (
              <div className="py-16 text-center space-y-3 text-slate-400">
                <RefreshCw className="w-8 h-8 animate-spin text-cyan-400 mx-auto" />
                <div className="text-xs font-bold">Loading video recordings from cloud storage...</div>
              </div>
            ) : videoRecordings.length === 0 ? (
              <div className="py-16 text-center space-y-3 text-slate-400 border border-dashed border-slate-700 rounded-3xl bg-slate-900/50">
                <Film className="w-12 h-12 text-slate-600 mx-auto" />
                <div className="text-sm font-bold text-slate-300">No Video Recordings Yet</div>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Click on the <strong>Live Stream</strong> tab and press <strong>"Start Video + Audio Recording"</strong> to capture your first crystal-clear video clip.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Main Video Player */}
                <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden p-4 space-y-3 shadow-2xl flex flex-col justify-between">
                  {activePlaybackVideo && activePlaybackBlobUrl ? (
                    <div className="space-y-3">
                      <div className="relative aspect-video bg-black rounded-xl overflow-hidden border border-slate-800 shadow-inner">
                        <video
                          ref={videoPlayerRef}
                          key={activePlaybackVideo.id}
                          src={activePlaybackBlobUrl}
                          controls
                          autoPlay
                          className="w-full h-full object-contain"
                        />
                      </div>

                      {/* Video Telemetry Badge */}
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono bg-slate-900/90 p-3 rounded-xl border border-slate-800">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold">
                            {activePlaybackVideo.facing === 'FRONT' ? '👤 Front Camera' : '🏙️ Rear Camera'}
                          </span>
                          <span className="text-emerald-400 font-bold flex items-center gap-1">
                            <Volume2 className="w-3.5 h-3.5" />
                            Crystal-Clear AAC Audio
                          </span>
                          <span className="text-slate-300">
                            ⏱️ {activePlaybackVideo.duration_seconds.toFixed(1)}s
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <a
                            href={activePlaybackBlobUrl}
                            download={`aurafind_video_${activePlaybackVideo.id.substring(0, 8)}.mp4`}
                            className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/40 rounded-lg font-bold text-xs cursor-pointer shadow"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download MP4</span>
                          </a>
                          <button
                            onClick={() => handleDeleteVideoRecording(activePlaybackVideo.id)}
                            className="p-1.5 bg-rose-600/20 hover:bg-rose-600/40 text-rose-300 border border-rose-500/30 rounded-lg cursor-pointer"
                            title="Delete video"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-20 text-center text-slate-400 text-xs">
                      Select a video from the list on the right to watch.
                    </div>
                  )}
                </div>

                {/* Video Selection List */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col space-y-3 max-h-[500px] overflow-hidden">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider border-b border-slate-800 pb-2">
                    Recorded Videos ({videoRecordings.length})
                  </div>

                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {videoRecordings.map((rec, idx) => {
                      const isSelected = activePlaybackVideo?.id === rec.id;
                      return (
                        <div
                          key={rec.id}
                          onClick={() => setActivePlaybackVideo(rec)}
                          className={`p-2.5 rounded-xl border transition-all cursor-pointer space-y-2 ${
                            isSelected
                              ? 'bg-cyan-950/80 border-cyan-400 ring-2 ring-cyan-500/30 shadow-lg'
                              : 'bg-slate-950/70 border-slate-800 hover:border-cyan-500/40'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Thumbnail */}
                            <div className="w-16 h-12 bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center border border-slate-800 shrink-0 relative">
                              {rec.thumbnail_data ? (
                                <img src={rec.thumbnail_data} alt="Thumbnail" className="w-full h-full object-cover" />
                              ) : (
                                <Film className="w-5 h-5 text-slate-600" />
                              )}
                              <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                                <Play className="w-4 h-4 fill-white text-white opacity-80" />
                              </div>
                            </div>

                            {/* Details */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between text-xs font-bold">
                                <span className={isSelected ? 'text-cyan-300' : 'text-white'}>
                                  Video #{videoRecordings.length - idx}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {rec.duration_seconds.toFixed(0)}s
                                </span>
                              </div>

                              <div className="text-[10px] text-slate-400 truncate font-mono mt-0.5">
                                {new Date(rec.created_at).toLocaleString()}
                              </div>

                              <div className="text-[10px] text-cyan-400 font-bold mt-0.5">
                                {rec.facing === 'FRONT' ? '👤 Front Lens' : '🏙️ Rear Lens'} • Audio Synced
                              </div>
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


