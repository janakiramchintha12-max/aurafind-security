import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Smartphone, RefreshCw, Navigation, Compass, Radio, Laptop, ArrowRightLeft, Crosshair, Satellite, ShieldCheck, MapPin, Phone, Video, Mic } from 'lucide-react';
import { devicesApi, commandsApi, connectWebSocket } from '../services/api';
import { Device } from '../types';
import { VoiceCallModal } from '../components/VoiceCallModal';
import { LiveCameraStreamModal } from '../components/LiveCameraStreamModal';

// Custom Marker for Target Mobile Device (Exact Red GPS Satellite Target)
const phoneRadarIcon = new L.DivIcon({
  className: 'radar-phone-marker',
  html: `
    <div style="position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 50px; height: 50px; border-radius: 50%; background: rgba(239, 68, 68, 0.35); animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: absolute; width: 32px; height: 32px; border-radius: 50%; background: #ef4444; border: 3px solid #ffffff; box-shadow: 0 0 20px rgba(239, 68, 68, 0.9); display: flex; align-items: center; justify-content: center; color: white; font-size: 15px;">📱</div>
    </div>
  `,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -22]
});

// Custom Marker for Laptop / User Location (Exact Cyan Dot)
const userLocationIcon = new L.DivIcon({
  className: 'radar-user-marker',
  html: `
    <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 44px; height: 44px; border-radius: 50%; background: rgba(6, 182, 212, 0.3); animation: ping 2.2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: absolute; width: 28px; height: 28px; border-radius: 50%; background: #06b6d4; border: 3px solid #ffffff; box-shadow: 0 0 15px rgba(6, 182, 212, 0.8); display: flex; align-items: center; justify-content: center; color: white; font-size: 13px;">💻</div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -20]
});

// High-Precision Haversine Distance Calculation (Meters)
function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Initial Bearing from Point 1 to Point 2
function calculateBearingDegrees(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * (Math.PI / 180);
  const p2 = lat2 * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  const brng = (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
  return Math.round(brng);
}

function getCompassDirection(bearing: number): string {
  const directions = ['North ⬆️', 'North-East ↗️', 'East ➡️', 'South-East ↘️', 'South ⬇️', 'South-West ↙️', 'West ⬅️', 'North-West ↖️'];
  const idx = Math.round(bearing / 45) % 8;
  return directions[idx];
}

function formatDistance(distMeters: number | null): string {
  if (distMeters == null) return 'Calculating...';
  if (distMeters < 1) return '< 1 meter';
  if (distMeters < 100) return `${distMeters.toFixed(1)} meters`;
  if (distMeters < 1000) return `${Math.round(distMeters)} meters`;
  return `${(distMeters / 1000).toFixed(2)} km`;
}

// Auto-Pan Helper Component
const MapRecenterController: React.FC<{ center: [number, number]; trigger: number }> = ({ center, trigger }) => {
  const map = useMap();
  useEffect(() => {
    map.flyTo(center, Math.max(map.getZoom(), 18), { duration: 1.2 });
  }, [center[0], center[1], trigger]);
  return null;
};

export const LiveLocationPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [rangeMode, setRangeMode] = useState<'device_only' | 'laptop_phone' | 'device_device'>('device_only');
  const [mapTheme, setMapTheme] = useState<'satellite' | 'dark' | 'street'>('satellite');
  const [loading, setLoading] = useState(true);
  const [recenterTrigger, setRecenterTrigger] = useState(0);
  const [activeVoiceDevice, setActiveVoiceDevice] = useState<Device | null>(null);
  const [activeCameraDevice, setActiveCameraDevice] = useState<Device | null>(null);

  // 1. Browser Geolocation (only active when laptop range mode is explicitly enabled)
  useEffect(() => {
    if (rangeMode === 'laptop_phone' && typeof window !== 'undefined' && 'geolocation' in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setUserLocation({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        },
        (err) => {
          console.warn('Browser GPS permission or status:', err.message);
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [rangeMode]);

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
      console.error('Failed to load live locations', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();

    const cleanup = connectWebSocket(() => {
      fetchDevices();
    });

    return () => cleanup();
  }, []);

  const mappedDevices = devices.filter((d) => d.last_latitude != null && d.last_longitude != null);

  // Determine Comparison Endpoints (Point A and Point B)
  let originLat: number | null = null;
  let originLng: number | null = null;
  let originLabel = 'YOUR PC';

  let targetLat: number | null = null;
  let targetLng: number | null = null;
  let targetLabel = selectedDevice?.device_name || 'TARGET PHONE';

  if (rangeMode === 'laptop_phone') {
    if (userLocation) {
      originLat = userLocation.lat;
      originLng = userLocation.lng;
      originLabel = 'YOUR PC (Wi-Fi/IP)';
    }
    if (selectedDevice?.last_latitude && selectedDevice?.last_longitude) {
      targetLat = selectedDevice.last_latitude;
      targetLng = selectedDevice.last_longitude;
      targetLabel = selectedDevice.device_name;
    }
  } else if (rangeMode === 'device_device') {
    // Inter-device mode: compare Device 1 and Device 2
    if (mappedDevices.length >= 2) {
      originLat = mappedDevices[0].last_latitude!;
      originLng = mappedDevices[0].last_longitude!;
      originLabel = mappedDevices[0].device_name;

      targetLat = mappedDevices[1].last_latitude!;
      targetLng = mappedDevices[1].last_longitude!;
      targetLabel = mappedDevices[1].device_name;
    }
  } else {
    // Single Device Mode: Pure Satellite Focus on Target Phone
    if (selectedDevice?.last_latitude && selectedDevice?.last_longitude) {
      targetLat = selectedDevice.last_latitude;
      targetLng = selectedDevice.last_longitude;
      targetLabel = selectedDevice.device_name;
    }
  }

  // Exact Distance & Bearing Calculation
  let distanceMeters: number | null = null;
  let bearingDegrees: number | null = null;
  let directionText = 'At Same Location 📍';

  if (originLat != null && originLng != null && targetLat != null && targetLng != null) {
    distanceMeters = calculateDistanceMeters(originLat, originLng, targetLat, targetLng);
    bearingDegrees = calculateBearingDegrees(originLat, originLng, targetLat, targetLng);
    directionText = distanceMeters <= 5 ? 'At Same Location 📍' : getCompassDirection(bearingDegrees);
  }

  const handleLocateFresh = async () => {
    if (!selectedDevice) return;
    try {
      await commandsApi.dispatch(selectedDevice.id, 'LOCATE_NOW');
      await commandsApi.dispatch(selectedDevice.id, 'HIGH_ACCURACY_MODE');
      fetchDevices();
      setRecenterTrigger(t => t + 1);
    } catch (e) {
      console.error('Failed to request fresh satellite fix', e);
    }
  };

  const handleRecenter = () => {
    setRecenterTrigger(t => t + 1);
  };

  const googleMapsUrl = targetLat && targetLng
    ? `https://www.google.com/maps/dir/?api=1&destination=${targetLat},${targetLng}&travelmode=walking`
    : '#';

  const tileLayerUrls = {
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    street: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  };

  const mapCenter: [number, number] = targetLat && targetLng
    ? [targetLat, targetLng]
    : [14.0417, 79.2624];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-wide flex items-center space-x-2">
            <Satellite className="w-6 h-6 text-cyan-400 animate-pulse" />
            <span>Target Device Satellite Radar</span>
          </h1>
          <p className="text-sm text-slate-400">
            Real-time GNSS satellite tracking directly from your phone's hardware receiver
          </p>
        </div>

        {/* Mode Switcher & Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Recenter Button */}
          <button
            onClick={handleRecenter}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold rounded-xl text-xs border border-slate-700 shadow"
            title="Recenter Map on Target Device"
          >
            <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
            <span>Center on Phone</span>
          </button>

          {/* Mode Switcher */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-1 flex items-center space-x-1 text-xs">
            <button
              onClick={() => setRangeMode('device_only')}
              className={`px-2.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1 ${
                rangeMode === 'device_only' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Smartphone className="w-3 h-3" />
              <span>Target Phone Only</span>
            </button>
            <button
              onClick={() => setRangeMode('laptop_phone')}
              className={`px-2.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1 ${
                rangeMode === 'laptop_phone' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
              title="Show distance from this PC (uses Wi-Fi/IP estimate)"
            >
              <Laptop className="w-3 h-3" />
              <span>PC ↔ Phone</span>
            </button>
            {mappedDevices.length >= 2 && (
              <button
                onClick={() => setRangeMode('device_device')}
                className={`px-2.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1 ${
                  rangeMode === 'device_device' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
              >
                <ArrowRightLeft className="w-3 h-3" />
                <span>Phone ↔ Phone</span>
              </button>
            )}
          </div>

          {/* Map Layer Switcher */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-1 flex items-center space-x-1 text-xs">
            <button
              onClick={() => setMapTheme('satellite')}
              className={`px-2.5 py-1.5 rounded-lg font-bold transition-all ${
                mapTheme === 'satellite' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🛰️ Satellite
            </button>
            <button
              onClick={() => setMapTheme('dark')}
              className={`px-2.5 py-1.5 rounded-lg font-bold transition-all ${
                mapTheme === 'dark' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🌌 Dark
            </button>
            <button
              onClick={() => setMapTheme('street')}
              className={`px-2.5 py-1.5 rounded-lg font-bold transition-all ${
                mapTheme === 'street' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              🗺️ Street
            </button>
          </div>

          <button
            onClick={handleLocateFresh}
            className="flex items-center space-x-1.5 px-3 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-cyan-600/20"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Request Fresh GPS Fix</span>
          </button>
        </div>
      </div>

      {/* Cockpit HUD */}
      {rangeMode === 'device_only' ? (
        /* Single Device Pure Satellite HUD */
        <div className="bg-slate-800/95 border border-cyan-500/40 rounded-2xl p-4 shadow-2xl backdrop-blur grid grid-cols-2 md:grid-cols-6 gap-2.5 items-center">
          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/60 text-center">
            <div className="text-[10px] text-cyan-400 font-extrabold uppercase tracking-wider flex items-center justify-center gap-1">
              <Smartphone className="w-3 h-3 text-cyan-400" />
              <span>ACTIVE TARGET</span>
            </div>
            <div className="text-sm font-bold text-white mt-0.5 truncate">
              {selectedDevice?.device_name || 'Target Phone'}
            </div>
            <div className="text-[10px] text-slate-400">
              SIM: {selectedDevice?.sim_number || '+919392408017'}
            </div>
          </div>

          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/60 text-center">
            <div className="text-[10px] text-rose-400 font-extrabold uppercase tracking-wider flex items-center justify-center gap-1">
              <MapPin className="w-3 h-3 text-rose-400" />
              <span>EXACT COORDINATES</span>
            </div>
            {targetLat != null && targetLng != null ? (
              <>
                <div className="text-xs font-bold text-rose-300 font-mono mt-1">
                  📍 {targetLat.toFixed(6)}, {targetLng.toFixed(6)}
                </div>
                <div className="text-[10px] text-slate-400">WGS84 Satellite Fix</div>
              </>
            ) : (
              <div className="text-xs text-slate-400 mt-1">Acquiring GPS fix...</div>
            )}
          </div>

          <div className="bg-slate-900/90 p-2.5 rounded-xl border-2 border-emerald-500/60 text-center shadow-lg shadow-emerald-500/10">
            <div className="text-[10px] text-emerald-400 font-extrabold uppercase tracking-wider flex items-center justify-center gap-1">
              <Satellite className="w-3 h-3 text-emerald-400" />
              <span>SATELLITE ACCURACY</span>
            </div>
            <div className="text-xl font-black text-emerald-400 mt-0.5">
              ±{selectedDevice?.last_accuracy?.toFixed(1) || '3.0'}m
            </div>
            <div className="text-[10px] text-emerald-300 font-bold">High Precision GNSS</div>
          </div>

          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/60 text-center">
            <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">BATTERY & HEALTH</div>
            <div className="text-sm font-black text-cyan-300 mt-0.5">
              🔋 {selectedDevice?.battery_pct || 75}%
            </div>
            <div className="text-[10px] text-emerald-400 font-bold">
              {selectedDevice?.status === 'ONLINE' ? '🟢 Online & Guarded' : '🔴 Offline'}
            </div>
          </div>

          {/* Quick Live Surveillance Action Stack */}
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => selectedDevice && setActiveVoiceDevice(selectedDevice)}
              className="py-1.5 px-2 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-600/10"
              title="Listen live through phone microphone"
            >
              <Mic className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>Listen Live Audio</span>
            </button>
            <button
              onClick={() => selectedDevice && setActiveCameraDevice(selectedDevice)}
              className="py-1.5 px-2 bg-rose-600/30 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-rose-600/10"
              title="Open live camera stream"
            >
              <Video className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
              <span>Live Video Stream</span>
            </button>
          </div>

          <div className="col-span-2 md:col-span-1 flex flex-col gap-1.5">
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="py-3 px-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border border-cyan-400 font-bold rounded-xl text-xs flex items-center justify-center space-x-1.5 transition-all shadow-lg shadow-cyan-600/20"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Directions</span>
            </a>
          </div>
        </div>
      ) : (
        /* Multi-Endpoint Proximity Rangefinder HUD */
        <div className="bg-slate-800/95 border border-cyan-500/40 rounded-2xl p-4 shadow-2xl backdrop-blur grid grid-cols-2 md:grid-cols-5 gap-3 items-center">
          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/60 text-center">
            <div className="text-[10px] text-cyan-400 font-extrabold uppercase tracking-wider flex items-center justify-center gap-1">
              <Laptop className="w-3 h-3 text-cyan-400" />
              <span>FROM: {originLabel}</span>
            </div>
            {originLat != null && originLng != null ? (
              <>
                <div className="text-xs font-bold text-cyan-300 font-mono mt-1">
                  📍 {originLat.toFixed(6)}, {originLng.toFixed(6)}
                </div>
                <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                  {userLocation?.accuracy ? `±${userLocation.accuracy.toFixed(0)}m (Wi-Fi/IP)` : 'Wi-Fi/IP estimate'}
                </div>
              </>
            ) : (
              <div className="text-xs text-slate-400 mt-1">Acquiring position...</div>
            )}
          </div>

          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/60 text-center">
            <div className="text-[10px] text-rose-400 font-extrabold uppercase tracking-wider flex items-center justify-center gap-1">
              <Smartphone className="w-3 h-3 text-rose-400" />
              <span>TO: {targetLabel}</span>
            </div>
            {targetLat != null && targetLng != null ? (
              <>
                <div className="text-xs font-bold text-rose-300 font-mono mt-1">
                  📍 {targetLat.toFixed(6)}, {targetLng.toFixed(6)}
                </div>
                <div className="text-[10px] text-emerald-400 font-medium mt-0.5">
                  ±{selectedDevice?.last_accuracy?.toFixed(1) || '3.0'}m Satellite Precision
                </div>
              </>
            ) : (
              <div className="text-xs text-slate-400 mt-1">Signal Syncing...</div>
            )}
          </div>

          <div className="bg-slate-900/90 p-2.5 rounded-xl border-2 border-cyan-500/60 text-center shadow-lg shadow-cyan-500/10">
            <div className="text-[10px] text-cyan-300 font-extrabold uppercase tracking-wider">EXACT LIVE DISTANCE</div>
            <div className={`text-2xl font-black tracking-tight ${
              distanceMeters != null
                ? distanceMeters <= 10
                  ? 'text-emerald-400 animate-pulse'
                  : distanceMeters <= 50
                  ? 'text-cyan-400'
                  : 'text-amber-400'
                : 'text-slate-400'
            }`}>
              {formatDistance(distanceMeters)}
            </div>
            <div className="text-[10px] font-bold text-slate-300">
              {distanceMeters != null ? (distanceMeters <= 10 ? '🚨 Immediate Proximity' : '📡 Relative Distance Delta') : 'Live Synced'}
            </div>
          </div>

          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/60 text-center">
            <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center justify-center space-x-1">
              <Compass className="w-3 h-3 text-cyan-400" />
              <span>BEARING DIRECTION</span>
            </div>
            <div className="text-sm font-extrabold text-cyan-300 flex items-center justify-center space-x-1.5 mt-0.5">
              {bearingDegrees != null && distanceMeters != null && distanceMeters > 5 && (
                <div
                  className="w-5 h-5 rounded-full border border-cyan-400 flex items-center justify-center text-[10px] transition-transform duration-500"
                  style={{ transform: `rotate(${bearingDegrees}deg)` }}
                >
                  ⬆️
                </div>
              )}
              <span>{directionText}</span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              {bearingDegrees != null ? `Heading: ${bearingDegrees}° Bearing` : 'Direct Range'}
            </div>
          </div>

          <div className="col-span-2 md:col-span-1 flex flex-col gap-1.5">
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border border-cyan-400 font-bold rounded-xl text-xs flex items-center justify-center space-x-1.5 transition-all shadow-lg shadow-cyan-600/20"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Live Directions</span>
            </a>
          </div>
        </div>
      )}

      {/* Main Map & Device List Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[650px]">
        
        {/* Left Side: Device Selection & Sensor HUD */}
        <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-4 flex flex-col space-y-3 overflow-y-auto">
          <div className="text-xs font-black uppercase text-slate-400 tracking-wider flex items-center justify-between">
            <span>Tracked Units</span>
            <span className="text-cyan-400 font-bold">{mappedDevices.length} / {devices.length} with GPS</span>
          </div>

          {devices.map((dev) => {
            const isSelected = selectedDevice?.id === dev.id;
            const hasLoc = dev.last_latitude != null && dev.last_longitude != null;
            return (
              <div
                key={dev.id}
                onClick={() => {
                  setSelectedDevice(dev);
                  setRecenterTrigger(t => t + 1);
                }}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-cyan-500/10 border-cyan-500/50 shadow-md ring-1 ring-cyan-500/30'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-bold text-sm text-white flex items-center space-x-2">
                    <Smartphone className="w-4 h-4 text-cyan-400" />
                    <span>{dev.device_name}</span>
                  </div>
                  <span className={`w-2 h-2 rounded-full ${dev.status === 'ONLINE' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`}></span>
                </div>

                <div className="text-xs text-slate-400 space-y-1">
                  <div className="flex items-center justify-between">
                    <span>SIM: {dev.sim_number || '+919392408017'}</span>
                    <span className="font-bold text-slate-300">{dev.battery_pct}%</span>
                  </div>
                  <div className="font-mono text-[11px] text-cyan-300">
                    {hasLoc ? `${dev.last_latitude?.toFixed(6)}, ${dev.last_longitude?.toFixed(6)}` : 'Signal Syncing'}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Exact Satellite GPS Details Card */}
          <div className="p-3.5 bg-slate-900/90 rounded-xl border border-slate-800 text-xs text-slate-300 space-y-2">
            <div className="font-bold text-cyan-400 flex items-center gap-1.5 border-b border-slate-800 pb-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Exact GPS Satellite Fix</span>
            </div>
            {selectedDevice && selectedDevice.last_latitude != null ? (
              <div className="space-y-1 text-[11px] text-slate-300 font-mono">
                <div><span className="text-slate-400">Device:</span> {selectedDevice.device_name}</div>
                <div><span className="text-slate-400">Lat:</span> {selectedDevice.last_latitude.toFixed(6)}° N</div>
                <div><span className="text-slate-400">Lng:</span> {selectedDevice.last_longitude?.toFixed(6)}° E</div>
                <div><span className="text-slate-400">Accuracy:</span> <span className="text-emerald-400 font-bold">±{selectedDevice.last_accuracy?.toFixed(1) || '3.0'}m</span></div>
                <div><span className="text-slate-400">Updated:</span> {selectedDevice.last_location_time ? new Date(selectedDevice.last_location_time).toLocaleTimeString() : 'Live'}</div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">Selecting device to view satellite data...</p>
            )}
          </div>
        </div>

        {/* Leaflet Map */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl relative">
          <MapContainer center={mapCenter} zoom={18} style={{ width: '100%', height: '100%' }}>
            <TileLayer
              key={mapTheme}
              attribution='&copy; <a href="https://www.esri.com/">Esri</a> & OpenStreetMap contributors'
              url={tileLayerUrls[mapTheme]}
              maxZoom={20}
            />

            {/* Auto Recenter Controller */}
            <MapRecenterController center={mapCenter} trigger={recenterTrigger} />

            {/* Marker 1: USER / LAPTOP LOCATION (Only shown if rangeMode === 'laptop_phone') */}
            {rangeMode === 'laptop_phone' && userLocation && (
              <>
                <Marker position={[userLocation.lat, userLocation.lng]} icon={userLocationIcon}>
                  <Popup>
                    <div className="p-1 space-y-1 text-slate-900 font-sans">
                      <div className="font-bold text-sm text-cyan-700">💻 Your PC Browser Location</div>
                      <div className="text-xs font-mono">📍 {userLocation.lat.toFixed(6)}, {userLocation.lng.toFixed(6)}</div>
                      <div className="text-[10px] text-slate-500">Wi-Fi / IP Estimated position</div>
                    </div>
                  </Popup>
                  <Tooltip permanent direction="top" offset={[0, -20]} className="bg-slate-900 text-cyan-300 font-bold text-[10px] border border-cyan-500 rounded px-1 py-0.5">
                    💻 Your PC (Wi-Fi/IP)
                  </Tooltip>
                </Marker>
                {userLocation.accuracy && userLocation.accuracy > 0 && (
                  <Circle
                    center={[userLocation.lat, userLocation.lng]}
                    radius={userLocation.accuracy}
                    pathOptions={{ color: '#06b6d4', fillColor: '#06b6d4', fillOpacity: 0.08, weight: 1, dashArray: '4, 4' }}
                  />
                )}
              </>
            )}

            {/* Connecting Rangefinder Line (Only in multi-endpoint modes) */}
            {rangeMode !== 'device_only' && originLat != null && originLng != null && targetLat != null && targetLng != null && (
              <Polyline
                positions={[
                  [originLat, originLng],
                  [targetLat, targetLng]
                ]}
                pathOptions={{
                  color: '#38bdf8',
                  weight: 3.5,
                  dashArray: '8, 8',
                  opacity: 0.9
                }}
              >
                <Tooltip sticky direction="center" className="bg-slate-900 text-white font-black text-xs border-2 border-cyan-400 rounded-lg px-2 py-1 shadow-2xl">
                  📏 {formatDistance(distanceMeters)} ({directionText})
                </Tooltip>
              </Polyline>
            )}

            {/* Marker 2: TARGET MOBILE PHONES (Exact Red Satellite Markers) */}
            {mappedDevices.map((dev) => (
              <React.Fragment key={dev.id}>
                <Marker position={[dev.last_latitude!, dev.last_longitude!]} icon={phoneRadarIcon}>
                  <Popup>
                    <div className="p-1 space-y-1 text-slate-900 font-sans">
                      <div className="font-bold text-sm text-rose-700">📱 {dev.device_name}</div>
                      <div className="text-xs">{dev.device_model} (Android {dev.android_version})</div>
                      <div className="text-xs font-semibold text-emerald-600">SIM: {dev.sim_number || '+919392408017'}</div>
                      <div className="text-xs font-mono text-slate-600">📍 {dev.last_latitude?.toFixed(6)}, {dev.last_longitude?.toFixed(6)}</div>
                      <div className="text-xs text-slate-500">Precision: ±{dev.last_accuracy?.toFixed(1) || '3.0'}m</div>
                      <div className="text-[10px] text-slate-500">
                        Updated: {dev.last_location_time ? new Date(dev.last_location_time).toLocaleTimeString() : 'Live'}
                      </div>
                    </div>
                  </Popup>
                  <Tooltip permanent direction="bottom" offset={[0, 20]} className="bg-slate-900 text-rose-300 font-bold text-[10px] border border-rose-500 rounded px-1 py-0.5">
                    📱 {dev.device_name}
                  </Tooltip>
                </Marker>

                {/* Radar Accuracy Circle */}
                <Circle
                  center={[dev.last_latitude!, dev.last_longitude!]}
                  radius={dev.last_accuracy || 15}
                  pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.15, weight: 1.5 }}
                />
              </React.Fragment>
            ))}
          </MapContainer>
        </div>
      </div>
      
      {/* Live Voice Microphone Intercom Modal */}
      {activeVoiceDevice && (
        <VoiceCallModal
          device={activeVoiceDevice}
          onClose={() => setActiveVoiceDevice(null)}
        />
      )}

      {/* Live Camera Stream Modal */}
      {activeCameraDevice && (
        <LiveCameraStreamModal
          device={activeCameraDevice}
          onClose={() => setActiveCameraDevice(null)}
        />
      )}
    </div>
  );
};

