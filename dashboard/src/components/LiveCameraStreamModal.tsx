import React, { useState, useEffect } from 'react';
import { Video, Camera, RefreshCw, X, Maximize2, Shield, Eye, AlertTriangle, Radio, Download } from 'lucide-react';
import { commandsApi, connectWebSocket } from '../services/api';
import { Device } from '../types';

interface LiveCameraStreamModalProps {
  device: Device;
  onClose: () => void;
}

export const LiveCameraStreamModal: React.FC<LiveCameraStreamModalProps> = ({ device, onClose }) => {
  const [currentFacing, setCurrentFacing] = useState<'FRONT' | 'BACK'>('FRONT');
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(true);
  const [fps, setFps] = useState(5.0);
  const [frameCount, setFrameCount] = useState(0);
  const [loading, setLoading] = useState(false);

  // Poll for latest frame as fallback + WebSocket real-time frame event
  useEffect(() => {
    // Send Start Stream command to device
    commandsApi.dispatch(device.id, 'START_CAMERA_STREAM', { facing: currentFacing }).catch(console.error);

    const cleanupWs = connectWebSocket((eventData: any) => {
      if (eventData?.event === 'LIVE_CAMERA_FRAME' && eventData?.device_id === device.id) {
        if (eventData.image_data) {
          setCurrentFrame(eventData.image_data);
          setFrameCount(c => c + 1);
          if (eventData.facing) setCurrentFacing(eventData.facing);
        }
      }
    });

    // Also poll /camera/latest every 700ms for continuous smooth feed
    const interval = setInterval(async () => {
      if (!isStreaming) return;
      try {
        const res = await fetch(`http://127.0.0.1:8000/api/v1/devices/${device.id}/camera/latest`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.has_frame && data.image_data) {
            setCurrentFrame(data.image_data);
            setFrameCount(c => c + 1);
            if (data.facing) setCurrentFacing(data.facing);
          }
        }
      } catch (e) {
        // quiet fallback
      }
    }, 700);

    return () => {
      cleanupWs();
      clearInterval(interval);
      // Send Stop Stream command on unmount
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

  const handleCaptureSnapshot = () => {
    if (!currentFrame) return;
    const a = document.createElement('a');
    a.href = currentFrame;
    a.download = `aurafind-camera-${currentFacing}-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full p-5 text-slate-100 shadow-2xl space-y-4">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-rose-500/20 text-rose-400 rounded-xl">
              <Video className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                <span>Tactical Real-Time Camera Stream</span>
                <span className="text-[10px] bg-rose-600 text-white font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                  LIVE {currentFacing === 'FRONT' ? 'FRONT LENS' : 'REAR LENS'}
                </span>
              </h2>
              <p className="text-xs text-slate-400">{device.device_name} • {device.device_model}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCaptureSnapshot}
              disabled={!currentFrame}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-bold border border-slate-700 transition-all disabled:opacity-50"
              title="Save snapshot frame"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save Frame</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Video Canvas HUD */}
        <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border-2 border-slate-800 shadow-inner flex items-center justify-center">
          {currentFrame ? (
            <img
              src={currentFrame.startsWith('data:') ? (currentFrame.includes('utf8,%3C') ? decodeURIComponent(currentFrame.replace('data:image/svg+xml;utf8,', 'data:image/svg+xml;utf8,')) : currentFrame) : `data:image/jpeg;base64,${currentFrame}`}
              alt="Live video stream"
              className="w-full h-full object-contain select-none"
            />
          ) : (
            <div className="text-center space-y-2 text-slate-400">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
              <div className="text-xs font-bold text-slate-300">Initializing Remote Camera Feed...</div>
              <div className="text-[10px] text-slate-500">Connecting to {currentFacing} Lens via Secure Stream</div>
            </div>
          )}

          {/* HUD Overlay Details */}
          <div className="absolute top-3 left-3 bg-black/60 backdrop-blur px-2.5 py-1 rounded-lg border border-white/10 text-[10px] font-mono text-cyan-300 flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
            <span>REC • {currentFacing === 'FRONT' ? 'FRONT (INTRUDER)' : 'REAR (ENVIRONMENT)'}</span>
          </div>

          <div className="absolute top-3 right-3 bg-black/60 backdrop-blur px-2.5 py-1 rounded-lg border border-white/10 text-[10px] font-mono text-slate-300">
            FPS: ~5.0 • Frames: {frameCount}
          </div>

          {/* Bottom GPS Watermark */}
          {device.last_latitude && device.last_longitude && (
            <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur px-2.5 py-1 rounded-lg border border-white/10 text-[10px] font-mono text-emerald-400">
              📍 {device.last_latitude.toFixed(5)}, {device.last_longitude.toFixed(5)} • {new Date().toLocaleTimeString()}
            </div>
          )}
        </div>

        {/* Tactical Controls Toolbar */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <button
            onClick={handleSwitchCamera}
            disabled={loading}
            className={`p-3 rounded-xl border text-xs font-bold flex items-center justify-center space-x-2 transition-all ${
              currentFacing === 'FRONT'
                ? 'bg-purple-600/30 hover:bg-purple-600/40 text-purple-200 border-purple-500/40'
                : 'bg-cyan-600/30 hover:bg-cyan-600/40 text-cyan-200 border-cyan-500/40'
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Switch to {currentFacing === 'FRONT' ? '🏙️ Rear Environment Lens' : '👤 Front Intruder Lens'}</span>
          </button>

          <button
            onClick={handleCaptureSnapshot}
            disabled={!currentFrame}
            className="p-3 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-all disabled:opacity-50"
          >
            <Camera className="w-4 h-4 text-cyan-400" />
            <span>Freeze Frame Snapshot</span>
          </button>

          <button
            onClick={() => {
              commandsApi.dispatch(device.id, 'PLAY_ALARM');
            }}
            className="col-span-2 md:col-span-1 p-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded-xl text-xs font-bold flex items-center justify-center space-x-2 transition-all"
          >
            <Radio className="w-4 h-4 text-amber-400" />
            <span>Trigger Alarm with Video</span>
          </button>
        </div>

      </div>
    </div>
  );
};
