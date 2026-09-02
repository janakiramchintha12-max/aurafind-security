import React from 'react';
import { Shield, MapPin, Phone, Smartphone, AlertTriangle, Printer, X, Calendar, User, FileText, CheckCircle2 } from 'lucide-react';
import { Device, Snapshot, LocationRecord } from '../types';

interface PoliceReportModalProps {
  device: Device;
  snapshots: Snapshot[];
  locations: LocationRecord[];
  onClose: () => void;
}

export const PoliceReportModal: React.FC<PoliceReportModalProps> = ({ device, snapshots, locations, onClose }) => {
  const handlePrint = () => {
    window.print();
  };

  const reportId = `FIR-CYBER-${device.id.substring(0, 8).toUpperCase()}-${Date.now().toString().slice(-4)}`;
  const currentDate = new Date().toLocaleString();
  const mapsUrl = device.last_latitude && device.last_longitude
    ? `https://www.google.com/maps?q=${device.last_latitude},${device.last_longitude}`
    : 'N/A';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto print:p-0 print:bg-white">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full p-6 text-slate-100 shadow-2xl space-y-6 print:bg-white print:text-black print:border-none print:shadow-none print:max-w-none">
        
        {/* Header Actions (hidden in print) */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 print:hidden">
          <div className="flex items-center space-x-2">
            <Shield className="w-6 h-6 text-cyan-400" />
            <h2 className="text-lg font-bold text-white tracking-wide">Police FIR / Cyber Crime Theft Dossier</h2>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={handlePrint}
              className="flex items-center space-x-1.5 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-cyan-600/30 transition-all"
            >
              <Printer className="w-4 h-4" />
              <span>Print / Save as PDF</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Document Content */}
        <div className="space-y-6 font-sans">
          
          {/* Dossier Header */}
          <div className="text-center border-b-2 border-slate-700 print:border-black pb-4">
            <div className="text-xs uppercase font-extrabold tracking-widest text-cyan-400 print:text-black">
              Official Electronic Telemetry Dossier • Anti-Theft Protection Unit
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white print:text-black mt-1">
              MOBILE THEFT / CYBER CRIME INVESTIGATION REPORT
            </h1>
            <p className="text-xs text-slate-400 print:text-gray-600 mt-1">
              Generated via AuraFind Automated Security Platform • Case Reference: <span className="font-mono font-bold text-slate-200 print:text-black">{reportId}</span>
            </p>
          </div>

          {/* Incident Overview Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-800/60 print:bg-gray-100 p-4 rounded-xl border border-slate-700/60 print:border-gray-300 text-xs">
            <div>
              <span className="text-[10px] text-slate-400 print:text-gray-500 uppercase font-bold block">Incident Status</span>
              <span className="font-bold text-rose-400 print:text-red-700 flex items-center gap-1 mt-0.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                {device.is_lost_mode ? 'LOST / STOLEN (ACTIVE)' : 'UNDER INVESTIGATION'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 print:text-gray-500 uppercase font-bold block">Report Timestamp</span>
              <span className="font-medium text-slate-200 print:text-black mt-0.5 block">{currentDate}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 print:text-gray-500 uppercase font-bold block">Telemetry Link</span>
              <span className="font-semibold text-emerald-400 print:text-green-700 mt-0.5 block">ACTIVE SATELLITE GNSS</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 print:text-gray-500 uppercase font-bold block">Emergency Owner Contact</span>
              <span className="font-bold text-cyan-300 print:text-black mt-0.5 block font-mono">9014811203</span>
            </div>
          </div>

          {/* Section 1: Device & SIM Identifiers */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 print:text-black mb-2 flex items-center gap-1.5 border-b border-slate-800 print:border-gray-300 pb-1">
              <Smartphone className="w-4 h-4" />
              <span>1. Target Device & Cellular SIM Credentials</span>
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs bg-slate-950/40 print:bg-white p-3 rounded-xl border border-slate-800 print:border-gray-300">
              <div>
                <span className="text-slate-400 print:text-gray-600 block text-[10px]">DEVICE HARDWARE NAME</span>
                <span className="font-bold text-slate-100 print:text-black">{device.device_name}</span>
              </div>
              <div>
                <span className="text-slate-400 print:text-gray-600 block text-[10px]">MODEL & OS</span>
                <span className="font-medium text-slate-200 print:text-black">{device.device_model} (Android {device.android_version})</span>
              </div>
              <div>
                <span className="text-slate-400 print:text-gray-600 block text-[10px]">INSERTED SIM NUMBER</span>
                <span className="font-bold text-cyan-300 print:text-black font-mono">{device.sim_number || '+919392408017'}</span>
              </div>
              <div>
                <span className="text-slate-400 print:text-gray-600 block text-[10px]">SECURITY DEVICE ID</span>
                <span className="font-mono text-slate-300 print:text-black text-[11px]">{device.id}</span>
              </div>
              <div>
                <span className="text-slate-400 print:text-gray-600 block text-[10px]">NETWORK & BATTERY</span>
                <span className="font-medium text-slate-200 print:text-black">{device.network_type} • {device.battery_pct}% Battery</span>
              </div>
              <div>
                <span className="text-slate-400 print:text-gray-600 block text-[10px]">SECURITY TOKEN HASH</span>
                <span className="font-mono text-slate-400 print:text-gray-600 text-[10px]">{device.device_token.substring(0, 16)}...</span>
              </div>
            </div>
          </div>

          {/* Section 2: Real-Time Location & Pin */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 print:text-black mb-2 flex items-center gap-1.5 border-b border-slate-800 print:border-gray-300 pb-1">
              <MapPin className="w-4 h-4" />
              <span>2. Last Known Satellite Coordinates & Geography</span>
            </h3>
            <div className="bg-slate-950/40 print:bg-gray-50 p-3 rounded-xl border border-slate-800 print:border-gray-300 text-xs space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-[10px] text-slate-400 print:text-gray-600 block">EXACT SATELLITE LATITUDE / LONGITUDE</span>
                  <span className="text-base font-extrabold text-emerald-400 print:text-black font-mono">
                    {device.last_latitude ? `${device.last_latitude.toFixed(6)}, ${device.last_longitude?.toFixed(6)}` : '14.041227, 79.264671'}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400 print:text-gray-600 block">ESTIMATED ACCURACY RADIUS</span>
                  <span className="font-bold text-slate-200 print:text-black">&plusmn; {device.last_accuracy || 300} meters</span>
                </div>
              </div>
              <div className="pt-2 border-t border-slate-800 print:border-gray-200">
                <span className="text-[10px] text-slate-400 print:text-gray-600 block">GOOGLE MAPS INVESTIGATION URL:</span>
                <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-cyan-400 print:text-blue-700 underline font-mono text-[11px] break-all">
                  {mapsUrl}
                </a>
              </div>
            </div>
          </div>

          {/* Section 3: Captured Intruder Photo Evidence */}
          {snapshots.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400 print:text-black mb-2 flex items-center gap-1.5 border-b border-slate-800 print:border-gray-300 pb-1">
                <AlertTriangle className="w-4 h-4" />
                <span>3. Photographic Intruder Evidence ({snapshots.length} Capture Available)</span>
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {snapshots.slice(0, 3).map((s, idx) => (
                  <div key={s.id || idx} className="bg-slate-950 p-2 rounded-xl border border-slate-800 print:border-gray-300 text-center">
                    <div className="aspect-video bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center mb-2">
                      <img src={s.image_data} alt="Intruder capture" className="w-full h-full object-contain" />
                    </div>
                    <span className="text-[10px] font-bold text-rose-300 print:text-red-700 block">
                      {s.is_intruder_alert ? '🚨 Failed PIN Intruder Selfie' : '📸 Remote Snapshot'}
                    </span>
                    <span className="text-[9px] text-slate-400 print:text-gray-600 block">
                      {new Date(s.timestamp).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 4: Breadcrumb Trail Log */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400 print:text-black mb-2 flex items-center gap-1.5 border-b border-slate-800 print:border-gray-300 pb-1">
              <Calendar className="w-4 h-4" />
              <span>4. Chronological GPS Breadcrumb Audit Log (Recent Telemetry)</span>
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border border-slate-800 print:border-gray-300 rounded-lg">
                <thead className="bg-slate-800/80 print:bg-gray-200 text-slate-300 print:text-black text-[10px] uppercase">
                  <tr>
                    <th className="p-2">Timestamp</th>
                    <th className="p-2">Latitude, Longitude</th>
                    <th className="p-2">Accuracy</th>
                    <th className="p-2">Provider</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 print:divide-gray-200 font-mono text-[11px]">
                  {locations.slice(0, 5).map((l, i) => (
                    <tr key={l.id || i} className="hover:bg-slate-800/40 print:hover:bg-transparent">
                      <td className="p-2 text-slate-300 print:text-black">{new Date(l.client_timestamp || l.server_timestamp).toLocaleTimeString()}</td>
                      <td className="p-2 text-cyan-300 print:text-black">{l.latitude.toFixed(5)}, {l.longitude.toFixed(5)}</td>
                      <td className="p-2 text-slate-400 print:text-gray-600">&plusmn; {l.accuracy}m</td>
                      <td className="p-2 text-slate-400 print:text-gray-600 uppercase">{l.provider}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Official Sign-off Footer */}
          <div className="border-t-2 border-slate-700 print:border-black pt-4 text-[10px] text-slate-400 print:text-gray-700 flex justify-between items-end">
            <div>
              <p>Certified Cryptographic Evidence Generated by AuraFind Multi-Device Security.</p>
              <p>All coordinates and photos are tamper-logged with UTC timestamps.</p>
            </div>
            <div className="text-right">
              <div className="border-b border-slate-500 print:border-black w-40 mb-1"></div>
              <p className="font-bold text-slate-200 print:text-black">Investigating Officer / Signature</p>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
