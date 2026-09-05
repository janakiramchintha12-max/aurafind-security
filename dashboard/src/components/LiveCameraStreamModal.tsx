import React, { useState, useEffect, useRef } from 'react';
import { Video, Camera, RefreshCw, X, Maximize2, Minimize2, RotateCw, FlipHorizontal, Shield, Eye, AlertTriangle, Radio, Download, Zap, Sparkles } from 'lucide-react';
import { commandsApi, cameraApi, connectWebSocket } from '../services/api';
import { Device } from '../types';

interface LiveCameraStreamModalProps {
  device: Device;
  onClose: () => void;
}

export const LiveCameraStreamModal: React.FC<LiveCameraStreamModalProps> = ({ device, onClose }) => {
  const [currentFacing, setCurrentFacing] = useState<'FRONT' | 'BACK'>('FRONT');
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(true);
  const [frameCount, setFrameCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [isMirrored, setIsMirrored] = useState<boolean>(false);
  const [enhanceFilter, setEnhanceFilter] = useState<boolean>(true);
  const [fps, setFps] = useState(6.0);
  const [lastFrameTimestamp, setLastFrameTimestamp] = useState<number>(Date.now());
  const [latencyMs, setLatencyMs] = useState<number>(120);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Start camera stream on device
    commandsApi.dispatch(device.id, 'START_CAMERA_STREAM', { facing: currentFacing }).catch(console.error);

    const cleanupWs = connectWebSocket((eventData: any) => {
      if (eventData?.event === 'LIVE_CAMERA_FRAME' && eventData?.device_id === device.id) {
        if (eventData.image_data) {
          setCurrentFrame(eventData.image_data);
          setFrameCount(c => c + 1);
          setLatencyMs(Math.max(40, Date.now() - lastFrameTimestamp));
          setLastFrameTimestamp(Date.now());
          if (eventData.facing) setCurrentFacing(eventData.facing);
          if (eventData.fps) setFps(eventData.fps);
        }
      }
    });

    // High-speed smooth fallback poller (every 180ms)
    const interval = setInterval(async () => {
      if (!isStreaming) return;
      try {
        const data = await cameraApi.getLatestFrame(device.id);
        if (data && data.has_frame && data.image_data) {
          setCurrentFrame(data.image_data);
          setFrameCount(c => c + 1);
          setLatencyMs(Math.max(40, Date.now() - lastFrameTimestamp));
          setLastFrameTimestamp(Date.now());
          if (data.facing) setCurrentFacing(data.facing);
          if (data.fps) setFps(data.fps);
        }
      } catch (e) {
        // quiet fallback
      }
    }, 180);

    return () => {
      cleanupWs();
      clearInterval(interval);
      commandsApi.dispatch(device.id, 'STOP_CAMERA_STREAM').catch(console.error);
    };
  }, [device.id]);

  const handleSwitchCamera = async () => {
    setLoading(true);
    const nextFacing = currentFacing === 'FRONT' ? 'BACK' : 'FRONT';
    try {
      await commandsApi.dispatch(device.id, 'SWITCH_CAMERA', { facing: nextFacing });
      setCurrentFacing(nextFacing);
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
    if (!currentFrame) return;
    const a = document.createElement('a');
    a.href = currentFrame;
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
                <span>Real-Time Optical Surveillance Feed</span>
                <span className="text-[11px] bg-rose-600 text-white font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-lg shadow-rose-600/30">
                  <span className="w-2 h-2 rounded-full bg-white animate-ping"></span>
                  LIVE • {currentFacing === 'FRONT' ? '👤 INTRUDER FRONT LENS' : '🏙️ REAR ENVIRONMENT LENS'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                {device.device_name} • Ultra-Low Latency Pipeline • Zero-Copy Stream
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
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
              disabled={!currentFrame}
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

        {/* Video Canvas HUD */}
        <div className={`relative bg-black rounded-2xl overflow-hidden border-2 border-slate-800 shadow-2xl flex items-center justify-center ${
          isFullscreen ? 'flex-1' : 'aspect-video max-h-[520px]'
        }`}>
          {currentFrame ? (
            <img
              src={currentFrame.startsWith('data:') ? currentFrame : `data:image/jpeg;base64,${currentFrame}`}
              alt="Live video stream"
              style={{
                transform: `rotate(${rotationDegrees}deg) scaleX(${isMirrored ? -1 : 1})`,
                filter: enhanceFilter ? 'contrast(1.08) brightness(1.05) saturate(1.1)' : 'none'
              }}
              className="w-full h-full object-contain select-none transition-transform duration-150"
            />
          ) : (
            <div className="text-center space-y-3 text-slate-400 p-8">
              <RefreshCw className="w-10 h-10 text-cyan-400 animate-spin mx-auto" />
              <div className="text-sm font-black text-white">Opening Remote Camera Hardware...</div>
              <div className="text-xs text-slate-400">Negotiating Instant Stream with {currentFacing} Sensor</div>
            </div>
          )}

          {/* Top-Left HUD Info */}
          <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 text-[11px] font-mono text-cyan-300 flex items-center space-x-2.5 shadow-lg">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse"></span>
            <span className="font-bold">🔴 ZERO-LAG STREAM • {currentFacing}</span>
          </div>

          {/* Top-Right Telemetry */}
          <div className="absolute top-3 right-3 bg-black/70 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/15 text-[11px] font-mono text-slate-200 flex items-center space-x-3 shadow-lg">
            <span className="text-emerald-400 font-bold">⚡ ~{latencyMs}ms Latency</span>
            <span>🖼️ Frame #{frameCount}</span>
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
            disabled={!currentFrame}
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
