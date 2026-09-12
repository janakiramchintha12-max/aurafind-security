import React, { useState, useEffect, useRef } from 'react';
import { 
  Tv, 
  RefreshCw, 
  X, 
  Maximize2, 
  Minimize2, 
  RotateCw, 
  Download, 
  Mic, 
  MicOff, 
  Activity, 
  Layers,
  Sparkles,
  Zap
} from 'lucide-react';
import { commandsApi, screenApi, connectWebSocket } from '../services/api';
import { Device } from '../types';
import { HardwareStreamPlayer } from './HardwareStreamPlayer';

interface LiveScreenMirrorModalProps {
  device: Device;
  onClose: () => void;
}

export const LiveScreenMirrorModal: React.FC<LiveScreenMirrorModalProps> = ({ device, onClose }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [streamEngine, setStreamEngine] = useState<'HARDWARE_H264' | 'NATIVE_MJPEG' | 'SMOOTH_BUFFER'>('HARDWARE_H264');
  const [hasReceivedFirstFrame, setHasReceivedFirstFrame] = useState<boolean>(false);
  const [ambientAudioActive, setAmbientAudioActive] = useState<boolean>(false);
  const [streamStats, setStreamStats] = useState({ fps: 60, latencyMs: 35, kbps: 1200, resolution: '720p' });

  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleDownloadSnapshot = () => {
    const canvas = containerRef.current?.querySelector('canvas');
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
                <h3 className="text-base font-bold text-white tracking-wide">Real-Time Screen Mirroring</h3>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-sm shadow-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full mr-1.5 bg-emerald-400 animate-ping"></span>
                  ULTRA-LOW LATENCY (&lt; 50ms)
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
          {streamEngine === 'HARDWARE_H264' ? (
            <HardwareStreamPlayer
              deviceId={device.id}
              streamSource="SCREEN"
              enableAudio={ambientAudioActive}
              rotationDegrees={rotationDegrees}
              className="w-full h-full"
              onStatsChange={setStreamStats}
              onFirstFrameReceived={() => setHasReceivedFirstFrame(true)}
            />
          ) : (
            <img
              src={mjpegUrl}
              alt="Child Screen Mirror"
              className="max-h-full max-w-full object-contain rounded-xl transition-transform duration-200"
              style={{
                transform: `rotate(${rotationDegrees}deg)`
              }}
              onLoad={() => setHasReceivedFirstFrame(true)}
              onError={() => setStreamEngine('HARDWARE_H264')}
            />
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

          {/* Engine Selector */}
          <div className="flex items-center space-x-1 bg-slate-900/80 p-1 rounded-xl border border-slate-700/50 text-xs">
            <button
              onClick={() => setStreamEngine('HARDWARE_H264')}
              className={`px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                streamEngine === 'HARDWARE_H264' ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-amber-300" />
              <span>Hardware H.264 (FlashKid Engine)</span>
            </button>
            <button
              onClick={() => setStreamEngine('NATIVE_MJPEG')}
              className={`px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                streamEngine === 'NATIVE_MJPEG' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              MJPEG Fallback
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
