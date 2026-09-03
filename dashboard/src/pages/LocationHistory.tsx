import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Calendar, Filter, Smartphone, MapPin, RefreshCw, Clock, Download, Radio, Shield, Layers } from 'lucide-react';
import { devicesApi, locationsApi } from '../services/api';
import { Device, LocationRecord } from '../types';

// Custom Marker for GPS History Waypoints
const historyWaypointIcon = new L.DivIcon({
  className: 'history-waypoint-marker',
  html: `
    <div style="width: 22px; height: 22px; border-radius: 50%; background: #0284c7; border: 2.5px solid #ffffff; box-shadow: 0 0 10px rgba(2, 132, 199, 0.8); display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: bold;">
      📍
    </div>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -12]
});

// Dynamic Map Recenter component
function MapRecenter({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom || 15);
  }, [center, zoom, map]);
  return null;
}

export const LocationHistoryPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [range, setRange] = useState<string>('today');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [history, setHistory] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [mapTheme, setMapTheme] = useState<'satellite' | 'dark' | 'street'>('satellite');

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

  const selectedDevice = devices.find(d => d.id === selectedDeviceId);

  const polylineCoords: [number, number][] = history.map((loc) => [loc.latitude, loc.longitude]);
  
  const centerCoord: [number, number] = polylineCoords.length > 0
    ? polylineCoords[polylineCoords.length - 1]
    : selectedDevice?.last_latitude && selectedDevice?.last_longitude
    ? [selectedDevice.last_latitude, selectedDevice.last_longitude]
    : [14.0415, 79.2625];

  const tileLayerUrls = {
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    street: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      
      {/* Header & Filter Controls */}
      <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white tracking-wide flex items-center space-x-2">
              <Clock className="w-6 h-6 text-cyan-400" />
              <span>Location History & Breadcrumb Routes</span>
            </h1>
            <p className="text-sm text-slate-400">Review past travels, satellite waypoints, timestamps & battery logs</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Map Theme Switcher */}
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-1 flex items-center space-x-1 text-xs">
              <button
                onClick={() => setMapTheme('satellite')}
                className={`px-2.5 py-1.5 rounded-lg font-bold transition-all ${
                  mapTheme === 'satellite' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                🛰️ Satellite
              </button>
              <button
                onClick={() => setMapTheme('dark')}
                className={`px-2.5 py-1.5 rounded-lg font-bold transition-all ${
                  mapTheme === 'dark' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                🌌 Dark
              </button>
              <button
                onClick={() => setMapTheme('street')}
                className={`px-2.5 py-1.5 rounded-lg font-bold transition-all ${
                  mapTheme === 'street' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                🗺️ Street
              </button>
            </div>

            <button
              onClick={handleExportCSV}
              className="flex items-center space-x-1.5 px-3 py-2 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold transition-all shadow"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={fetchHistory}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-cyan-600/20"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Route</span>
            </button>
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-700/60">
          
          {/* Device Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Tracked Device</label>
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-cyan-500"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  📱 {d.device_name} ({d.device_model})
                </option>
              ))}
            </select>
          </div>

          {/* Preset Date Range */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-1">Time Horizon</label>
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-semibold text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="today">📅 Today</option>
              <option value="yesterday">⏪ Yesterday</option>
              <option value="7days">🗓️ Last 7 Days</option>
              <option value="30days">🗓️ Last 30 Days</option>
              <option value="custom">⚙️ Custom Range</option>
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

      {/* Map & Timeline Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[65vh]">
        
        {/* Route Map */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl relative">
          <MapContainer center={centerCoord} zoom={15} style={{ width: '100%', height: '100%' }}>
            <TileLayer
              key={mapTheme}
              attribution='&copy; <a href="https://www.esri.com/">Esri</a> & OpenStreetMap contributors'
              url={tileLayerUrls[mapTheme]}
            />

            <MapRecenter center={centerCoord} zoom={15} />

            {polylineCoords.length > 1 && (
              <Polyline positions={polylineCoords} pathOptions={{ color: '#06b6d4', weight: 4, opacity: 0.85 }} />
            )}

            {history.map((loc, idx) => (
              <Marker key={loc.id} position={[loc.latitude, loc.longitude]} icon={historyWaypointIcon}>
                <Popup>
                  <div className="p-1 space-y-1 text-slate-900 text-xs font-sans">
                    <div className="font-bold text-cyan-700">📍 Waypoint #{idx + 1}</div>
                    <div className="font-mono">Lat: {loc.latitude.toFixed(5)}, Lng: {loc.longitude.toFixed(5)}</div>
                    <div>Accuracy: ±{loc.accuracy}m</div>
                    <div>Battery: {loc.battery_level ?? 'N/A'}%</div>
                    <div className="text-[10px] text-slate-500">
                      {new Date(loc.client_timestamp).toLocaleString()}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>

        {/* Timeline Log List */}
        <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 flex flex-col space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-slate-700 pb-2">
            <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Recorded Waypoints</span>
            <span className="text-xs font-extrabold text-cyan-400">{history.length} fixes</span>
          </div>

          {history.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-2">
              <MapPin className="w-8 h-8 text-slate-500 opacity-50" />
              <p className="text-xs">No location fixes recorded for this time horizon.</p>
              <p className="text-[11px] text-slate-500">As your phone moves with GPS active, route trails will appear here automatically.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((loc, idx) => (
                <div
                  key={loc.id}
                  className="p-3 bg-slate-900/70 border border-slate-700/60 rounded-xl space-y-1 hover:border-cyan-500/50 transition-all"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-cyan-300">Fix #{history.length - idx}</span>
                    <span className="text-slate-400 text-[11px] font-mono">
                      {new Date(loc.client_timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-300">
                    📍 {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Accuracy: ±{loc.accuracy}m</span>
                    <span>🔋 {loc.battery_level ?? 'N/A'}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
