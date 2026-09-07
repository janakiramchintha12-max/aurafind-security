import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { Smartphone, RefreshCw, Navigation, Compass, Radio, Laptop, CheckCircle2, ArrowRightLeft, Move } from 'lucide-react';
import { devicesApi, commandsApi, connectWebSocket } from '../services/api';
import { Device } from '../types';

// Custom Marker for Target Mobile Device (Red Pulse Radar)
const phoneRadarIcon = new L.DivIcon({
  className: 'radar-phone-marker',
  html: `
    <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 48px; height: 48px; border-radius: 50%; background: rgba(239, 68, 68, 0.3); animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: absolute; width: 30px; height: 30px; border-radius: 50%; background: #ef4444; border: 3px solid #ffffff; box-shadow: 0 0 15px #ef4444; display: flex; align-items: center; justify-content: center; color: white; font-size: 14px;">📱</div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -20]
});

// Custom Marker for User / Laptop Location (Cyan Pulse Radar)
const userRadarIcon = new L.DivIcon({
  className: 'radar-user-marker',
  html: `
    <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; cursor: grab;">
      <div style="position: absolute; width: 48px; height: 48px; border-radius: 50%; background: rgba(6, 182, 212, 0.3); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: absolute; width: 30px; height: 30px; border-radius: 50%; background: #06b6d4; border: 3px solid #ffffff; box-shadow: 0 0 15px #06b6d4; display: flex; align-items: center; justify-content: center; color: white; font-size: 14px;">💻</div>
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

export const LiveLocationPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [rangeMode, setRangeMode] = useState<'laptop_phone' | 'device_device'>('laptop_phone');
  const [mapTheme, setMapTheme] = useState<'satellite' | 'dark' | 'street'>('satellite');
  const [loading, setLoading] = useState(true);

  // 1. Live Browser Geolocation Watcher for Laptop
  useEffect(() => {
    if (typeof window !== 'undefined' && 'geolocation' in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setUserLocation(prev => {
            // Keep existing position if manually dragged unless first fix
            if (!prev) {
              return {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy
              };
            }
            return prev;
          });
        },
        (err) => {
          console.warn('Browser GPS permission or status:', err.message);
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);

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

  // Fallback initial laptop coordinate if browser GPS is blocked
  useEffect(() => {
    if (!userLocation && mappedDevices.length > 0) {
      // Offset slightly (20m south) for intuitive initial visualization if browser GPS blocked
      const ref = mappedDevices[0];
      setUserLocation({
        lat: (ref.last_latitude || 14.0413) - 0.00018,
        lng: (ref.last_longitude || 79.2624) - 0.00005
      });
    }
  }, [mappedDevices, userLocation]);

  // Determine Comparison Endpoints (Point A and Point B)
  let originLat: number | null = null;
  let originLng: number | null = null;
  let originLabel = 'YOUR LAPTOP';

  let targetLat: number | null = null;
  let targetLng: number | null = null;
  let targetLabel = selectedDevice?.device_name || 'TARGET PHONE';

  if (rangeMode === 'laptop_phone') {
    if (userLocation) {
      originLat = userLocation.lat;
      originLng = userLocation.lng;
      originLabel = 'YOUR LAPTOP';
    }
    if (selectedDevice?.last_latitude && selectedDevice?.last_longitude) {
      targetLat = selectedDevice.last_latitude;
      targetLng = selectedDevice.last_longitude;
      targetLabel = selectedDevice.device_name;
    }
  } else {
    // Inter-device mode: compare Device 1 and Device 2
    if (mappedDevices.length >= 2) {
      originLat = mappedDevices[0].last_latitude!;
      originLng = mappedDevices[0].last_longitude!;
      originLabel = mappedDevices[0].device_name;

      targetLat = mappedDevices[1].last_latitude!;
      targetLng = mappedDevices[1].last_longitude!;
      targetLabel = mappedDevices[1].device_name;
    }
  }

  // Real GPS Distance & Bearing Calculation
  let distanceMeters: number | null = null;
  let bearingDegrees: number | null = null;
  let directionText = 'At Same Spot 📍';

  if (originLat != null && originLng != null && targetLat != null && targetLng != null) {
    distanceMeters = calculateDistanceMeters(originLat, originLng, targetLat, targetLng);
    bearingDegrees = calculateBearingDegrees(originLat, originLng, targetLat, targetLng);
    directionText = distanceMeters <= 3 ? 'At Same Spot 📍' : getCompassDirection(bearingDegrees);
  }

  const handleLocateFresh = async () => {
    if (!selectedDevice) return;
    try {
      await commandsApi.dispatch(selectedDevice.id, 'LOCATE_NOW');
      await commandsApi.dispatch(selectedDevice.id, 'HIGH_ACCURACY_MODE');
      fetchDevices();
    } catch (e) {
      console.error('Failed to request fresh satellite fix', e);
    }
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
    : userLocation
    ? [userLocation.lat, userLocation.lng]
    : [14.0413, 79.2624];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-wide flex items-center space-x-2">
            <Radio className="w-6 h-6 text-cyan-400 animate-pulse" />
            <span>Tactical Dual-GPS Proximity Rangefinder</span>
          </h1>
          <p className="text-sm text-slate-400">
            Real-time live distance & bearing calculation with drag-to-calibrate positioning
          </p>
        </div>

        {/* Mode Switcher & Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Range Mode Switcher */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-1 flex items-center space-x-1 text-xs">
            <button
              onClick={() => setRangeMode('laptop_phone')}
              className={`px-2.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1 ${
                rangeMode === 'laptop_phone' ? 'bg-cyan-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Laptop className="w-3 h-3" />
              <span>Laptop ↔ Phone</span>
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

      {/* Cockpit HUD & Real-Time Proximity Rangefinder */}
      <div className="bg-slate-800/95 border border-cyan-500/40 rounded-2xl p-4 shadow-2xl backdrop-blur grid grid-cols-2 md:grid-cols-5 gap-3 items-center">
        
        {/* Origin Endpoint */}
        <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/60 text-center">
          <div className="text-[10px] text-cyan-400 font-extrabold uppercase tracking-wider flex items-center justify-center gap-1">
            <Laptop className="w-3 h-3 text-cyan-400" />
            <span>FROM: {originLabel}</span>
          </div>
          {originLat != null && originLng != null ? (
            <>
              <div className="text-xs font-bold text-cyan-300 font-mono mt-1">
                📍 {originLat.toFixed(5)}, {originLng.toFixed(5)}
              </div>
              <div className="text-[10px] text-slate-400 flex items-center justify-center gap-1 mt-0.5">
                <Move className="w-2.5 h-2.5 text-cyan-400" />
                <span>Drag 💻 marker on map</span>
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-400 mt-1">Acquiring position...</div>
          )}
        </div>

        {/* Target Endpoint */}
        <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/60 text-center">
          <div className="text-[10px] text-rose-400 font-extrabold uppercase tracking-wider flex items-center justify-center gap-1">
            <Smartphone className="w-3 h-3 text-rose-400" />
            <span>TO: {targetLabel}</span>
          </div>
          {targetLat != null && targetLng != null ? (
            <div className="text-xs font-bold text-rose-300 font-mono mt-1">
              📍 {targetLat.toFixed(5)}, {targetLng.toFixed(5)}
            </div>
          ) : (
            <div className="text-xs text-slate-400 mt-1">Signal Syncing...</div>
          )}
        </div>

        {/* EXACT LIVE DISTANCE BOX */}
        <div className="bg-slate-900/90 p-2.5 rounded-xl border-2 border-cyan-500/60 text-center shadow-lg shadow-cyan-500/10">
          <div className="text-[10px] text-cyan-300 font-extrabold uppercase tracking-wider">EXACT LIVE DISTANCE</div>
          <div className={`text-2xl font-black tracking-tight ${
            distanceMeters != null
              ? distanceMeters <= 20
                ? 'text-emerald-400 animate-pulse'
                : distanceMeters <= 100
                ? 'text-cyan-400'
                : 'text-amber-400'
              : 'text-slate-400'
          }`}>
            {formatDistance(distanceMeters)}
          </div>
          <div className="text-[10px] font-bold text-slate-300">
            {distanceMeters != null ? (distanceMeters <= 10 ? '🚨 Immediate Proximity' : '📡 Real-Time Dual GPS Delta') : 'Live Synced'}
          </div>
        </div>

        {/* Direction Compass */}
        <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/60 text-center">
          <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider flex items-center justify-center space-x-1">
            <Compass className="w-3 h-3 text-cyan-400" />
            <span>MOVE TOWARDS</span>
          </div>
          <div className="text-sm font-extrabold text-cyan-300 flex items-center justify-center space-x-1.5 mt-0.5">
            {bearingDegrees != null && distanceMeters != null && distanceMeters > 3 && (
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

        {/* Actions & Navigation */}
        <div className="col-span-2 md:col-span-1 flex flex-col gap-1.5">
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="py-2 px-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white border border-cyan-400 font-bold rounded-xl text-xs flex items-center justify-center space-x-1.5 transition-all shadow-lg shadow-cyan-600/20"
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>Live Walk Guide</span>
          </a>
        </div>

      </div>

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
                onClick={() => setSelectedDevice(dev)}
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
                    {hasLoc ? `${dev.last_latitude?.toFixed(5)}, ${dev.last_longitude?.toFixed(5)}` : 'Signal Syncing'}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1.5">
            <div className="font-bold text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Interactive Drag Calibration</span>
            </div>
            <p>
              💡 <strong>Tip:</strong> Drag the <strong>💻 laptop marker</strong> anywhere on the satellite view (e.g. to your exact desk or room). Distance and direction recalculate instantly!
            </p>
          </div>
        </div>

        {/* Leaflet Map: Renders ALL markers with connecting path and distance badges */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl relative">
          <MapContainer center={mapCenter} zoom={18} style={{ width: '100%', height: '100%' }}>
            <TileLayer
              key={mapTheme}
              attribution='&copy; <a href="https://www.esri.com/">Esri</a> & OpenStreetMap contributors'
              url={tileLayerUrls[mapTheme]}
              maxZoom={20}
            />

            {/* Marker 1: USER / LAPTOP LOCATION (Draggable Cyan Marker) */}
            {userLocation && (
              <Marker
                position={[userLocation.lat, userLocation.lng]}
                icon={userRadarIcon}
                draggable={true}
                eventHandlers={{
                  dragend: (e) => {
                    const marker = e.target;
                    const pos = marker.getLatLng();
                    setUserLocation({ lat: pos.lat, lng: pos.lng });
                  }
                }}
              >
                <Popup>
                  <div className="p-1 space-y-1 text-slate-900 font-sans">
                    <div className="font-bold text-sm text-cyan-700">💻 Your Laptop Location (Draggable)</div>
                    <div className="text-xs font-mono">📍 {userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}</div>
                    <div className="text-[10px] text-slate-500">Drag to calibrate exact spot on map</div>
                  </div>
                </Popup>
                <Tooltip permanent direction="top" offset={[0, -20]} className="bg-slate-900 text-cyan-300 font-bold text-[10px] border border-cyan-500 rounded px-1 py-0.5">
                  💻 You (Drag me)
                </Tooltip>
              </Marker>
            )}

            {/* Connecting Rangefinder Line */}
            {originLat != null && originLng != null && targetLat != null && targetLng != null && (
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

            {/* Marker 2: TARGET MOBILE PHONES (Red Radar Markers) */}
            {mappedDevices.map((dev) => (
              <React.Fragment key={dev.id}>
                <Marker position={[dev.last_latitude!, dev.last_longitude!]} icon={phoneRadarIcon}>
                  <Popup>
                    <div className="p-1 space-y-1 text-slate-900 font-sans">
                      <div className="font-bold text-sm text-rose-700">📱 {dev.device_name}</div>
                      <div className="text-xs">{dev.device_model} (Android {dev.android_version})</div>
                      <div className="text-xs font-semibold text-emerald-600">SIM: {dev.sim_number || '+919392408017'}</div>
                      <div className="text-xs font-mono text-slate-600">📍 {dev.last_latitude?.toFixed(5)}, {dev.last_longitude?.toFixed(5)}</div>
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
                  radius={dev.last_accuracy || 25}
                  pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.12, weight: 1.5 }}
                />
              </React.Fragment>
            ))}
          </MapContainer>
        </div>

      </div>
    </div>
  );
};

