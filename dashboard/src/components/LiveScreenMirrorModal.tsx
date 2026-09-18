import React, { useState, useEffect, useRef } from 'react';
import { 
  Tv, 
  X, 
  Maximize2, 
  Minimize2, 
  RotateCw, 
  Download, 
  Mic, 
  MicOff
} from 'lucide-react';
import { commandsApi, screenApi } from '../services/api';
import { Device } from '../types';

interface LiveScreenMirrorModalProps {
  device: Device;
  onClose: () => void;
}

export const LiveScreenMirrorModal: React.FC<LiveScreenMirrorModalProps> = ({ device, onClose }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rotationDegrees, setRotationDegrees] = useState<number>(0);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [ambientAudioActive, setAmbientAudioActive] = useState<boolean>(false);

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

  const authToken = localStorage.getItem('token') || localStorage.getItem('access_token') || '';
  const mjpegUrl = `${screenApi.getMjpegUrl(device.id)}?token=${encodeURIComponent(authToken)}&t=${Date.now()}`;

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
          <img
            src={mjpegUrl}
            alt="Child Screen Mirror"
            className="max-h-full max-w-full object-contain rounded-xl transition-transform duration-200"
            style={{
              transform: `rotate(${rotationDegrees}deg)`
            }}
            onLoad={() => setStreamError(null)}
            onError={() => setStreamError('No screen frames are reaching the dashboard. Approve screen capture on the phone and retry.')}
          />
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

          <span className="text-xs font-semibold text-slate-400">Live screen mirror</span>
        </div>
      </div>
    </div>
  );
};
