import React, { useState, useEffect } from 'react';
import { Radio, Send, Smartphone, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { devicesApi, commandsApi } from '../services/api';
import { Device, Command } from '../types';

export const CommandsPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [commandType, setCommandType] = useState<string>('LOCATE_NOW');
  const [payloadText, setPayloadText] = useState('{}');
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function loadDevices() {
      const list = await devicesApi.list();
      setDevices(list);
      if (list.length > 0) {
        setSelectedDeviceId(list[0].id);
      }
    }
    loadDevices();
  }, []);

  const fetchCommands = async () => {
    if (!selectedDeviceId) return;
    try {
      const cmds = await commandsApi.list(selectedDeviceId);
      setCommands(cmds);
    } catch (e) {
      console.error('Failed to fetch commands', e);
    }
  };

  useEffect(() => {
    fetchCommands();
  }, [selectedDeviceId]);

  const handleDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDeviceId) return;
    setLoading(true);
    try {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(payloadText);
      } catch (err) {
        alert('Invalid JSON payload');
        setLoading(false);
        return;
      }
      await commandsApi.dispatch(selectedDeviceId, commandType, parsedPayload);
      fetchCommands();
    } catch (e) {
      alert('Failed to dispatch command');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Remote Command Dispatch</h1>
          <p className="text-sm text-slate-400">Authenticated remote instruction execution platform</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Dispatch Form */}
        <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <Radio className="w-5 h-5 text-cyan-400" />
            <span>Issue New Command</span>
          </h3>

          <form onSubmit={handleDispatch} className="space-y-4 text-xs">
            <div>
              <label className="block font-medium text-slate-300 mb-1">Target Device</label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
              >
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.device_name} ({d.status})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-300 mb-1">Command Action</label>
              <select
                value={commandType}
                onChange={(e) => setCommandType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
              >
                <option value="LOCATE_NOW">LOCATE_NOW (Request fresh GPS fix)</option>
                <option value="HIGH_ACCURACY_MODE">HIGH_ACCURACY_MODE (15s updates)</option>
                <option value="PLAY_ALARM">PLAY_ALARM (Override silent & play tone)</option>
                <option value="DISPLAY_MESSAGE">DISPLAY_MESSAGE (Full-screen message)</option>
                <option value="REFRESH_STATUS">REFRESH_STATUS (Battery & Telemetry update)</option>
                <option value="FORCE_SYNC">FORCE_SYNC (Flush offline Room database)</option>
                <option value="TOGGLE_TRACKING">TOGGLE_TRACKING (Enable / Disable)</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-300 mb-1">Parameters (JSON Payload)</label>
              <textarea
                rows={3}
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 font-mono text-white text-[11px]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl shadow-lg shadow-cyan-600/30 flex items-center justify-center space-x-2"
            >
              <Send className="w-4 h-4" />
              <span>{loading ? 'Dispatching...' : 'Dispatch Remote Command'}</span>
            </button>
          </form>
        </div>

        {/* Audit Trail List */}
        <div className="lg:col-span-2 bg-slate-800/80 border border-slate-700/60 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-base font-bold text-white">Execution Audit Trail ({commands.length})</h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Command ID</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Dispatched At</th>
                  <th className="py-2.5 px-3">Response / Execution Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {commands.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">No remote commands logged.</td>
                  </tr>
                ) : (
                  commands.map((cmd) => (
                    <tr key={cmd.id} className="hover:bg-slate-900/40">
                      <td className="py-2.5 px-3 font-mono text-slate-400">{cmd.id.substring(0, 8)}...</td>
                      <td className="py-2.5 px-3 font-bold text-cyan-300">{cmd.command_type}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          cmd.status === 'EXECUTED' ? 'bg-emerald-500/10 text-emerald-400' :
                          cmd.status === 'FAILED' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {cmd.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">{new Date(cmd.created_at).toLocaleString()}</td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300 max-w-xs truncate">{cmd.result || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
};
