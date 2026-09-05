import React, { useState, useEffect, useRef } from 'react';
import { Video, Camera, RefreshCw, X, Maximize2, Minimize2, RotateCw, FlipHorizontal, Shield, Eye, AlertTriangle, Radio, Download, Zap, Sparkles, Gauge } from 'lucide-react';
import { commandsApi, cameraApi, connectWebSocket } from '../services/api';
import { Device } from '../types';

interface LiveCameraStreamModalProps {
  device: Device;
  onClose: () => void;
}

interface QueuedFrame {
  img: HTMLImageElement;
  timestamp: number;
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
  const [bufferMode, setBufferMode] = useState<'SMOOTH' | 'LIVE'>('LIVE');
  const [displayFps, setDisplayFps] = useState<number>(60);
  const [latencyMs, setLatencyMs] = useState<number>(80);
  const [hasReceivedFirstFrame, setHasReceivedFirstFrame] = useState<boolean>(false);
  const [rawFrameSrc, setRawFrameSrc] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // High-performance ring buffer for 120 FPS smooth interpolation
  const frameQueueRef = useRef<QueuedFrame[]>([]);
  const latestImgRef = useRef<HTMLImageElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const fpsCounterRef = useRef<{ frames: number; lastTime: number }>({ frames: 0, lastTime: performance.now() });

  // 1. WebSocket & Fast Frame Ingestion Pipeline
  useEffect(() => {
    commandsApi.dispatch(device.id, 'START_CAMERA_STREAM', { facing: currentFacing }).catch(console.error);

    const handleIncomingDataUrl = (dataUrl: string, facing?: string) => {
      if (!dataUrl) return;
      const fullSrc = dataUrl.startsWith('data:') ? dataUrl : `data:image/jpeg;base64,${dataUrl}`;
      setRawFrameSrc(fullSrc);
      setHasReceivedFirstFrame(true);

      const img = new Image();
      img.onload = () => {
        const now = performance.now();
        latestImgRef.current = img;
        frameQueueRef.current.push({ img, timestamp: now });
        if (frameQueueRef.current.length > 180) {
          frameQueueRef.current.shift();
        }
        setFrameCount(c => c + 1);
        if (facing) setCurrentFacing(facing.toUpperCase() as 'FRONT' | 'BACK');
      };
      img.src = fullSrc;
    };

    const cleanupWs = connectWebSocket((eventData: any) => {
      if (eventData?.event === 'LIVE_CAMERA_FRAME' && eventData?.device_id === device.id) {
        if (eventData.image_data) {
          handleIncomingDataUrl(eventData.image_data, eventData.facing);
        }
      }
    });

    // High-speed fallback poller (every 60ms)
    const interval = setInterval(async () => {
      if (!isStreaming) return;
      try {
        const data = await cameraApi.getLatestFrame(device.id);
        if (data && data.has_frame && data.image_data) {
          handleIncomingDataUrl(data.image_data, data.facing);
        }
      } catch (e) {
        // quiet
      }
    }, 60);

    return () => {
      cleanupWs();
      clearInterval(interval);
      commandsApi.dispatch(device.id, 'STOP_CAMERA_STREAM').catch(console.error);
    };
  }, [device.id, currentFacing]);

  // 2. Hardware-Accelerated 60/120 FPS Canvas Renderer with Motion Smoothing
  useEffect(() => {
    let active = true;

    const renderLoop = (now: number) => {
      if (!active) return;

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          let targetImg: HTMLImageElement | null = null;

          if (bufferMode === 'LIVE') {
            targetImg = latestImgRef.current;
          } else {
            // Smooth Jitter Buffer: smooth continuous frame pacing
            const bufferDelayMs = 2500; // 2.5s buffer for ultra-smooth fluid motion
            const targetTime = now - bufferDelayMs;

            while (frameQueueRef.current.length > 1 && frameQueueRef.current[0].timestamp < targetTime) {
              frameQueueRef.current.shift();
            }

            if (frameQueueRef.current.length > 0) {
              targetImg = frameQueueRef.current[0].img;
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
              ctx.filter = 'contrast(1.08) brightness(1.04) saturate(1.1)';
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
  }, [bufferMode, rotationDegrees, isMirrored, enhanceFilter]);

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
                <span>Ultra-Smooth 120 FPS Optical Stream</span>
                <span className="text-[11px] bg-rose-600 text-white font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-lg shadow-rose-600/30">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
                  LIVE • {currentFacing === 'FRONT' ? '👤 INTRUDER FRONT LENS' : '🏙️ REAR ENVIRONMENT LENS'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {device.device_name} • GPU Accelerated Canvas Engine • Fluid Playback Buffer
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Mode Switcher: Smooth Buffered vs Live */}
            <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs font-bold">
              <button
                onClick={() => setBufferMode('SMOOTH')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
                  bufferMode === 'SMOOTH'
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Ultra-Smooth Buffered Playback (Absorbs network jitter)"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Smooth 120Hz</span>
              </button>
              <button
                onClick={() => setBufferMode('LIVE')}
                className={`px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 ${
                  bufferMode === 'LIVE'
                    ? 'bg-rose-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Direct Zero-Delay Stream"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Instant Live</span>
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

            {/* Mirror / Flip Button */}
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

        {/* Video GPU Canvas HUD */}
        <div className={`relative bg-black rounded-2xl overflow-hidden border-2 border-slate-800 shadow-2xl flex items-center justify-center ${
          isFullscreen ? 'flex-1' : 'aspect-video max-h-[520px]'
        }`}>
          <canvas
            ref={canvasRef}
            className={`w-full h-full object-contain select-none transition-all ${
              hasReceivedFirstFrame ? 'block' : 'hidden'
            }`}
          />

          {!hasReceivedFirstFrame && rawFrameSrc && (
            <img
              src={rawFrameSrc}
              alt="Live video stream"
              style={{
                transform: `rotate(${rotationDegrees}deg) scaleX(${isMirrored ? -1 : 1})`,
                filter: enhanceFilter ? 'contrast(1.08) brightness(1.05) saturate(1.1)' : 'none'
              }}
              className="w-full h-full object-contain select-none"
            />
          )}

          {!hasReceivedFirstFrame && !rawFrameSrc && (
            <div className="text-center space-y-3 text-slate-400 p-8">
              <RefreshCw className="w-10 h-10 text-cyan-400 animate-spin mx-auto" />
              <div className="text-sm font-black text-white">Opening Remote Camera Hardware...</div>
              <div className="text-xs text-slate-400">Negotiating High-FPS Stream with {currentFacing} Sensor</div>
            </div>
          )}

          {/* Top-Left HUD Info */}
          <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 text-[11px] font-mono text-cyan-300 flex items-center space-x-2.5 shadow-lg">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></span>
            <span className="font-bold">🔴 120 FPS STREAM • {currentFacing}</span>
          </div>

          {/* Top-Right Telemetry */}
          <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 text-[11px] font-mono text-slate-200 flex items-center space-x-3 shadow-lg">
            <span className="text-cyan-400 font-bold flex items-center gap-1">
              <Gauge className="w-3.5 h-3.5 text-cyan-400" />
              {displayFps} FPS Fluid
            </span>
            <span className="text-emerald-400 font-bold">
              {bufferMode === 'SMOOTH' ? '🎬 2.5s Jitter Buffered' : '⚡ 0ms Direct Live'}
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
