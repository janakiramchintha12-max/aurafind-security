import React, { useState, useEffect, useRef } from 'react';
import { 
  Headphones, Mic, MicOff, Volume2, VolumeX, Radio, Play, Square, 
  Download, Smartphone, RefreshCw, ShieldCheck, Sparkles, Send,
  Disc, Clock, Trash2, CheckCircle2, AlertCircle, Loader2
} from 'lucide-react';
import { devicesApi, commandsApi, audioApi, connectWebSocket } from '../services/api';
import { Device, AudioRecording } from '../types';

export const LiveAudioPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  // HD Audio Recording State
  const [recordDuration, setRecordDuration] = useState<number>(10);
  const [isTriggeringRecording, setIsTriggeringRecording] = useState(false);
  const [recordCountdown, setRecordCountdown] = useState<number | null>(null);
  const [recordingStatusMsg, setRecordingStatusMsg] = useState<string>('');
  const [cloudRecordings, setCloudRecordings] = useState<AudioRecording[]>([]);
  const [loadingRecordings, setLoadingRecordings] = useState(false);

  // Live Audio Stream State
  const [isListening, setIsListening] = useState(false);
  const [isPcMicActive, setIsPcMicActive] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [streamDuration, setStreamDuration] = useState(0);
  const [packetsReceived, setPacketsReceived] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  // TTS Broadcast State
  const [ttsMessage, setTtsMessage] = useState('Attention. This device is reported lost. Please contact the owner.');
  const [ttsSending, setTtsSending] = useState(false);

  // Audio Context & Visualizer Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<any>(null);

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

  // Load Cloud Audio Recordings
  const fetchRecordings = async (deviceId: string) => {
    setLoadingRecordings(true);
    try {
      const records = await audioApi.listRecordings(deviceId);
      setCloudRecordings(records);
    } catch (e) {
      console.error('Failed to fetch audio recordings', e);
    } finally {
      setLoadingRecordings(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    if (selectedDevice) {
      fetchRecordings(selectedDevice.id);
    }
  }, [selectedDevice?.id]);

  // WebSocket Listener for incoming audio & new recording notifications
  useEffect(() => {
    const cleanup = connectWebSocket((eventData) => {
      if (!selectedDevice) return;

      if (eventData?.event === 'INCOMING_AUDIO_CHUNK' && eventData.device_id === selectedDevice.id) {
        if (isListening) {
          playPcmChunk(eventData.audio_data);
        }
      }

      if (eventData?.event === 'NEW_AUDIO_RECORDING' && eventData.device_id === selectedDevice.id) {
        setRecordingStatusMsg('New HD audio recording received and ready for playback!');
        fetchRecordings(selectedDevice.id);
        setIsTriggeringRecording(false);
        setRecordCountdown(null);
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
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

  // Handle Trigger HD Audio Recording from Phone
  const handleTriggerHdRecording = async () => {
    if (!selectedDevice || isTriggeringRecording) return;

    try {
      setIsTriggeringRecording(true);
      setRecordingStatusMsg(`Command sent: Recording ${recordDuration}s HD Audio Clip on phone...`);
      setRecordCountdown(recordDuration);

      // Dispatch command to Android app
      await commandsApi.dispatch(selectedDevice.id, 'RECORD_AUDIO_CLIP', { duration_seconds: recordDuration });

      // Start countdown
      let remaining = recordDuration;
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

      countdownTimerRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          setRecordCountdown(remaining);
          setRecordingStatusMsg(`Phone is recording HD audio from hardware microphone... (${remaining}s remaining)`);
        } else {
          setRecordCountdown(0);
          setRecordingStatusMsg('Finishing recording & uploading HD audio file to cloud...');
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          
          // Poll for recording in case WebSocket is delayed
          setTimeout(() => {
            if (selectedDevice) {
              fetchRecordings(selectedDevice.id);
            }
            setIsTriggeringRecording(false);
          }, 3500);
        }
      }, 1000);

    } catch (e: any) {
      alert(`Failed to trigger HD recording: ${e?.response?.data?.detail || e.message}`);
      setIsTriggeringRecording(false);
      setRecordCountdown(null);
    }
  };

  // Delete Audio Recording
  const handleDeleteRecording = async (recordingId: string) => {
    if (!selectedDevice) return;
    if (!confirm('Are you sure you want to delete this audio recording?')) return;

    try {
      await audioApi.deleteRecording(selectedDevice.id, recordingId);
      setCloudRecordings(prev => prev.filter(r => r.id !== recordingId));
    } catch (e) {
      alert('Failed to delete recording');
    }
  };

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

  // Play incoming PCM chunk for live mode
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
    }, 150);

    const timer = setInterval(() => {
      setStreamDuration(d => d + 1);
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(timer);
    };
  }, [isListening, selectedDevice]);

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

  const formatDateTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      
      {/* Header & Device Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide flex items-center gap-2">
            <Headphones className="w-7 h-7 text-cyan-400" />
            <span>HD Audio Recording & Voice Surveillance</span>
          </h1>
          <p className="text-sm text-slate-400">
            Record crystal-clear 44.1kHz AAC HD voice clips on-demand or listen in real-time from phone microphone
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {devices.length > 1 && (
            <select
              value={selectedDevice?.id || ''}
              onChange={(e) => {
                const dev = devices.find(d => d.id === e.target.value);
                if (dev) setSelectedDevice(dev);
              }}
              className="bg-slate-800 text-slate-200 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
            >
              {devices.map(d => (
                <option key={d.id} value={d.id}>{d.device_name} ({d.device_model})</option>
              ))}
            </select>
          )}

          <button
            onClick={() => {
              fetchDevices();
              if (selectedDevice) fetchRecordings(selectedDevice.id);
            }}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition-all"
            title="Refresh Devices & Recordings"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Hero Card: ON-DEMAND HD AUDIO RECORDING (Primary Feature) */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800/95 to-slate-900 border border-cyan-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Crystal-Clear HD Audio Recording (AAC 44.1 kHz)</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              Record Microphone Audio On-Demand
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              When you click record, your phone silently captures HD audio from its hardware mic in high fidelity, saves it locally, and instantly uploads the file to your cloud archive for immediate playback and download.
            </p>

            {/* Duration Selector */}
            <div className="pt-2 flex items-center gap-3">
              <span className="text-xs text-slate-400 font-medium">Select Duration:</span>
              <div className="flex gap-2">
                {[10, 30, 60, 120].map((dur) => (
                  <button
                    key={dur}
                    onClick={() => setRecordDuration(dur)}
                    disabled={isTriggeringRecording}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      recordDuration === dur
                        ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-lg shadow-cyan-500/25 scale-105'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                    }`}
                  >
                    {dur < 60 ? `${dur}s` : `${dur / 60}m`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action Button & Live Progress */}
          <div className="flex flex-col items-center sm:items-end justify-center min-w-[280px]">
            {!isTriggeringRecording ? (
              <button
                onClick={handleTriggerHdRecording}
                disabled={!selectedDevice}
                className="w-full sm:w-auto px-8 py-4 bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-black text-base rounded-2xl flex items-center justify-center gap-3 shadow-xl shadow-cyan-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
              >
                <Disc className="w-6 h-6 animate-spin text-slate-950" />
                <span>Start {recordDuration}s HD Recording</span>
              </button>
            ) : (
              <div className="w-full bg-slate-900/90 border border-cyan-500/50 rounded-2xl p-4 shadow-xl text-center space-y-2">
                <div className="flex items-center justify-center gap-2 text-rose-400 font-black text-sm animate-pulse">
                  <span className="w-3 h-3 rounded-full bg-rose-500"></span>
                  <span>RECORDING ON PHONE ({recordCountdown !== null ? `${recordCountdown}s` : 'Processing'})</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-rose-500 to-cyan-400 h-2 transition-all duration-1000 ease-linear rounded-full"
                    style={{
                      width: recordCountdown !== null ? `${Math.max(5, ((recordDuration - recordCountdown) / recordDuration) * 100)}%` : '100%'
                    }}
                  />
                </div>
                <div className="text-[11px] text-slate-400">{recordingStatusMsg}</div>
              </div>
            )}
            
            {recordingStatusMsg && !isTriggeringRecording && (
              <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                <span>{recordingStatusMsg}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Columns: Saved HD Audio Recordings Archive & Live Stream Feed */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Cloud HD Audio Recordings Library */}
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-cyan-500/20 text-cyan-400 rounded-xl">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    HD Audio Recordings Library ({cloudRecordings.length})
                  </h3>
                  <p className="text-xs text-slate-400">
                    High-definition audio recordings stored securely in your private cloud storage
                  </p>
                </div>
              </div>

              <button
                onClick={() => selectedDevice && fetchRecordings(selectedDevice.id)}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1 bg-slate-900/60 px-3 py-1.5 rounded-xl border border-slate-700 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingRecordings ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {loadingRecordings && cloudRecordings.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-slate-400 space-y-2">
                <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                <span className="text-xs">Loading HD audio recordings...</span>
              </div>
            ) : cloudRecordings.length === 0 ? (
              <div className="text-xs text-slate-400 text-center py-10 border border-dashed border-slate-700/60 rounded-2xl bg-slate-900/40 space-y-3">
                <Disc className="w-10 h-10 text-slate-600 mx-auto" />
                <div className="font-semibold text-slate-300">No HD audio recordings yet</div>
                <p className="max-w-md mx-auto text-slate-500 text-[11px]">
                  Click the <strong>"Start HD Recording"</strong> button above to capture crystal clear voice audio from your phone's microphone.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {cloudRecordings.map((rec, index) => (
                  <div 
                    key={rec.id} 
                    className="bg-slate-900/90 border border-slate-700/80 hover:border-cyan-500/40 rounded-2xl p-4 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 text-[10px] font-bold">
                          HD AAC
                        </span>
                        <span className="text-xs font-bold text-white">
                          Recording #{cloudRecordings.length - index}
                        </span>
                        <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" />
                          {rec.duration_seconds}s
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {formatDateTime(rec.created_at)}
                      </div>
                    </div>

                    {/* HTML5 Audio Player & Controls */}
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <audio 
                        src={rec.audio_data} 
                        controls 
                        className="h-9 w-full sm:w-64 accent-cyan-500" 
                        preload="metadata"
                      />
                      <a
                        href={rec.audio_data}
                        download={`aurafind-recording-${rec.id.substring(0, 8)}.m4a`}
                        className="p-2.5 bg-slate-800 hover:bg-cyan-600 hover:text-slate-950 text-cyan-400 rounded-xl transition-all border border-slate-700 cursor-pointer"
                        title="Download M4A HD File"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                      <button
                        onClick={() => handleDeleteRecording(rec.id)}
                        className="p-2.5 bg-slate-800 hover:bg-rose-600 hover:text-white text-slate-400 rounded-xl transition-all border border-slate-700 cursor-pointer"
                        title="Delete Recording"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Real-time Streaming Studio Console (Secondary Live Feed) */}
          <div className="bg-slate-800/90 border border-slate-700/80 rounded-3xl p-6 shadow-xl relative overflow-hidden backdrop-blur space-y-4">
            
            {/* Target Status Banner */}
            <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 bg-gradient-to-tr from-cyan-600 to-blue-600 rounded-xl text-white shadow-lg shadow-cyan-600/30">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-base font-bold text-white">{selectedDevice?.device_name || 'Target Mobile Phone'}</div>
                  <div className="text-xs text-slate-400 font-mono">
                    Model: {selectedDevice?.device_model || 'Android'} • Status: <span className="text-emerald-400 font-bold">{selectedDevice?.status || 'ONLINE'}</span>
                  </div>
                </div>
              </div>

              <div className={`px-3 py-1 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${
                isListening
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse'
                  : 'bg-slate-900/60 text-slate-400 border-slate-700'
              }`}>
                <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-emerald-400' : 'bg-slate-500'}`}></span>
                <span>{isListening ? 'LIVE STREAM ACTIVE' : 'LIVE STREAM IDLE'}</span>
              </div>
            </div>

            {/* Visualizer Canvas & Decibel Display */}
            <div className="relative bg-slate-950 rounded-2xl p-4 border border-slate-800 flex flex-col items-center justify-center min-h-[160px]">
              <canvas
                ref={canvasRef}
                width={550}
                height={120}
                className="w-full h-32 rounded-xl"
              />

              {/* HUD Overlay Stats */}
              <div className="w-full flex items-center justify-between text-xs font-mono text-slate-400 pt-3 border-t border-slate-800/80 mt-2">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-500">Mic Level:</span>
                  <span className={`font-bold ${audioLevel > 50 ? 'text-rose-400' : audioLevel > 20 ? 'text-emerald-400' : 'text-cyan-400'}`}>
                    {audioLevel}% ({audioLevel > 50 ? '🔊 Loud / Voice' : audioLevel > 15 ? '🗣️ Ambient' : '🤫 Quiet'})
                  </span>
                </div>
                <div>
                  <span>Duration: </span>
                  <span className="text-white font-bold">{formatTimer(streamDuration)}</span>
                </div>
                <div>
                  <span>Packets: </span>
                  <span className="text-cyan-300 font-bold">{packetsReceived}</span>
                </div>
              </div>
            </div>

            {/* Playback Controls & Volume Slider */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center pt-2">
              
              {/* Main Play / Stop Button */}
              <div>
                {!isListening ? (
                  <button
                    onClick={handleStartListening}
                    disabled={!selectedDevice}
                    className="w-full py-3 px-6 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold border border-cyan-500/40 rounded-2xl flex items-center justify-center space-x-2 shadow-lg transition-all text-xs cursor-pointer"
                  >
                    <Play className="w-4 h-4 fill-current text-cyan-400" />
                    <span>Start Real-time Live Listening</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStopListening}
                    className="w-full py-3 px-6 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-2xl flex items-center justify-center space-x-2 shadow-xl shadow-rose-600/30 transition-all text-xs cursor-pointer"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    <span>Stop Real-time Listening</span>
                  </button>
                )}
              </div>

              {/* Volume Slider */}
              <div className="bg-slate-900/80 border border-slate-700/60 rounded-2xl p-2.5 flex items-center space-x-3">
                <button
                  onClick={() => handleVolumeChange(volume === 0 ? 1.0 : 0)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  {volume === 0 ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
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

            {/* PC Mic Toggle for Silent Mode vs Talkback */}
            <div className="pt-2">
              <button
                onClick={togglePcMic}
                disabled={!isListening}
                className={`w-full py-2.5 px-4 rounded-xl border flex items-center justify-center space-x-2 font-bold text-xs transition-all ${
                  !isListening
                    ? 'opacity-40 cursor-not-allowed bg-slate-900 border-slate-800 text-slate-500'
                    : isPcMicActive
                    ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50 shadow-lg cursor-pointer'
                    : 'bg-slate-900 hover:bg-slate-850 text-slate-300 border-slate-700 cursor-pointer'
                }`}
              >
                {isPcMicActive ? <Mic className="w-4 h-4 text-emerald-400" /> : <MicOff className="w-4 h-4 text-slate-400" />}
                <span>{isPcMicActive ? 'PC Mic: Live (Two-Way Voice Intercom)' : 'PC Mic: Muted (Silent Eavesdrop Mode)'}</span>
              </button>
            </div>

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
              Broadcast high-volume text-to-speech voice announcements directly out of the phone's hardware loudspeaker.
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
                  className="px-2 py-1 bg-slate-900 hover:bg-slate-700 border border-slate-700 text-[10px] text-slate-300 rounded-lg cursor-pointer"
                >
                  📢 Lost Device
                </button>
                <button
                  type="button"
                  onClick={() => setTtsMessage('Police tracking active. Drop this device immediately.')}
                  className="px-2 py-1 bg-slate-900 hover:bg-slate-700 border border-slate-700 text-[10px] text-rose-300 rounded-lg cursor-pointer"
                >
                  🚨 Police Warning
                </button>
                <button
                  type="button"
                  onClick={() => setTtsMessage('I am currently coming to pick up my phone.')}
                  className="px-2 py-1 bg-slate-900 hover:bg-slate-700 border border-slate-700 text-[10px] text-cyan-300 rounded-lg cursor-pointer"
                >
                  🚶 On My Way
                </button>
              </div>

              <button
                type="submit"
                disabled={ttsSending || !selectedDevice}
                className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold rounded-xl text-xs flex items-center justify-center space-x-1.5 shadow-lg shadow-amber-600/20 transition-all cursor-pointer"
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
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>HD Codec:</strong> AAC-LC 128 kbps @ 44.1 kHz Studio Quality</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>Format:</strong> MPEG-4 Audio (.m4a) with native browser decoding</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>Service:</strong> Android 14 `FOREGROUND_SERVICE_TYPE_MICROPHONE`</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className="text-emerald-400 font-bold">✓</span>
                <span><strong>Privacy:</strong> Encrypted WebSockets & SHA-256 device authentication</span>
              </li>
            </ul>
          </div>

        </div>

      </div>
    </div>
  );
};
