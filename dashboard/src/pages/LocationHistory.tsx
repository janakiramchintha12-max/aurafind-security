import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { Calendar, Filter, Smartphone, MapPin, RefreshCw, Clock, Download } from 'lucide-react';
import { devicesApi, locationsApi } from '../services/api';
import { Device, LocationRecord } from '../types';

const historyIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [20, 32],
  iconAnchor: [10, 32],
});

export const LocationHistoryPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [range, setRange] = useState<string>('today');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [history, setHistory] = useState<LocationRecord[]>([]);
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

  const fetchHistory = async () => {
    if (!selectedDeviceId) return;
    setLoading(true);
    try {
      const records = await locationsApi.getHistory(selectedDeviceId, range, startDate, endDate);
      setHistory(records);
    } catch (e) {
      console.error('Failed to load location history', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [selectedDeviceId, range]);

  const handleExportCSV = () => {
    if (history.length === 0) return alert('No location history records to export.');
    
    const headers = ['Timestamp', 'Latitude', 'Longitude', 'Accuracy (m)', 'Battery (%)', 'Provider', 'Offline Sync'];
    const rows = history.map(loc => [
      new Date(loc.client_timestamp).toISOString(),
      loc.latitude,
      loc.longitude,
      loc.accuracy,
      loc.battery_level ?? '',
      loc.provider,
      loc.is_offline_record ? 'Yes' : 'No'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `aurafind_location_history_${selectedDeviceId}_${range}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const polylineCoords: [number, number][] = history.map((loc) => [loc.latitude, loc.longitude]);
  const centerCoord: [number, number] = polylineCoords.length > 0 ? polylineCoords[0] : [37.7749, -122.4194];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      
      {/* Header & Filter Controls */}
      <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-wide">Location History & Route Trails</h1>
            <p className="text-sm text-slate-400">Historical GPS points, accuracy, battery logs & offline sync records</p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={handleExportCSV}
              className="flex items-center space-x-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-600/30"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={fetchHistory}
              className="flex items-center space-x-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-cyan-600/30"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Fetch History</span>
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-700/60">
          
          {/* Device Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Select Device</label>
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.device_name} ({d.device_model})
                </option>
              ))}
            </select>
          </div>

          {/* Preset Date Range */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Time Horizon</label>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </div>

          {/* Custom Date Filter */}
          {range === 'custom' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-slate-400 mb-0.5">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-400 mb-0.5">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 text-xs text-white"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Map & List Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[65vh]">
        
        {/* Route Map */}
        <div className="lg:col-span-2 bg-slate-800/80 border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl relative">
          <MapContainer center={centerCoord} zoom={13} style={{ width: '100%', height: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {polylineCoords.length > 1 && (
              <Polyline positions={polylineCoords} pathOptions={{ color: '#0284c7', weight: 4, opacity: 0.8 }} />
            )}

            {history.map((loc, idx) => (
              <Marker key={loc.id} position={[loc.latitude, loc.longitude]} icon={historyIcon}>
                <Popup>
                  <div className="p-1 space-y-1 text-slate-900 text-xs">
                    <div className="font-bold text-cyan-700">Point #{idx + 1}</div>
                    <div>Lat: {loc.latitude.toFixed(5)}, Lng: {loc.longitude.toFixed(5)}</div>
                    <div>Accuracy: ±{loc.accuracy}m</div>
                    <div>Battery: {loc.battery_level ?? 'N/A'}%</div>
                    <div className="font-mono text-[10px] text-slate-500">
                      {new Date(loc.client_timestamp).toLocaleString()}
                    </div>
                    {loc.is_offline_record && (
                      <span className="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold text-[10px]">
                        Synchronized Offline Record
                      </span>
                    )}
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Location Point Timeline List */}
        <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-4 overflow-y-auto space-y-2 shadow-xl">
          <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase mb-2">
            Logged GPS Fixes ({history.length})
          </h3>

          {history.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-xs">No historical points found for this range.</div>
          ) : (
            history.map((loc, idx) => (
              <div key={loc.id} className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl text-xs space-y-1">
                <div className="flex items-center justify-between font-bold text-white">
                  <span>Point #{idx + 1}</span>
                  <span className="text-[10px] text-cyan-400 font-mono">
                    {new Date(loc.client_timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-slate-400 font-mono text-[11px]">
                  {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Accuracy: ±{loc.accuracy}m</span>
                  {loc.is_offline_record && (
                    <span className="text-amber-400 font-semibold">Offline Sync</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
};
