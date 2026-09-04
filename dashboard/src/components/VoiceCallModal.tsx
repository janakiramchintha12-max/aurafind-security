import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, Shield, Radio, RefreshCw, X, AlertCircle } from 'lucide-react';
import { commandsApi, audioApi, connectWebSocket } from '../services/api';
import { Device } from '../types';

interface VoiceCallModalProps {
  device: Device;
  onClose: () => void;
}

export const VoiceCallModal: React.FC<VoiceCallModalProps> = ({ device, onClose }) => {
  const [callStatus, setCallStatus] = useState<'CONNECTING' | 'CONNECTED' | 'ENDED'>('CONNECTING');
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [packetCount, setPacketCount] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  useEffect(() => {
    // 1. Dispatch START_VOICE_CALL command to the device
    commandsApi.dispatch(device.id, 'START_VOICE_CALL').catch(console.error);

    // Initialize Web Audio Context for bidirectional audio
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx({ sampleRate: 16000 });
    audioContextRef.current = ctx;

    // 2. Capture Laptop Microphone
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        mediaStreamRef.current = stream;
        setCallStatus('CONNECTED');

        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (isMuted) return;
          const inputData = e.inputBuffer.getChannelData(0);
          // Convert Float32 to Int16 PCM
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }

          // Base64 encode PCM buffer
          const bytes = new Uint8Array(pcmData.buffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);

          // Stream audio chunk to phone
          audioApi.sendDashboardAudio(device.id, base64).catch(() => {});
          setPacketCount(c => c + 1);
        };

        source.connect(processor);
        processor.connect(ctx.destination);
      })
      .catch((err) => {
        console.error('Microphone access denied:', err);
        setCallStatus('CONNECTED'); // Still allow listening to device
      });

    // 3. Listen to incoming audio packets from device
    const cleanupWs = connectWebSocket((eventData: any) => {
      if (eventData?.event === 'INCOMING_AUDIO_CHUNK' && eventData?.device_id === device.id) {
        playPcmChunk(eventData.audio_data);
      }
    });

    // Fallback polling for incoming device audio
    const pollInterval = setInterval(async () => {
      try {
        const chunks = await audioApi.pollIncomingAudio(device.id);
        for (const chunk of chunks) {
          playPcmChunk(chunk);
        }
      } catch (e) {}
    }, 100);

    // Call duration timer
    const timer = setInterval(() => {
      setCallDuration(d => d + 1);
    }, 1000);

    return () => {
      cleanupWs();
      clearInterval(pollInterval);
      clearInterval(timer);
      endCallCleanup();
    };
  }, [device.id]);

  const playPcmChunk = (base64Audio: string) => {
    if (!audioContextRef.current) return;
    try {
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const buffer = audioContextRef.current.createBuffer(1, float32Array.length, 16000);
      buffer.getChannelData(0).set(float32Array);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContextRef.current.destination);
      source.start();
    } catch (e) {
      console.error('Error playing audio chunk', e);
    }
  };

  const endCallCleanup = () => {
    commandsApi.dispatch(device.id, 'END_VOICE_CALL').catch(console.error);
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    processorRef.current?.disconnect();
    audioContextRef.current?.close().catch(() => {});
  };

  const handleEndCall = () => {
    setCallStatus('ENDED');
    endCallCleanup();
    setTimeout(onClose, 500);
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-md w-full p-6 text-slate-100 shadow-2xl space-y-6 text-center">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2 text-emerald-400 font-bold text-xs uppercase tracking-wider">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
            <span>Two-Way Intercom Session</span>
          </div>
          <button onClick={handleEndCall} className="p-1.5 text-slate-400 hover:text-white rounded-xl">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Visualizer Circle */}
        <div className="flex flex-col items-center justify-center space-y-4 py-4">
          <div className="relative">
            {callStatus === 'CONNECTED' && (
              <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping"></div>
            )}
            <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-2xl shadow-emerald-500/40 relative z-10">
              <Phone className="w-10 h-10 animate-bounce" />
            </div>
          </div>

          <div>
            <h3 className="text-lg font-black text-white">{device.device_name}</h3>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              {callStatus === 'CONNECTING' ? 'Negotiating Audio Pipeline...' : `In Call • ${formatTimer(callDuration)}`}
            </p>
          </div>
        </div>

        {/* Audio Telemetry Info */}
        <div className="grid grid-cols-2 gap-2 text-xs bg-slate-800/80 border border-slate-700/50 rounded-2xl p-3 text-slate-300 font-mono">
          <div className="flex items-center space-x-2 justify-center">
            <Volume2 className="w-4 h-4 text-emerald-400" />
            <span>16kHz HD PCM</span>
          </div>
          <div className="flex items-center space-x-2 justify-center">
            <Radio className="w-4 h-4 text-cyan-400" />
            <span>Full Duplex</span>
          </div>
        </div>

        {/* Call Controls */}
        <div className="flex items-center justify-center space-x-4 pt-2">
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-4 rounded-2xl border transition-all shadow-lg ${
              isMuted
                ? 'bg-rose-600 text-white border-rose-500'
                : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
            }`}
            title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
          >
            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </button>

          <button
            onClick={handleEndCall}
            className="px-8 py-4 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-2xl flex items-center space-x-2 shadow-xl shadow-rose-600/30 transition-all"
          >
            <PhoneOff className="w-6 h-6" />
            <span>End Call</span>
          </button>
        </div>

      </div>
    </div>
  );
};
