import React, { useState } from 'react';
import { Volume2, Megaphone, Send, X, ShieldAlert, Sparkles, Check } from 'lucide-react';
import { commandsApi } from '../services/api';
import { Device } from '../types';

interface TtsVoiceModalProps {
  device: Device;
  onClose: () => void;
}

const PRESET_MESSAGES = [
  "Attention. This phone is actively tracked by police. Return it immediately to Janaki.",
  "Warning! Unauthorized possession detected. Drop this phone or police will arrive at this GPS location.",
  "Hello, you found my lost phone. Please call 9392408017 to return it for a cash reward.",
  "Emergency security alarm activated. This device is reporting live telemetry to the owner."
];

export const TtsVoiceModal: React.FC<TtsVoiceModalProps> = ({ device, onClose }) => {
  const [customText, setCustomText] = useState(PRESET_MESSAGES[0]);
  const [sending, setSending] = useState(false);
  const [sentSuccess, setSentSuccess] = useState(false);

  const handleBroadcast = async (textToSpeak: string) => {
    if (!textToSpeak.trim()) return;
    setSending(true);
    setSentSuccess(false);
    try {
      await commandsApi.dispatch(device.id, 'SPEAK_TEXT', { text: textToSpeak.trim() });
      setSentSuccess(true);
      setTimeout(() => setSentSuccess(false), 3000);
    } catch (e) {
      alert('Failed to send voice broadcast command');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700/80 rounded-3xl max-w-lg w-full p-6 text-slate-100 shadow-2xl space-y-5">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30">
              <Megaphone className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base font-black text-white">Remote Voice Megaphone (TTS)</h2>
              <p className="text-xs text-slate-400">{device.device_name} • Speaks at 100% Maximum Speaker Volume</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-xl">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Presets */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">Quick Presets</label>
          <div className="grid grid-cols-1 gap-2">
            {PRESET_MESSAGES.map((msg, idx) => (
              <button
                key={idx}
                onClick={() => setCustomText(msg)}
                className={`text-left p-2.5 rounded-xl border text-xs transition-all ${
                  customText === msg
                    ? 'bg-amber-500/20 border-amber-500/60 text-amber-200'
                    : 'bg-slate-800/60 border-slate-700/60 text-slate-300 hover:bg-slate-800'
                }`}
              >
                "{msg}"
              </button>
            ))}
          </div>
        </div>

        {/* Custom Text Area */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">Custom Message</label>
          <textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            rows={3}
            className="w-full bg-slate-950 border border-slate-700 rounded-2xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
            placeholder="Type any text for your phone to speak out loud..."
          />
        </div>

        {/* Broadcast Action */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-[11px] text-slate-400">
            {sentSuccess ? (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Broadcasted to phone speaker!
              </span>
            ) : (
              'Overrides Silent / DND modes'
            )}
          </span>

          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2.5 bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold hover:bg-slate-700"
            >
              Close
            </button>
            <button
              onClick={() => handleBroadcast(customText)}
              disabled={sending || !customText.trim()}
              className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black rounded-xl text-xs flex items-center space-x-2 shadow-lg shadow-amber-500/20 disabled:opacity-50"
            >
              <Volume2 className="w-4 h-4" />
              <span>{sending ? 'Broadcasting...' : 'Speak Out Loud'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
