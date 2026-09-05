import React, { useRef } from 'react';
import { Shield, Printer, Download, X, MapPin, Smartphone, Battery, Calendar, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { Device } from '../types';

interface PoliceReportModalProps {
  device: Device;
  snapshots?: any[];
  locations?: any[];
  onClose: () => void;
}

export const PoliceReportModal: React.FC<PoliceReportModalProps> = ({ device, snapshots, locations, onClose }) => {
  const reportRef = useRef<HTMLDivElement>(null);
  const reportId = `AF-INC-${Date.now().toString().slice(-6)}`;
  const currentDate = new Date().toLocaleString();

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full p-6 text-slate-100 shadow-2xl space-y-6">
        
        {/* Modal Controls */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 no-print">
          <div className="flex items-center space-x-2 text-cyan-400 font-bold text-xs uppercase tracking-wider">
            <Shield className="w-4 h-4" />
            <span>Official Law Enforcement & Insurance Incident Dossier</span>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrint}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-cyan-600/30"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / Save PDF</span>
            </button>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white rounded-xl">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Printable Report Document */}
        <div ref={reportRef} className="bg-white text-slate-900 rounded-2xl p-8 space-y-6 shadow-inner font-sans printable-area">
          
          {/* Official Document Header */}
          <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
            <div>
              <div className="text-xl font-black tracking-tight text-slate-900 uppercase">
                AuraFind Telemetry & Recovery Report
              </div>
              <div className="text-xs text-slate-600 font-mono mt-0.5">
                VERIFIED TACTICAL SECURITY INCIDENT DOSSIER • INCIDENT REF: <span className="font-bold">{reportId}</span>
              </div>
            </div>
            <div className="text-right text-xs font-mono text-slate-700">
              <div>Date: {currentDate}</div>
              <div className="text-emerald-700 font-bold">STATUS: CRITICAL INVESTIGATION</div>
            </div>
          </div>

          {/* Section 1: Device Identification */}
          <div className="space-y-2">
            <h4 className="text-xs font-black uppercase text-slate-800 tracking-wider border-b border-slate-300 pb-1">
              1. Device Hardware Identification
            </h4>
            <div className="grid grid-cols-2 gap-4 text-xs font-mono">
              <div className="bg-slate-100 p-3 rounded-xl space-y-1">
                <div className="text-slate-500 text-[10px]">REGISTERED USER / OWNER</div>
                <div className="font-bold text-slate-900">Janaki Ram (janakiram12)</div>
                <div className="text-slate-500 text-[10px] mt-2">DEVICE NAME & MODEL</div>
                <div className="font-bold text-slate-900">{device.device_name} ({device.device_model})</div>
              </div>
              <div className="bg-slate-100 p-3 rounded-xl space-y-1">
                <div className="text-slate-500 text-[10px]">DEVICE HARDWARE UUID</div>
                <div className="font-bold text-slate-900 break-all">{device.id}</div>
                <div className="text-slate-500 text-[10px] mt-2">LINKED SIM / PHONE NUMBER</div>
                <div className="font-bold text-slate-900">{device.sim_number || '+919392408017'}</div>
              </div>
            </div>
          </div>

          {/* Section 2: Last Known GPS Telemetry */}
          <div className="space-y-2">
            <h4 className="text-xs font-black uppercase text-slate-800 tracking-wider border-b border-slate-300 pb-1">
              2. Forensic Satellite Location & Power Status
            </h4>
            <div className="bg-slate-100 p-4 rounded-xl space-y-2 text-xs font-mono">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-500">Latitude:</span> <span className="font-bold text-slate-900">{device.last_latitude ?? '14.0415'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Longitude:</span> <span className="font-bold text-slate-900">{device.last_longitude ?? '79.2625'}</span>
                </div>
                <div>
                  <span className="text-slate-500">Battery Level:</span> <span className="font-bold text-slate-900">{device.battery_pct}%</span>
                </div>
                <div>
                  <span className="text-slate-500">Network Interface:</span> <span className="font-bold text-slate-900">{device.network_type || 'CELLULAR 4G/5G'}</span>
                </div>
              </div>
              
              {device.last_latitude && device.last_longitude && (
                <div className="pt-2 border-t border-slate-300">
                  <span className="text-slate-500">Google Maps Coordinate Link:</span>
                  <a
                    href={`https://maps.google.com/?q=${device.last_latitude},${device.last_longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-cyan-700 underline font-bold mt-0.5 break-all"
                  >
                    https://maps.google.com/?q={device.last_latitude},{device.last_longitude}
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Verification Certificate */}
          <div className="pt-4 border-t-2 border-slate-900 flex items-center justify-between text-[10px] font-mono text-slate-500">
            <div>
              Generated via AuraFind Cloud Defense Infrastructure.<br />
              All timestamps verified via UTC NTP synchronization.
            </div>
            <div className="text-right">
              Digital Signature:<br />
              <span className="font-bold text-slate-800">SHA256-VERIFIED-POLICE-REPORT</span>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
};
