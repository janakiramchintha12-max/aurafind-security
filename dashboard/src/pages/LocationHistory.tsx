import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { 
  Clock, 
  Play, 
  Pause, 
  RotateCcw, 
  Download, 
  RefreshCw, 
  Smartphone, 
  Navigation, 
  Gauge, 
  Battery, 
  Zap, 
  Compass, 
  MapPin, 
  ChevronRight, 
  ChevronLeft, 
  Repeat, 
  Layers, 
  Calendar, 
  Activity,
  Milestone,
  Eye,
  Sliders
} from 'lucide-react';
import { devicesApi, locationsApi } from '../services/api';
import { Device, LocationRecord } from '../types';

// Custom Map Markers
const startMarkerIcon = new L.DivIcon({
  className: 'route-start-marker',
  html: `
    <div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: #10b981; border: 3px solid #ffffff; box-shadow: 0 0 14px rgba(16, 185, 129, 0.9); color: white; font-weight: 900; font-size: 11px;">
      🟢
    </div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14]
});

const endMarkerIcon = new L.DivIcon({
  className: 'route-end-marker',
  html: `
    <div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; background: #ef4444; border: 3px solid #ffffff; box-shadow: 0 0 14px rgba(239, 68, 68, 0.9); color: white; font-weight: 900; font-size: 11px;">
      🏁
    </div>
  `,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14]
});

const waypointDotIcon = new L.DivIcon({
  className: 'route-waypoint-dot',
  html: `
    <div style="width: 10px; height: 10px; border-radius: 50%; background: #06b6d4; border: 2px solid #0f172a; box-shadow: 0 0 4px rgba(6, 182, 212, 0.8);"></div>
  `,
  iconSize: [10, 10],
  iconAnchor: [5, 5],
  popupAnchor: [0, -6]
});

const createMovingTargetIcon = (headingDeg: number, speedKmh: number = 0) => {
  return new L.DivIcon({
    className: 'route-moving-target',
    html: `
      <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;">
        <!-- Pulsing radar glow ring -->
        <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(6, 182, 212, 0.35); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
        <!-- Outer solid badge with direction rotation -->
        <div style="position: absolute; width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg, #06b6d4, #3b82f6); border: 3px solid #ffffff; box-shadow: 0 0 20px rgba(6, 182, 212, 0.95); display: flex; align-items: center; justify-content: center; transform: rotate(${headingDeg}deg); transition: transform 0.2s ease-out;">
          <span style="font-size: 16px; color: white; line-height: 1;">⬆️</span>
        </div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22]
  });
};

// Map Recenter & Follow Controller
function MapFollowController({ 
  center, 
  followMode, 
  zoom = 16 
}: { 
  center: [number, number]; 
  followMode: boolean; 
  zoom?: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (followMode && center && center[0] && center[1]) {
      map.panTo(center, { animate: true, duration: 0.3 });
    }
  }, [center, followMode, map]);
  return null;
}

// Distance Calculation (Haversine in km)
function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Bearing Angle Calculation in Degrees
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin((lon2 - lon1) * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180));
  const x =
    Math.cos(lat1 * (Math.PI / 180)) * Math.sin(lat2 * (Math.PI / 180)) -
    Math.sin(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.cos((lon2 - lon1) * (Math.PI / 180));
  const brng = (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
  return Math.round(brng);
}

export const LocationHistoryPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  
  // Filter Horizon & Previous Hours
  const [timePreset, setTimePreset] = useState<string>('1h'); // 1h, 2h, 3h, 6h, 12h, 24h, 48h, today, yesterday, 7days, custom
  const [customHours, setCustomHours] = useState<number>(3);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const [history, setHistory] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [mapTheme, setMapTheme] = useState<'satellite' | 'dark' | 'street'>('satellite');
  const [followMode, setFollowMode] = useState(true);

  // Playback Engine State
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(5); // 1x, 2x, 5x, 10x, 25x, 50x
  const [isLooping, setIsLooping] = useState(false);

  const playTimerRef = useRef<any>(null);

  // Initial Load Devices
  useEffect(() => {
    async function loadDevices() {
      try {
        const list = await devicesApi.list();
        setDevices(list);
        if (list.length > 0) {
          setSelectedDeviceId(list[0].id);
        }
      } catch (err) {
        console.error('Failed to load devices', err);
      }
    }
    loadDevices();
  }, []);

  // Fetch Location History whenever filters change
  const fetchHistory = async () => {
    if (!selectedDeviceId) return;
    setLoading(true);
    setIsPlaying(false);
    setPlaybackIndex(0);

    try {
      let rangeParam = timePreset;
      let hoursParam: number | undefined = undefined;

      if (timePreset === 'custom_hours') {
        rangeParam = `${customHours}h`;
        hoursParam = customHours;
      }

      const records = await locationsApi.getHistory(
        selectedDeviceId,
        rangeParam,
        timePreset === 'custom' ? startDate : undefined,
        timePreset === 'custom' ? endDate : undefined,
        hoursParam,
        10000
      );
      setHistory(records || []);
    } catch (err) {
      console.error('Failed to load location history', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [selectedDeviceId, timePreset, customHours]);

  // High-Speed Frame-Rate Compensated Playback Loop
  useEffect(() => {
    if (isPlaying && history.length > 1) {
      // Calculate step interval and skip step size for ultra-high speeds (25x, 50x)
      let intervalMs = 1000 / playbackSpeed;
      let stepSize = 1;

      if (playbackSpeed >= 25) {
        intervalMs = 40; // ~25 fps
        stepSize = Math.max(1, Math.round((playbackSpeed * 0.04)));
      } else if (playbackSpeed >= 10) {
        intervalMs = 80;
        stepSize = 1;
      }

      playTimerRef.current = setInterval(() => {
        setPlaybackIndex((prev) => {
          const next = prev + stepSize;
          if (next >= history.length - 1) {
            if (isLooping) {
              return 0; // Loop back to start
            } else {
              setIsPlaying(false);
              return history.length - 1;
            }
          }
          return next;
        });
      }, intervalMs);
    } else {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    }

    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying, playbackSpeed, isLooping, history.length]);

  // Derived Coordinates & Trails
  const fullPolylineCoords: [number, number][] = useMemo(() => {
    return history.map((loc) => [loc.latitude, loc.longitude]);
  }, [history]);

  const traveledPolylineCoords: [number, number][] = useMemo(() => {
    if (history.length === 0) return [];
    return history.slice(0, playbackIndex + 1).map((loc) => [loc.latitude, loc.longitude]);
  }, [history, playbackIndex]);

  const currentPoint = history[playbackIndex] || (history.length > 0 ? history[0] : null);
  const prevPoint = playbackIndex > 0 ? history[playbackIndex - 1] : null;

  // Heading calculation for moving marker
  const currentHeading = useMemo(() => {
    if (currentPoint?.bearing != null && currentPoint.bearing > 0) {
      return currentPoint.bearing;
    }
    if (currentPoint && prevPoint) {
      return calculateBearing(prevPoint.latitude, prevPoint.longitude, currentPoint.latitude, currentPoint.longitude);
    }
    return 0;
  }, [currentPoint, prevPoint]);

  // Overall Journey Analytics
  const tripStats = useMemo(() => {
    if (history.length < 2) {
      return {
        totalDistanceKm: 0,
        durationMinutes: 0,
        avgSpeedKmh: 0,
        maxSpeedKmh: 0,
        batteryStart: history[0]?.battery_level ?? null,
        batteryEnd: history[history.length - 1]?.battery_level ?? null,
      };
    }

    let totalDist = 0;
    let maxSpd = 0;
    let speedSum = 0;
    let speedCount = 0;

    for (let i = 1; i < history.length; i++) {
      const p1 = history[i - 1];
      const p2 = history[i];
      const d = calculateDistanceKm(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
      totalDist += d;

      const spd = p2.speed ? p2.speed * 3.6 : 0; // m/s to km/h
      if (spd > maxSpd) maxSpd = spd;
      if (spd > 0) {
        speedSum += spd;
        speedCount++;
      }
    }

    const tStart = new Date(history[0].client_timestamp).getTime();
    const tEnd = new Date(history[history.length - 1].client_timestamp).getTime();
    const durationMins = Math.max(1, Math.round((tEnd - tStart) / 60000));

    return {
      totalDistanceKm: totalDist,
      durationMinutes: durationMins,
      avgSpeedKmh: speedCount > 0 ? speedSum / speedCount : 0,
      maxSpeedKmh: maxSpd,
      batteryStart: history[0]?.battery_level ?? null,
      batteryEnd: history[history.length - 1]?.battery_level ?? null,
    };
  }, [history]);

  // Center coordinate
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const centerCoord: [number, number] = currentPoint
    ? [currentPoint.latitude, currentPoint.longitude]
    : selectedDevice?.last_latitude && selectedDevice?.last_longitude
    ? [selectedDevice.last_latitude, selectedDevice.last_longitude]
    : [14.0415, 79.2625];

  // Map Tile Layers
  const tileLayerUrls = {
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    street: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  };

  // CSV Export
  const handleExportCSV = () => {
    if (history.length === 0) return alert('No location history fixes to export.');

    const headers = ['Fix #', 'Timestamp', 'Latitude', 'Longitude', 'Accuracy (m)', 'Speed (km/h)', 'Bearing', 'Battery (%)', 'Provider', 'Offline Fix'];
    const rows = history.map((loc, idx) => [
      idx + 1,
      new Date(loc.client_timestamp).toISOString(),
      loc.latitude,
      loc.longitude,
      loc.accuracy ?? 0,
      loc.speed ? (loc.speed * 3.6).toFixed(1) : '0',
      loc.bearing ?? '0',
      loc.battery_level ?? '',
      loc.provider,
      loc.is_offline_record ? 'Yes' : 'No'
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `aurafind_route_history_${selectedDeviceId}_${timePreset}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Quick preset options for previous hours
  const hourPills = [
    { label: '1 Hour', value: '1h' },
    { label: '2 Hours', value: '2h' },
    { label: '3 Hours', value: '3h' },
    { label: '6 Hours', value: '6h' },
    { label: '12 Hours', value: '12h' },
    { label: '24 Hours', value: '24h' },
    { label: '48 Hours', value: '48h' },
    { label: 'Today', value: 'today' },
    { label: 'Yesterday', value: 'yesterday' },
    { label: '7 Days', value: '7days' },
  ];

  // Speed multiplier list (including 25x and 50x)
  const speedOptions = [1, 2, 5, 10, 25, 50];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-wide flex items-center gap-2.5">
            <Milestone className="w-7 h-7 text-cyan-400" />
            <span>Route History & High-Speed Playback</span>
          </h1>
          <p className="text-sm text-slate-400">
            Replay historical movements on interactive satellite maps with animated breadcrumbs up to 50x speed
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Tile Layer Selector */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-1 flex items-center space-x-1 text-xs">
            <button
              onClick={() => setMapTheme('satellite')}
              className={`px-2.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                mapTheme === 'satellite' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              🛰️ Satellite
            </button>
            <button
              onClick={() => setMapTheme('dark')}
              className={`px-2.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                mapTheme === 'dark' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              🌌 Dark
            </button>
            <button
              onClick={() => setMapTheme('street')}
              className={`px-2.5 py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                mapTheme === 'street' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
              }`}
            >
              🗺️ Street
            </button>
          </div>

          <button
            onClick={handleExportCSV}
            className="flex items-center space-x-1.5 px-3 py-2 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-bold transition-all shadow cursor-pointer"
            title="Download CSV report"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export CSV</span>
          </button>

          <button
            onClick={fetchHistory}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-cyan-600/20 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Control Panel: Device Selector & Previous Hours Filters */}
      <div className="bg-slate-800/90 border border-slate-700/80 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          
          {/* Device Dropdown */}
          <div className="flex items-center gap-3 min-w-[260px]">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Smartphone className="w-4 h-4 text-cyan-400" />
              <span>Target:</span>
            </span>
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-white focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.device_name} ({d.device_model})
                </option>
              ))}
            </select>
          </div>

          {/* Time Horizon Preset Pills */}
          <div className="flex-1 flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
            {hourPills.map((pill) => (
              <button
                key={pill.value}
                onClick={() => setTimePreset(pill.value)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap border transition-all cursor-pointer ${
                  timePreset === pill.value
                    ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/20 scale-105'
                    : 'bg-slate-900/80 hover:bg-slate-700/60 text-slate-300 border-slate-700/60'
                }`}
              >
                {pill.label}
              </button>
            ))}

            {/* Custom Hours Button */}
            <button
              onClick={() => setTimePreset('custom_hours')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap border transition-all cursor-pointer ${
                timePreset === 'custom_hours'
                  ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md scale-105'
                  : 'bg-slate-900/80 hover:bg-slate-700/60 text-slate-300 border-slate-700/60'
              }`}
            >
              ⚙️ Custom Hours
            </button>

            {/* Custom Range Button */}
            <button
              onClick={() => setTimePreset('custom')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap border transition-all cursor-pointer ${
                timePreset === 'custom'
                  ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md scale-105'
                  : 'bg-slate-900/80 hover:bg-slate-700/60 text-slate-300 border-slate-700/60'
              }`}
            >
              📅 Date Picker
            </button>
          </div>
        </div>

        {/* Custom Hours Slider Drawer */}
        {timePreset === 'custom_hours' && (
          <div className="pt-3 border-t border-slate-700/60 flex flex-col sm:flex-row items-center gap-4 bg-slate-900/60 p-3 rounded-2xl">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>Select Past Hours:</span>
            </div>
            <input
              type="range"
              min="1"
              max="72"
              step="1"
              value={customHours}
              onChange={(e) => setCustomHours(parseInt(e.target.value))}
              className="flex-1 accent-cyan-500 cursor-pointer"
            />
            <span className="text-sm font-black font-mono text-white bg-slate-800 px-3 py-1 rounded-xl border border-cyan-500/40">
              Past {customHours} {customHours === 1 ? 'Hour' : 'Hours'}
            </span>
          </div>
        )}

        {/* Custom Date Range Picker Drawer */}
        {timePreset === 'custom' && (
          <div className="pt-3 border-t border-slate-700/60 grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-900/60 p-3 rounded-2xl">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Start Date & Time</label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">End Date & Time</label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        )}

        {/* Trip Telemetry Summary Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-3 border-t border-slate-700/60">
          <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-3 text-center">
            <div className="text-[10px] text-cyan-400 font-extrabold uppercase tracking-wider">TOTAL DISTANCE</div>
            <div className="text-lg font-black text-white mt-0.5 font-mono">
              {tripStats.totalDistanceKm < 1 
                ? `${(tripStats.totalDistanceKm * 1000).toFixed(0)} m` 
                : `${tripStats.totalDistanceKm.toFixed(2)} km`}
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-3 text-center">
            <div className="text-[10px] text-emerald-400 font-extrabold uppercase tracking-wider">TRIP DURATION</div>
            <div className="text-lg font-black text-white mt-0.5 font-mono">
              {tripStats.durationMinutes >= 60 
                ? `${Math.floor(tripStats.durationMinutes / 60)}h ${tripStats.durationMinutes % 60}m` 
                : `${tripStats.durationMinutes} mins`}
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-3 text-center">
            <div className="text-[10px] text-amber-400 font-extrabold uppercase tracking-wider">AVERAGE SPEED</div>
            <div className="text-lg font-black text-white mt-0.5 font-mono">
              {tripStats.avgSpeedKmh.toFixed(1)} km/h
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-3 text-center">
            <div className="text-[10px] text-rose-400 font-extrabold uppercase tracking-wider">MAX SPEED</div>
            <div className="text-lg font-black text-white mt-0.5 font-mono">
              {tripStats.maxSpeedKmh.toFixed(1)} km/h
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-3 text-center">
            <div className="text-[10px] text-purple-400 font-extrabold uppercase tracking-wider">BATTERY USAGE</div>
            <div className="text-lg font-black text-white mt-0.5 font-mono">
              {tripStats.batteryStart !== null && tripStats.batteryEnd !== null
                ? `${tripStats.batteryStart}% ➔ ${tripStats.batteryEnd}%`
                : 'N/A'}
            </div>
          </div>

          <div className="bg-slate-900/70 border border-slate-700/60 rounded-2xl p-3 text-center">
            <div className="text-[10px] text-cyan-300 font-extrabold uppercase tracking-wider">GPS FIXES</div>
            <div className="text-lg font-black text-white mt-0.5 font-mono">
              {history.length} fixes
            </div>
          </div>
        </div>

        {/* Video-Style Flight Playback Deck */}
        {history.length > 1 && (
          <div className="bg-gradient-to-r from-slate-900 via-slate-950 to-slate-900 border border-cyan-500/40 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              
              {/* Play / Pause & Controls */}
              <div className="flex items-center flex-wrap gap-2">
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className={`px-4 py-2 rounded-xl font-black text-xs flex items-center space-x-2 transition-all shadow-lg cursor-pointer ${
                    isPlaying
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                      : 'bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 shadow-cyan-500/30'
                  }`}
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                  <span>{isPlaying ? 'Pause' : 'Play Flight Trail'}</span>
                </button>

                <button
                  onClick={() => { setPlaybackIndex(0); setIsPlaying(false); }}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition-all cursor-pointer"
                  title="Rewind to Start"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setPlaybackIndex((prev) => Math.max(0, prev - 1))}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition-all cursor-pointer"
                  title="Step Backward"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setPlaybackIndex((prev) => Math.min(history.length - 1, prev + 1))}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-xl transition-all cursor-pointer"
                  title="Step Forward"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setIsLooping(!isLooping)}
                  className={`p-2 rounded-xl border transition-all cursor-pointer ${
                    isLooping 
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm' 
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                  title={isLooping ? 'Looping enabled' : 'Looping disabled'}
                >
                  <Repeat className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setFollowMode(!followMode)}
                  className={`px-2.5 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                    followMode 
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                  }`}
                  title="Auto-center map on moving device"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Auto-Pan</span>
                </button>
              </div>

              {/* Speed Multipliers (1x, 2x, 5x, 10x, 25x, 50x) */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400 uppercase">Speed:</span>
                <div className="bg-slate-900 border border-slate-700 rounded-xl p-0.5 flex items-center gap-1 text-xs">
                  {speedOptions.map((spd) => (
                    <button
                      key={spd}
                      onClick={() => setPlaybackSpeed(spd)}
                      className={`px-2.5 py-1.5 rounded-lg font-black transition-all cursor-pointer ${
                        playbackSpeed === spd
                          ? spd >= 25 
                            ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-slate-950 shadow-md font-extrabold scale-105' 
                            : 'bg-cyan-500 text-slate-950 shadow-md font-extrabold'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {spd}x {spd >= 25 ? '⚡' : ''}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Timeline Scrubber Slider */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-400">
                  Fix #{playbackIndex + 1} of {history.length} ({Math.round(((playbackIndex + 1) / history.length) * 100)}%)
                </span>
                <span className="font-bold text-cyan-300">
                  {currentPoint ? new Date(currentPoint.client_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : ''}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max={history.length - 1}
                value={playbackIndex}
                onChange={(e) => {
                  setPlaybackIndex(parseInt(e.target.value));
                  setIsPlaying(false);
                }}
                className="w-full accent-cyan-500 cursor-pointer h-2 bg-slate-800 rounded-lg"
              />
            </div>
          </div>
        )}
      </div>

      {/* Map & Waypoint List Split Screen */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[640px]">
        
        {/* Interactive Map with Animated Traveled Trail */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-700/80 rounded-3xl overflow-hidden shadow-2xl relative">
          <MapContainer center={centerCoord} zoom={16} style={{ width: '100%', height: '100%' }}>
            <TileLayer
              key={mapTheme}
              attribution='&copy; <a href="https://www.esri.com/">Esri</a> & OpenStreetMap contributors'
              url={tileLayerUrls[mapTheme]}
              maxZoom={20}
            />

            {/* Follow Controller */}
            <MapFollowController center={centerCoord} followMode={followMode} zoom={16} />

            {/* 1. Full Planned Background Route (Faint cyan dashed) */}
            {fullPolylineCoords.length > 1 && (
              <Polyline
                positions={fullPolylineCoords}
                pathOptions={{
                  color: '#0284c7',
                  weight: 3,
                  opacity: 0.35,
                  dashArray: '6, 8'
                }}
              />
            )}

            {/* 2. Traveled Route Line (Vibrant solid glowing cyan that grows as playback moves) */}
            {traveledPolylineCoords.length > 1 && (
              <Polyline
                positions={traveledPolylineCoords}
                pathOptions={{
                  color: '#06b6d4',
                  weight: 5,
                  opacity: 0.95
                }}
              />
            )}

            {/* Start Marker (Fix #1) */}
            {history.length > 0 && (
              <Marker position={[history[0].latitude, history[0].longitude]} icon={startMarkerIcon}>
                <Popup>
                  <div className="p-1.5 space-y-1 text-slate-900 font-sans text-xs">
                    <div className="font-black text-emerald-600 flex items-center gap-1">
                      <span>🟢 Journey Start Point</span>
                    </div>
                    <div className="font-mono text-[11px]">
                      {history[0].latitude.toFixed(6)}, {history[0].longitude.toFixed(6)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Time: {new Date(history[0].client_timestamp).toLocaleString()}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* End / Final Fix Marker */}
            {history.length > 1 && (
              <Marker position={[history[history.length - 1].latitude, history[history.length - 1].longitude]} icon={endMarkerIcon}>
                <Popup>
                  <div className="p-1.5 space-y-1 text-slate-900 font-sans text-xs">
                    <div className="font-black text-rose-600 flex items-center gap-1">
                      <span>🏁 Journey Final Fix</span>
                    </div>
                    <div className="font-mono text-[11px]">
                      {history[history.length - 1].latitude.toFixed(6)}, {history[history.length - 1].longitude.toFixed(6)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Time: {new Date(history[history.length - 1].client_timestamp).toLocaleString()}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Intermediate Waypoint Dots */}
            {history.map((loc, idx) => (
              <Marker 
                key={loc.id} 
                position={[loc.latitude, loc.longitude]} 
                icon={waypointDotIcon}
                eventHandlers={{
                  click: () => {
                    setPlaybackIndex(idx);
                    setIsPlaying(false);
                  }
                }}
              >
                <Tooltip direction="top" offset={[0, -6]} opacity={0.9}>
                  <div className="text-[10px] font-mono">
                    Fix #{idx + 1} • {new Date(loc.client_timestamp).toLocaleTimeString()}
                  </div>
                </Tooltip>
              </Marker>
            ))}

            {/* Animated Moving Target Marker along the route */}
            {currentPoint && (
              <Marker
                position={[currentPoint.latitude, currentPoint.longitude]}
                icon={createMovingTargetIcon(currentHeading, (currentPoint.speed || 0) * 3.6)}
                zIndexOffset={1000}
              >
                <Popup autoPan={false}>
                  <div className="p-2 space-y-1 text-slate-900 font-sans text-xs min-w-[170px]">
                    <div className="font-black text-cyan-600 flex items-center gap-1">
                      <Navigation className="w-3.5 h-3.5" />
                      <span>Fix #{playbackIndex + 1} of {history.length}</span>
                    </div>
                    <div className="font-mono text-[11px] font-bold">
                      📍 {currentPoint.latitude.toFixed(6)}, {currentPoint.longitude.toFixed(6)}
                    </div>
                    <div className="text-[11px] text-slate-700 flex items-center justify-between">
                      <span>Speed: <strong>{currentPoint.speed ? `${(currentPoint.speed * 3.6).toFixed(1)} km/h` : '0 km/h'}</strong></span>
                      <span>Heading: <strong>{currentHeading}°</strong></span>
                    </div>
                    <div className="text-[11px] text-slate-700 flex items-center justify-between">
                      <span>Accuracy: ±{currentPoint.accuracy ?? 0}m</span>
                      <span>🔋 {currentPoint.battery_level ?? 'N/A'}%</span>
                    </div>
                    <div className="text-[10px] text-slate-500 border-t pt-1 mt-1">
                      {new Date(currentPoint.client_timestamp).toLocaleString()}
                    </div>
                  </div>
                </Popup>
              </Marker>
            )}
          </MapContainer>

          {/* Floating Current Location Live HUD Overlay */}
          {currentPoint && (
            <div className="absolute top-4 left-4 z-[500] bg-slate-900/90 border border-cyan-500/50 rounded-2xl p-3 backdrop-blur shadow-2xl space-y-1 pointer-events-auto">
              <div className="flex items-center gap-2 text-cyan-400 font-black text-xs uppercase tracking-wide">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
                <span>Active Playback Position</span>
              </div>
              <div className="text-sm font-black font-mono text-white">
                📍 {currentPoint.latitude.toFixed(6)}, {currentPoint.longitude.toFixed(6)}
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono text-slate-300">
                <span>⚡ Speed: {currentPoint.speed ? `${(currentPoint.speed * 3.6).toFixed(1)} km/h` : '0 km/h'}</span>
                <span>🔋 {currentPoint.battery_level ?? 'N/A'}%</span>
                <span>±{currentPoint.accuracy ?? 0}m</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                🕒 {new Date(currentPoint.client_timestamp).toLocaleString()}
              </div>
            </div>
          )}
        </div>

        {/* Waypoint Audit List */}
        <div className="bg-slate-800/90 border border-slate-700/80 rounded-3xl p-5 flex flex-col space-y-3 overflow-hidden shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-700/80 pb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-black uppercase text-slate-200 tracking-wider">Historical Waypoints</span>
            </div>
            <span className="text-xs font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-lg border border-cyan-500/30">
              {history.length} points
            </span>
          </div>

          {loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-2">
              <RefreshCw className="w-7 h-7 animate-spin text-cyan-400" />
              <span className="text-xs font-bold">Querying flight path telemetry...</span>
            </div>
          ) : history.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-3">
              <MapPin className="w-10 h-10 text-slate-600 mx-auto" />
              <div className="font-bold text-slate-300 text-sm">No Movement Recorded</div>
              <p className="text-xs text-slate-500 max-w-xs">
                No location fixes found for the selected time horizon. Try selecting a broader time horizon above (e.g. 24 Hours or 7 Days).
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {history.map((loc, idx) => {
                const isSelected = playbackIndex === idx;
                const spdKmh = loc.speed ? (loc.speed * 3.6).toFixed(1) : '0';

                return (
                  <div
                    key={loc.id}
                    onClick={() => {
                      setPlaybackIndex(idx);
                      setIsPlaying(false);
                    }}
                    className={`p-3 rounded-2xl border cursor-pointer transition-all space-y-1 ${
                      isSelected
                        ? 'bg-cyan-950/80 border-cyan-400 ring-2 ring-cyan-500/30 shadow-lg'
                        : 'bg-slate-900/80 border-slate-700/60 hover:border-cyan-500/40'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-cyan-300">
                        {idx === 0 ? '🟢 START' : idx === history.length - 1 ? '🏁 FINAL' : `📍 Fix #${idx + 1}`}
                      </div>
                      <span className="text-slate-400 text-[11px] font-mono">
                        {new Date(loc.client_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>

                    <div className="text-xs font-mono text-slate-300">
                      {loc.latitude.toFixed(6)}, {loc.longitude.toFixed(6)}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                      <span>Speed: <strong className="text-slate-200">{spdKmh} km/h</strong></span>
                      <span>±{loc.accuracy ?? 0}m</span>
                      <span>🔋 {loc.battery_level ?? 'N/A'}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

