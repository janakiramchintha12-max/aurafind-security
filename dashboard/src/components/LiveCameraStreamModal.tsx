import React, { useState, useEffect, useRef } from 'react';
import { Video, Camera, RefreshCw, X, Maximize2, Minimize2, RotateCw, FlipHorizontal, Radio, Download, Zap, Sparkles, Gauge, Sliders } from 'lucide-react';
import { commandsApi, cameraApi, connectWebSocket } from '../services/api';
import { Device } from '../types';

interface LiveCameraStreamModalProps {
  device: Device;
  onClose: () => void;
}

interface QueuedFrame {
  img: HTMLImageElement;
  timestamp: number;
  seq?: number;
}

export const LiveCameraStreamModal: React.FC<LiveCameraStreamModalProps> = ({ device, onClose }) => {
  const [currentFacing, setCurrentFacing] = useState<'FRONT' | 'BACK'>('FRONT');
  const [isStreaming, setIsStreaming] = useState(true);
  const [frameCount, setFrameCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [isMirrored, setIsMirrored] = useState<boolean>(false);
  const [enhanceFilter, setEnhanceFilter] = useState<boolean>(true);
  const [streamEngine, setStreamEngine] = useState<'SMOOTH_BUFFER' | 'NATIVE_MJPEG' | 'DIRECT_LIVE'>('SMOOTH_BUFFER');
  const [bufferDelayMs, setBufferDelayMs] = useState<number>(2500); // 2.5s smooth playout delay
  const [displayFps, setDisplayFps] = useState<number>(60);
  const [bufferQueueDepth, setBufferQueueDepth] = useState<number>(0);
  const [hasReceivedFirstFrame, setHasReceivedFirstFrame] = useState<boolean>(false);
  const [rawFrameSrc, setRawFrameSrc] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // High-performance ring buffer for 60 FPS jitter-free playback
  const frameQueueRef = useRef<QueuedFrame[]>([]);
  const latestImgRef = useRef<HTMLImageElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const lastSeenKeyRef = useRef<string>('');
  const lastFrameReceivedTimeRef = useRef<number>(performance.now());
  const fpsCounterRef = useRef<{ frames: number; lastTime: number }>({ frames: 0, lastTime: performance.now() });

  // 1. WebSocket & Fast Frame Ingestion Pipeline
  useEffect(() => {
    commandsApi.dispatch(device.id, 'START_CAMERA_STREAM', { facing: currentFacing }).catch(console.error);

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
    });

    // Smart Watchdog Poller: only queries backend if WebSocket has been silent for > 500ms
    const watchdogInterval = setInterval(async () => {
      if (!isStreaming) return;
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
      commandsApi.dispatch(device.id, 'STOP_CAMERA_STREAM').catch(console.error);
    };
  }, [device.id, currentFacing]);

  // 2. Hardware-Accelerated 60 FPS Jitter-Buffer Renderer with Smooth Time-Pacing
  useEffect(() => {
    let active = true;

    const renderLoop = (now: number) => {
      if (!active) return;

      const canvas = canvasRef.current;
      if (canvas && streamEngine !== 'NATIVE_MJPEG') {
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
  }, [streamEngine, bufferDelayMs, rotationDegrees, isMirrored, enhanceFilter]);

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

  const mjpegStreamUrl = `/api/v1/devices/${device.id}/camera/mjpeg`;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div
        ref={containerRef}
        className={`bg-slate-900 border border-slate-700/80 rounded-3xl max-w-4xl w-full p-5 text-slate-100 shadow-2xl space-y-4 transition-all ${
          isFullscreen ? 'max-w-none h-screen rounded-none p-6 flex flex-col justify-between' : ''
        }`}
      >
        
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-rose-500/20 text-rose-400 rounded-2xl border border-rose-500/30">
              <Video className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-black text-white flex items-center gap-2">
                <span>Ultra-Smooth 60 FPS Optical Stream</span>
                <span className="text-[11px] bg-rose-600 text-white font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-lg shadow-rose-600/30">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
                  LIVE • {currentFacing === 'FRONT' ? '👤 INTRUDER FRONT LENS' : '🏙️ REAR ENVIRONMENT LENS'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {device.device_name} • 2.5s Fluid Jitter Buffer Engine • 60 FPS Playback
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Engine Switcher */}
            <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs font-bold">
              <button
                onClick={() => { setStreamEngine('SMOOTH_BUFFER'); setBufferDelayMs(2500); }}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
                  streamEngine === 'SMOOTH_BUFFER'
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="2.5s Jitter Buffer: Absorbs mobile cellular network delays for buttery-smooth 60 FPS video"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>🎬 Smooth 2.5s Buffer</span>
              </button>
              <button
                onClick={() => setStreamEngine('NATIVE_MJPEG')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
                  streamEngine === 'NATIVE_MJPEG'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Native C++ Browser MJPEG Stream"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>⚡ Native MJPEG</span>
              </button>
              <button
                onClick={() => setStreamEngine('DIRECT_LIVE')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
                  streamEngine === 'DIRECT_LIVE'
                    ? 'bg-rose-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Direct Zero-Delay Stream"
              >
                <span>🔴 Instant Live</span>
              </button>
            </div>

            {/* Rotate Button */}
            <button
              onClick={handleRotate}
              className="flex items-center space-x-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-xl border border-slate-700 text-xs font-bold transition-all shadow"
              title="Rotate View 90°"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Rotate ({rotationDegrees}°)</span>
            </button>

            {/* Mirror Button */}
            <button
              onClick={() => setIsMirrored(prev => !prev)}
              className={`p-2 rounded-xl border text-xs font-bold transition-all ${
                isMirrored ? 'bg-cyan-600/30 border-cyan-500 text-cyan-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              title="Mirror / Flip Horizontally"
            >
              <FlipHorizontal className="w-4 h-4" />
            </button>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700"
              title="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={handleCaptureSnapshot}
              disabled={!hasReceivedFirstFrame}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 rounded-xl text-xs font-bold border border-emerald-500/40 transition-all disabled:opacity-50 shadow"
              title="Save Snapshot"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save Photo</span>
            </button>

            <button
              onClick={onClose}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl border border-slate-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Video Canvas / Stream Player */}
        <div className={`relative bg-black rounded-2xl overflow-hidden border-2 border-slate-800 shadow-2xl flex items-center justify-center ${
          isFullscreen ? 'flex-1' : 'aspect-video max-h-[520px]'
        }`}>
          
          {/* Engine 1 & 3: Hardware Canvas with 2.5s Jitter Buffer or Direct Live */}
          {streamEngine !== 'NATIVE_MJPEG' && (
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
                // fallback to canvas if MJPEG dropped
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
              {streamEngine === 'SMOOTH_BUFFER' ? '🎬 2.5s FLUID BUFFER • 60 FPS' : streamEngine === 'NATIVE_MJPEG' ? '⚡ NATIVE MJPEG • TURBO' : '🔴 0ms DIRECT LIVE'}
            </span>
          </div>

          {/* Top-Right Telemetry */}
          <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 text-[11px] font-mono text-slate-200 flex items-center space-x-3 shadow-lg">
            <span className="text-cyan-400 font-bold flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5 text-cyan-400" />
              {displayFps} FPS Fluid
            </span>
            <span className="text-emerald-400 font-bold">
              {streamEngine === 'SMOOTH_BUFFER' ? `🎬 ${bufferQueueDepth} frames buffered` : '⚡ Native Stream'}
            </span>
            <span>🖼️ #{frameCount}</span>
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

        {/* Jitter Buffer Latency Tuning Bar */}
        {streamEngine === 'SMOOTH_BUFFER' && (
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2 text-slate-300 font-semibold">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Smooth Buffer Delay:</span>
              <span className="text-cyan-300 font-bold font-mono">{(bufferDelayMs / 1000).toFixed(1)}s</span>
              <span className="text-slate-400 text-[11px]">({bufferQueueDepth} frames in queue)</span>
            </div>
            <div className="flex items-center space-x-1.5 font-bold">
              <button
                onClick={() => setBufferDelayMs(1500)}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  bufferDelayMs === 1500
                    ? 'bg-cyan-600 text-white shadow'
                    : 'bg-slate-700/60 text-slate-300 hover:text-white'
                }`}
              >
                1.5s (Fast)
              </button>
              <button
                onClick={() => setBufferDelayMs(2500)}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  bufferDelayMs === 2500
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow'
                    : 'bg-slate-700/60 text-slate-300 hover:text-white'
                }`}
              >
                ⭐ 2.5s (Recommended Smooth)
              </button>
              <button
                onClick={() => setBufferDelayMs(3500)}
                className={`px-2.5 py-1 rounded-lg transition-all ${
                  bufferDelayMs === 3500
                    ? 'bg-purple-600 text-white shadow'
                    : 'bg-slate-700/60 text-slate-300 hover:text-white'
                }`}
              >
                3.5s (Max Stability)
              </button>
            </div>
          </div>
        )}

        {/* Tactical Controls Toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            onClick={handleSwitchCamera}
            disabled={loading}
            className={`p-3.5 rounded-2xl border text-xs font-black flex items-center justify-center space-x-2 transition-all shadow-lg ${
              currentFacing === 'FRONT'
                ? 'bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border-purple-500/50 shadow-purple-600/20'
                : 'bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border-cyan-500/50 shadow-cyan-600/20'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Switch to {currentFacing === 'FRONT' ? '🏙️ Rear Environment Lens' : '👤 Front Intruder Lens'}</span>
          </button>

          <button
            onClick={handleCaptureSnapshot}
            disabled={!hasReceivedFirstFrame}
            className="p-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-2xl text-xs font-black flex items-center justify-center space-x-2 transition-all shadow-lg shadow-emerald-600/20 disabled:opacity-50"
          >
            <Camera className="w-4 h-4" />
            <span>Instant Snapshot</span>
          </button>

          <button
            onClick={() => {
              commandsApi.dispatch(device.id, 'PLAY_ALARM');
            }}
            className="p-3.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded-2xl text-xs font-black flex items-center justify-center space-x-2 transition-all shadow-lg"
          >
            <Radio className="w-4 h-4 text-amber-400" />
            <span>Sound Loud Siren Alarm</span>
          </button>
        </div>

      </div>
    </div>
  );
};

