import React, { useState, useEffect, useRef } from 'react';
import { 
  Tv, 
  RefreshCw, 
  X, 
  Maximize2, 
  Minimize2, 
  RotateCw, 
  Download, 
  Radio, 
  Sparkles, 
  Gauge, 
  Sliders, 
  Mic, 
  MicOff, 
  Activity, 
  Smartphone, 
  Layers
} from 'lucide-react';
import { commandsApi, screenApi, connectWebSocket } from '../services/api';
import { Device } from '../types';

interface LiveScreenMirrorModalProps {
  device: Device;
  onClose: () => void;
}

export const LiveScreenMirrorModal: React.FC<LiveScreenMirrorModalProps> = ({ device, onClose }) => {
  const [isStreaming, setIsStreaming] = useState(true);
  const [frameCount, setFrameCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [streamEngine, setStreamEngine] = useState<'NATIVE_MJPEG' | 'SMOOTH_BUFFER' | 'DIRECT_LIVE'>('NATIVE_MJPEG');
  const [displayFps, setDisplayFps] = useState<number>(20);
  const [hasReceivedFirstFrame, setHasReceivedFirstFrame] = useState<boolean>(false);
  const [rawFrameSrc, setRawFrameSrc] = useState<string | null>(null);
  const [ambientAudioActive, setAmbientAudioActive] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 1. Send START_SCREEN_MIRROR command upon opening
  useEffect(() => {
    const startMirroring = async () => {
      try {
        setLoading(true);
        await commandsApi.dispatch(device.id, 'START_SCREEN_MIRROR');
      } catch (err) {
        console.error('Failed to dispatch START_SCREEN_MIRROR command', err);
      } finally {
        setLoading(false);
      }
    };
    startMirroring();

    return () => {
      // Send STOP_SCREEN_MIRROR command on modal unmount
      commandsApi.dispatch(device.id, 'STOP_SCREEN_MIRROR').catch(() => {});
    };
  }, [device.id]);

  // 2. Connect WebSocket for Real-time Live Screen Frames
  useEffect(() => {
    let wsCleanup: (() => void) | null = null;
    let lastFpsTime = Date.now();
    let framesThisSecond = 0;

    wsCleanup = connectWebSocket((msg: any) => {
      if (msg.event === 'LIVE_SCREEN_FRAME' && msg.device_id === device.id && msg.image_data) {
        setHasReceivedFirstFrame(true);
        setRawFrameSrc(msg.image_data);
        setFrameCount(prev => prev + 1);

        framesThisSecond++;
        const now = Date.now();
        if (now - lastFpsTime >= 1000) {
          setDisplayFps(framesThisSecond);
          framesThisSecond = 0;
          lastFpsTime = now;
        }

        // Draw to Canvas if in SMOOTH_BUFFER or DIRECT_LIVE mode
        if (streamEngine !== 'NATIVE_MJPEG' && canvasRef.current) {
          const img = new Image();
          img.onload = () => {
            const canvas = canvasRef.current;
            if (canvas) {
              canvas.width = img.width || 540;
              canvas.height = img.height || 960;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              }
            }
          };
          img.src = msg.image_data;
        }
      }
    });

    return () => {
      if (wsCleanup) wsCleanup();
    };
  }, [device.id, streamEngine]);

  const handleDownloadSnapshot = () => {
    const link = document.createElement('a');
    link.download = `Child_Screen_${device.device_name}_${Date.now()}.png`;
    if (streamEngine !== 'NATIVE_MJPEG' && canvasRef.current) {
      link.href = canvasRef.current.toDataURL('image/png');
    } else if (rawFrameSrc) {
      link.href = rawFrameSrc;
    }
    link.click();
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

  const mjpegUrl = `${screenApi.getMjpegUrl(device.id)}?t=${Date.now()}`;

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
                <h3 className="text-base font-bold text-white tracking-wide">Live Screen Mirroring</h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  <span className="w-1.5 h-1.5 rounded-full mr-1 bg-emerald-400 animate-ping"></span>
                  LIVE STREAM
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">Child: {device.device_name} ({device.device_model})</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={toggleAmbientAudio}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                ambientAudioActive
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/30'
                  : 'bg-slate-700/60 hover:bg-slate-700 text-slate-300'
              }`}
              title="Listen to ambient microphone audio"
            >
              {ambientAudioActive ? <Mic className="w-3.5 h-3.5 animate-pulse" /> : <MicOff className="w-3.5 h-3.5" />}
              <span>{ambientAudioActive ? 'Listening In...' : 'Listen Audio'}</span>
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
          {streamEngine === 'NATIVE_MJPEG' ? (
            <img
              src={mjpegUrl}
              alt="Child Screen Mirror"
              className="max-h-full max-w-full object-contain rounded-xl transition-transform duration-200"
              style={{
                transform: `rotate(${rotationDegrees}deg)`
              }}
              onLoad={() => setHasReceivedFirstFrame(true)}
              onError={() => {
                // Auto-fallback to WebSocket canvas if MJPEG dropped
                if (!hasReceivedFirstFrame) {
                  setStreamEngine('SMOOTH_BUFFER');
                }
              }}
            />
          ) : (
            <canvas
              ref={canvasRef}
              className="max-h-full max-w-full object-contain rounded-xl transition-transform duration-200"
              style={{
                transform: `rotate(${rotationDegrees}deg)`
              }}
            />
          )}

          {/* Telemetry HUD Overlay */}
          <div className="absolute top-4 left-4 flex flex-col space-y-1.5 bg-slate-950/70 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-700/50 text-[11px] font-mono text-slate-300 pointer-events-none">
            <div className="flex items-center space-x-1.5 text-indigo-400 font-bold">
              <Activity className="w-3.5 h-3.5" />
              <span>FPS: {displayFps} fps</span>
            </div>
            <div className="text-slate-400">
              Frames: {frameCount} | Mode: {streamEngine}
            </div>
          </div>

          {/* Loading Indicator */}
          {loading && !hasReceivedFirstFrame && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 space-y-3">
              <div className="w-10 h-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
              <p className="text-xs font-bold text-slate-300">Connecting to Child Screen...</p>
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
              <span>Rotate</span>
            </button>

            <button
              onClick={handleDownloadSnapshot}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Screenshot</span>
            </button>
          </div>

          {/* Engine Selector */}
          <div className="flex items-center space-x-1 bg-slate-900/80 p-1 rounded-xl border border-slate-700/50 text-xs">
            <button
              onClick={() => setStreamEngine('NATIVE_MJPEG')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                streamEngine === 'NATIVE_MJPEG' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Native MJPEG
            </button>
            <button
              onClick={() => setStreamEngine('SMOOTH_BUFFER')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                streamEngine === 'SMOOTH_BUFFER' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Direct Canvas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
