import React, { useState, useEffect } from 'react';
import { 
  Smartphone, QrCode, Copy, Check, ShieldCheck, Download, 
  ExternalLink, X, RefreshCw, Radio, Key, Server, AlertCircle 
} from 'lucide-react';
import { devicesApi } from '../services/api';
import { Device } from '../types';

interface DeviceEnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialDevice?: Device | null;
}

export const DeviceEnrollmentModal: React.FC<DeviceEnrollmentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialDevice = null
}) => {
  const [step, setStep] = useState<'create' | 'credentials'>('create');
  const [deviceName, setDeviceName] = useState('');
  const [deviceModel, setDeviceModel] = useState('Android Handset');
  const [createdDevice, setCreatedDevice] = useState<Device | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isWaitingForHeartbeat, setIsWaitingForHeartbeat] = useState(false);
  const [deviceDetected, setDeviceDetected] = useState(false);

  useEffect(() => {
    if (initialDevice) {
      setCreatedDevice(initialDevice);
      setStep('credentials');
    } else {
      setStep('create');
      setCreatedDevice(null);
      setDeviceName('');
      setDeviceModel('Android Handset');
    }
    setDeviceDetected(false);
  }, [initialDevice, isOpen]);

  // Polling for first heartbeat when waiting for device to connect
  useEffect(() => {
    let timer: any = null;
    if (step === 'credentials' && createdDevice && !deviceDetected) {
      setIsWaitingForHeartbeat(true);
      timer = setInterval(async () => {
        try {
          const dev = await devicesApi.get(createdDevice.id);
          if (dev && dev.last_heartbeat) {
            setDeviceDetected(true);
            setIsWaitingForHeartbeat(false);
          }
        } catch (e) {
          // Polling wait
        }
      }, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [step, createdDevice, deviceDetected]);

  if (!isOpen) return null;

  const serverOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000';

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deviceName.trim()) return;
    setLoading(true);
    try {
      const dev = await devicesApi.register(deviceName.trim(), deviceModel.trim(), '14.0');
      setCreatedDevice(dev);
      setStep('credentials');
      if (onSuccess) onSuccess();
    } catch (err: any) {
      alert(`Registration failed: ${err?.response?.data?.detail || err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const pairingPayload = createdDevice ? JSON.stringify({
    server_url: serverOrigin,
    device_id: createdDevice.id,
    device_token: createdDevice.device_token,
    device_name: createdDevice.device_name
  }) : '';

  const qrImageUrl = pairingPayload 
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(pairingPayload)}`
    : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full shadow-2xl overflow-hidden my-8">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-gradient-to-tr from-cyan-600 to-blue-600 rounded-xl shadow-lg shadow-cyan-600/30">
              <Smartphone className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">
                {step === 'create' ? 'Pair New Android Device' : `Pairing: ${createdDevice?.device_name}`}
              </h2>
              <p className="text-xs text-slate-400">
                {step === 'create' ? 'Step 1 of 2: Name your device' : 'Step 2 of 2: Scan QR or enter credentials on handset'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6">
          
          {step === 'create' ? (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-4 text-xs text-slate-300 space-y-2">
                <div className="font-semibold text-white flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-cyan-400" />
                  <span>How Pairing Works</span>
                </div>
                <p>
                  Registering creates a cryptographic hardware token for your phone. You will receive a QR code and pairing credentials to scan directly inside the AuraFind Android App.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Device Friendly Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Motorola Edge 50, Kid's Phone, Galaxy S24"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none transition-colors"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Handset Model / Hardware Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Motorola XT2407-1, Samsung SM-S928B"
                  value={deviceModel}
                  onChange={(e) => setDeviceModel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 focus:border-cyan-500 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none transition-colors"
                />
              </div>

              <div className="pt-4 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !deviceName.trim()}
                  className="px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg shadow-cyan-600/30 transition-all flex items-center space-x-2 cursor-pointer"
                >
                  {loading && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Generate Pairing QR Code</span>
                </button>
              </div>
            </form>
          ) : (
            createdDevice && (
              <div className="space-y-6">
                
                {/* Heartbeat Status Banner */}
                {deviceDetected ? (
                  <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center space-x-3 text-emerald-300">
                    <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                    <div>
                      <div className="text-xs font-bold">Device Connected & Active!</div>
                      <div className="text-[11px] text-slate-300">Initial telemetry received. You can now track and protect this phone.</div>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-2xl flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2.5 text-cyan-300">
                      <Radio className="w-4 h-4 text-cyan-400 animate-pulse shrink-0" />
                      <span>Waiting for device connection...</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">Listening on WebSocket</span>
                  </div>
                )}

                {/* Pairing Methods Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                  
                  {/* QR Code Card */}
                  <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4 text-center space-y-3 flex flex-col items-center justify-center">
                    <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <QrCode className="w-4 h-4 text-cyan-400" />
                      <span>Instant Scan QR Code</span>
                    </div>
                    
                    <div className="p-3 bg-white rounded-2xl shadow-xl">
                      {qrImageUrl ? (
                        <img
                          src={qrImageUrl}
                          alt="Pairing QR Code"
                          className="w-48 h-48 rounded-lg object-contain"
                        />
                      ) : (
                        <div className="w-48 h-48 flex items-center justify-center text-slate-400 text-xs">
                          Generating QR...
                        </div>
                      )}
                    </div>

                    <p className="text-[11px] text-slate-400 max-w-xs">
                      Open AuraFind app on handset &rarr; Tap <strong className="text-slate-200">"Scan QR Code"</strong> to pair instantly.
                    </p>
                  </div>

                  {/* Manual Credentials List */}
                  <div className="space-y-3 text-xs">
                    <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                      <Key className="w-4 h-4 text-cyan-400" />
                      <span>Manual Pairing Credentials</span>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-1">
                      <div className="text-[10px] text-slate-500 uppercase font-bold">Server Endpoint URL</div>
                      <div className="flex items-center justify-between text-slate-300 font-mono text-[11px]">
                        <span className="truncate mr-2">{serverOrigin}</span>
                        <button
                          onClick={() => copyToClipboard(serverOrigin, 'server')}
                          className="p-1 hover:text-cyan-400 text-slate-400 transition-colors"
                          title="Copy URL"
                        >
                          {copiedKey === 'server' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-1">
                      <div className="text-[10px] text-slate-500 uppercase font-bold">Device ID</div>
                      <div className="flex items-center justify-between text-slate-300 font-mono text-[11px]">
                        <span className="truncate mr-2">{createdDevice.id}</span>
                        <button
                          onClick={() => copyToClipboard(createdDevice.id, 'id')}
                          className="p-1 hover:text-cyan-400 text-slate-400 transition-colors"
                          title="Copy Device ID"
                        >
                          {copiedKey === 'id' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 space-y-1">
                      <div className="text-[10px] text-slate-500 uppercase font-bold">Device Secret Token</div>
                      <div className="flex items-center justify-between text-slate-300 font-mono text-[11px]">
                        <span className="truncate mr-2">{createdDevice.device_token || '••••••••••••••••••••••••'}</span>
                        {createdDevice.device_token && (
                          <button
                            onClick={() => copyToClipboard(createdDevice.device_token!, 'token')}
                            className="p-1 hover:text-cyan-400 text-slate-400 transition-colors"
                            title="Copy Device Token"
                          >
                            {copiedKey === 'token' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => copyToClipboard(pairingPayload, 'payload')}
                      className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer"
                    >
                      {copiedKey === 'payload' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-300">Pairing Config Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Copy Complete Pairing JSON</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* 3-Step Setup Instructions */}
                <div className="border-t border-slate-800 pt-4 space-y-2.5 text-xs text-slate-300">
                  <div className="font-bold text-white text-xs">Fast 3-Step Onboarding:</div>
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
                    USB debugging is ready for installing the handset client, but a Render-hosted browser cannot access your computer's ADB port directly. Install the APK over USB, then complete pairing with this QR code or the copied credentials.
                  </div>
                  <ol className="list-decimal list-inside space-y-1.5 text-slate-400 text-[11px] leading-relaxed">
                    <li>
                      <strong className="text-slate-200">Install APK:</strong> Download and install AuraFind APK on the target mobile handset.
                    </li>
                    <li>
                      <strong className="text-slate-200">Pair Handset:</strong> Tap "Scan QR Code" in the app or log in with your AuraFind account credentials.
                    </li>
                    <li>
                      <strong className="text-slate-200">Grant permissions:</strong> Allow location, camera, microphone, and notifications for live telemetry and media. Screen sharing has a separate Android consent prompt.
                    </li>
                  </ol>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                  <a
                    href="/download/app.apk"
                    download="AuraFind-Security.apk"
                    className="inline-flex items-center space-x-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Download APK Handset Client</span>
                  </a>

                  <button
                    onClick={onClose}
                    className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-cyan-600/30 transition-all cursor-pointer"
                  >
                    Done
                  </button>
                </div>

              </div>
            )
          )}

        </div>

      </div>
    </div>
  );
};
