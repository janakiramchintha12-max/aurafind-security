import React, { useState, useEffect, useRef } from 'react';
import { 
  Tv, 
  X, 
  Maximize2, 
  Minimize2, 
  RotateCw, 
  Download, 
  Mic, 
  MicOff,
  RefreshCw,
  Gauge
} from 'lucide-react';
import { commandsApi, screenApi, connectWebSocket } from '../services/api';
import { Device } from '../types';

interface LiveScreenMirrorModalProps {
  device: Device;
  onClose: () => void;
}

interface QueuedScreenFrame {
  img: HTMLImageElement;
  timestamp: number;
}

export const LiveScreenMirrorModal: React.FC<LiveScreenMirrorModalProps> = ({ device, onClose }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [ambientAudioActive, setAmbientAudioActive] = useState<boolean>(false);
  const [hasReceivedFirstFrame, setHasReceivedFirstFrame] = useState(false);
  const [fps, setFps] = useState(0);
  const [frameCount, setFrameCount] = useState(0);

  // 2.5s jitter buffer delay for movie/video playback smoothing
  const bufferDelayMs = 2500;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameQueueRef = useRef<QueuedScreenFrame[]>([]);
  const latestImgRef = useRef<HTMLImageElement | null>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const lastSeenKeyRef = useRef<string>('');
  const lastFrameReceivedTimeRef = useRef<number>(performance.now());
  const fpsCounterRef = useRef<{ frames: number; lastTime: number }>({ frames: 0, lastTime: performance.now() });

  // 1. Send START_SCREEN_MIRROR command upon opening
  useEffect(() => {
    const startMirroring = async () => {
      try {
        await commandsApi.dispatch(device.id, 'START_SCREEN_MIRROR');
      } catch (err) {
        console.error('Failed to dispatch START_SCREEN_MIRROR command', err);
      }
    };
    startMirroring();

    return () => {
      commandsApi.dispatch(device.id, 'STOP_SCREEN_MIRROR').catch(() => {});
    };
  }, [device.id]);

  // 2. Ingest frames via WebSocket & Polling fallback with Jitter Buffer
  useEffect(() => {
    const handleIncomingFrame = (dataUrl: string, timestamp?: string) => {
      if (!dataUrl) return;
      const fullSrc = dataUrl.startsWith('data:') ? dataUrl : `data:image/jpeg;base64,${dataUrl}`;
      const frameKey = timestamp || fullSrc.slice(-32);
      if (lastSeenKeyRef.current === frameKey) return;
      lastSeenKeyRef.current = frameKey;
      lastFrameReceivedTimeRef.current = performance.now();

      const img = new Image();
      img.onload = () => {
        const now = performance.now();
        latestImgRef.current = img;
        frameQueueRef.current.push({ img, timestamp: now });
        // Keep queue capped at ~150 frames (~6s max)
        if (frameQueueRef.current.length > 150) {
          frameQueueRef.current.shift();
        }
        setHasReceivedFirstFrame(true);
        setFrameCount(c => c + 1);
        setStreamError(null);
      };
      img.src = fullSrc;
    };

    // Initial check for latest frame
    screenApi.getLatestFrame(device.id).then((data) => {
      if (data?.has_frame && data.image_data) {
        handleIncomingFrame(data.image_data, data.timestamp);
      }
    }).catch(() => {});

    // WebSocket real-time frame receiver
    const cleanupWs = connectWebSocket((eventData: any) => {
      if (eventData?.event === 'LIVE_SCREEN_FRAME' && eventData?.device_id === device.id && eventData.image_data) {
        handleIncomingFrame(eventData.image_data, eventData.timestamp);
      }
    });

    // Fallback polling watchdog if WebSocket goes quiet
    const watchdogInterval = setInterval(async () => {
      if (performance.now() - lastFrameReceivedTimeRef.current > 600) {
        try {
          const data = await screenApi.getLatestFrame(device.id);
          if (data?.has_frame && data.image_data) {
            handleIncomingFrame(data.image_data, data.timestamp);
          }
        } catch (e) {}
      }
    }, 450);

    return () => {
      cleanupWs();
      clearInterval(watchdogInterval);
    };
  }, [device.id]);

  // 3. Jitter-Buffered Playout Render Loop (Smooth constant-frame playback for movies/video)
  useEffect(() => {
    let active = true;

    const renderLoop = (now: number) => {
      if (!active) return;
      const canvas = canvasRef.current;

      if (canvas) {
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          const targetTime = now - bufferDelayMs;
          const q = frameQueueRef.current;

          // Prune frames older than 1.5s past playback target
          while (q.length > 2 && q[0].timestamp < targetTime - 1500) {
            q.shift();
          }

          let targetImg: HTMLImageElement | null = null;
          if (q.length > 0) {
            // Find frame closest to buffered target playout time
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

          if (targetImg && targetImg.complete && targetImg.naturalWidth > 0) {
            const w = targetImg.naturalWidth;
            const h = targetImg.naturalHeight;
            const isRot = rotationDegrees === 90 || rotationDegrees === 270;
            const cw = isRot ? h : w;
            const ch = isRot ? w : h;

            if (canvas.width !== cw || canvas.height !== ch) {
              canvas.width = cw;
              canvas.height = ch;
            }

            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            ctx.translate(cw / 2, ch / 2);
            ctx.rotate((rotationDegrees * Math.PI) / 180);
            ctx.drawImage(targetImg, -w / 2, -h / 2, w, h);
            ctx.restore();
          }
        }
      }

      fpsCounterRef.current.frames++;
      if (now - fpsCounterRef.current.lastTime >= 500) {
        setFps(Math.max(0, Math.min(60, Math.round((fpsCounterRef.current.frames * 1000) / (now - fpsCounterRef.current.lastTime)))));
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
  }, [rotationDegrees]);

  const handleDownloadSnapshot = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const link = document.createElement('a');
      link.download = `Child_Screen_${device.device_name}_${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  };

  const toggleAmbientAudio = async () => {
    try {
      if (!ambientAudioActive) {
        await commandsApi.dispatch(device.id, 'RECORD_AUDIO_CLIP', { duration_seconds: 300 });
        setAmbientAudioActive(true);
      } else {
        await commandsApi.dispatch(device.id, 'STOP_AUDIO_CLIP');
        setAmbientAudioActive(false);
      }
    } catch (e) {
      console.error('Audio toggle error', e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        ref={containerRef}
        className={`bg-slate-900 border border-indigo-500/30 rounded-3xl shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ${
          isFullscreen 
            ? 'fixed inset-0 rounded-none w-screen h-screen z-50' 
            : 'w-full max-w-4xl h-[92vh] max-h-[850px]'
        }`}
      >
        {/* Header Bar */}
        <div className="px-5 py-3.5 bg-slate-800/90 border-b border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-indigo-400">
              <Tv className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white tracking-wide">HD Screen Mirroring</h3>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm shadow-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-emerald-400 animate-ping"></span>
                  SMOOTH BUFFERED (2.5s DELAY · HD 720p)
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">Device: {device.device_name} ({device.device_model})</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={toggleAmbientAudio}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                ambientAudioActive
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/30 animate-pulse'
                  : 'bg-slate-700/60 hover:bg-slate-700 text-slate-300'
              }`}
              title="Listen to ambient microphone audio"
            >
              {ambientAudioActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
              <span>{ambientAudioActive ? 'Listening Live...' : 'Listen Audio'}</span>
            </button>

            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-rose-400 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
              title="Close Viewer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Video Canvas / Stream Player */}
        <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden p-2">
          <canvas
            ref={canvasRef}
            className={`max-h-full max-w-full object-contain rounded-xl select-none transition-all ${
              hasReceivedFirstFrame ? 'block' : 'hidden'
            }`}
          />

          {!hasReceivedFirstFrame && (
            <div className="text-center space-y-3 text-slate-400 p-8">
              <RefreshCw className="w-10 h-10 text-indigo-400 animate-spin mx-auto" />
              <div className="text-sm font-black text-white">Connecting to HD Screen Capture...</div>
              <div className="text-xs text-slate-400">
                Buffering frames (2-3s smoothing) from {device.device_name}. Ensure screen capture permission is allowed on phone.
              </div>
            </div>
          )}

          {/* HUD Overlay */}
          {hasReceivedFirstFrame && (
            <>
              <div className="absolute top-4 left-4 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-[11px] font-mono text-indigo-300 flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span className="font-bold">HD 720p · JITTER BUFFER 2.5s</span>
              </div>
              <div className="absolute top-4 right-4 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-[11px] font-mono text-slate-300 flex items-center space-x-2">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                <span>{fps} FPS ({frameCount} frames)</span>
              </div>
            </>
          )}

          {streamError && (
            <div className="absolute inset-x-4 bottom-4 rounded-xl border border-rose-500/40 bg-rose-950/90 px-4 py-3 text-sm text-rose-100">
              {streamError}
            </div>
          )}
        </div>

        {/* Bottom Controls Bar */}
        <div className="px-5 py-3 bg-slate-800/90 border-t border-slate-700/60 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setRotationDegrees(r => (r + 90) % 360)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Rotate ({rotationDegrees}°)</span>
            </button>

            <button
              onClick={handleDownloadSnapshot}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Screenshot</span>
            </button>
          </div>

          <span className="text-xs font-semibold text-slate-400">
            High-definition movie &amp; app playback with 2.5s delay buffer
          </span>
        </div>
      </div>
    </div>
  );
};
