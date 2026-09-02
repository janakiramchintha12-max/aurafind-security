import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Smartphone, Battery, MapPin, RefreshCw, Navigation, Compass, ExternalLink, ShieldCheck, Gauge, Eye, Radio, Laptop, Crosshair, Target, Info } from 'lucide-react';
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
    <div style="position: relative; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; width: 48px; height: 48px; border-radius: 50%; background: rgba(6, 182, 212, 0.3); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
      <div style="position: absolute; width: 30px; height: 30px; border-radius: 50%; background: #06b6d4; border: 3px solid #ffffff; box-shadow: 0 0 15px #06b6d4; display: flex; align-items: center; justify-content: center; color: white; font-size: 14px;">💻</div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  popupAnchor: [0, -20]
});

// Accurate Haversine Distance Calculation (in Meters)
function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// Initial Bearing from Point 1 (User) to Point 2 (Phone)
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

// Map Click Listener to manually drop Laptop pin
function MapClickHandler({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

export const LiveLocationPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapTheme, setMapTheme] = useState<'satellite' | 'dark' | 'street'>('satellite');
  const [loading, setLoading] = useState(true);

  // Set laptop location to starting local base (near phone's real neighborhood)
  const calibrateLaptopToLocalBase = () => {
    if (selectedDevice?.last_latitude && selectedDevice?.last_longitude) {
      setUserLocation({
        lat: selectedDevice.last_latitude,
        lng: selectedDevice.last_longitude
      });
    }
  };

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

  // Default Laptop location to local base if unset
  useEffect(() => {
    if (!userLocation && selectedDevice?.last_latitude && selectedDevice?.last_longitude) {
      setUserLocation({
        lat: selectedDevice.last_latitude,
        lng: selectedDevice.last_longitude
      });
    }
  }, [selectedDevice]);

  const mappedDevices = devices.filter((d) => d.last_latitude != null && d.last_longitude != null);
  
  // Real GPS Distance & Bearing Calculation
  let distanceMeters: number | null = null;
  let bearingDegrees: number | null = null;
  let directionText = 'At Same Spot 📍';

  if (userLocation && selectedDevice?.last_latitude && selectedDevice?.last_longitude) {
    distanceMeters = calculateDistanceMeters(
      userLocation.lat,
      userLocation.lng,
      selectedDevice.last_latitude,
      selectedDevice.last_longitude
    );
    bearingDegrees = calculateBearingDegrees(
      userLocation.lat,
      userLocation.lng,
      selectedDevice.last_latitude,
      selectedDevice.last_longitude
    );
    directionText = distanceMeters <= 5 ? 'At Same Spot 📍' : getCompassDirection(bearingDegrees);
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

  const googleMapsUrl = selectedDevice?.last_latitude && selectedDevice?.last_longitude
    ? `https://www.google.com/maps/dir/?api=1&destination=${selectedDevice.last_latitude},${selectedDevice.last_longitude}&travelmode=walking`
    : '#';

  const streetViewUrl = selectedDevice?.last_latitude && selectedDevice?.last_longitude
    ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${selectedDevice.last_latitude},${selectedDevice.last_longitude}`
    : '#';

  const tileLayerUrls = {
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    street: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  };

  const mapCenter: [number, number] = selectedDevice?.last_latitude && selectedDevice?.last_longitude
    ? [selectedDevice.last_latitude, selectedDevice.last_longitude]
    : [14.0415, 79.2625];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
      
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-wide flex items-center space-x-2">
            <Radio className="w-6 h-6 text-cyan-400 animate-pulse" />
            <span>Tactical Multi-Device Live Location Navigator</span>
          </h1>
          <p className="text-sm text-slate-400">
            Real Dual-Point GPS Positioning: Displays your Laptop & Target Mobile on Live Map
          </p>
        </div>

        {/* Map Theme & Signal Controls */}
        <div className="flex flex-wrap items-center gap-2">
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
              🌌 Cyber Dark
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
            onClick={calibrateLaptopToLocalBase}
            className="flex items-center space-x-1.5 px-3 py-2 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 font-bold rounded-xl text-xs shadow-lg transition-all"
            title="Set laptop home base to current spot"
          >
            <Target className="w-3.5 h-3.5 text-emerald-400" />
            <span>📍 Set Laptop Base (Here)</span>
          </button>

          <button
            onClick={handleLocateFresh}
            className="flex items-center space-x-1.5 px-3 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-cyan-600/20"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Request Fresh GPS Fix</span>
          </button>
        </div>
      </div>

      {/* Cockpit HUD & Real-Time Proximity Navigator Bar */}
      {selectedDevice && selectedDevice.last_latitude && selectedDevice.last_longitude && (
        <div className="bg-slate-800/95 border border-cyan-500/40 rounded-2xl p-4 shadow-2xl backdrop-blur grid grid-cols-2 md:grid-cols-5 gap-3 items-center">
          
          {/* Target Phone info */}
          <div className="space-y-0.5">
            <div className="text-[10px] text-rose-400 font-extrabold uppercase tracking-wider flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
              <span>TARGET MOBILE POSITION</span>
            </div>
            <div className="text-base font-bold text-white flex items-center space-x-1.5 truncate">
              <Smartphone className="w-4 h-4 text-rose-400 flex-shrink-0" />
              <span className="truncate">{selectedDevice.device_name}</span>
            </div>
            <div className="text-[11px] font-mono text-rose-300">
              📍 {selectedDevice.last_latitude.toFixed(5)}, {selectedDevice.last_longitude.toFixed(5)}
            </div>
          </div>

          {/* User / Laptop Position Info with 1-Click Detect Button */}
          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/60 text-center">
            <div className="text-[10px] text-cyan-400 font-extrabold uppercase tracking-wider flex items-center justify-center gap-1">
              <Laptop className="w-3 h-3 text-cyan-400" />
              <span>YOUR LOCATION (LAPTOP)</span>
            </div>
            {userLocation ? (
              <>
                <div className="text-sm font-bold text-cyan-300 font-mono mt-0.5">
                  {userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}
                </div>
                <div className="text-[10px] text-emerald-400 font-bold">🟢 Base Locked</div>
              </>
            ) : (
              <button
                onClick={calibrateLaptopToLocalBase}
                className="mt-1 px-2.5 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold rounded-lg flex items-center justify-center space-x-1 mx-auto shadow"
              >
                <Crosshair className="w-3 h-3" />
                <span>Set Base Spot</span>
              </button>
            )}
          </div>

          {/* Real Exact Proximity Distance */}
          <div className="bg-slate-900/70 p-2.5 rounded-xl border border-slate-700/60 text-center">
            <div className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider">REAL PROXIMITY DISTANCE</div>
            <div className={`text-2xl font-black ${
              distanceMeters != null
                ? distanceMeters <= 50
                  ? 'text-emerald-400'
                  : distanceMeters <= 500
                  ? 'text-amber-400'
                  : 'text-cyan-400'
                : 'text-slate-400'
            }`}>
              {distanceMeters != null ? (
                distanceMeters >= 1000
                  ? `${(distanceMeters / 1000).toFixed(2)} km`
                  : `${distanceMeters} meters`
              ) : (
                '0 meters'
              )}
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

          {/* Actions & Navigation */}
          <div className="col-span-2 md:col-span-1 flex flex-col gap-1.5">
            <a
              href={streetViewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="py-1.5 px-3 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 font-bold rounded-lg text-xs flex items-center justify-center space-x-1 transition-all"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>360° Street View</span>
            </a>
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="py-1.5 px-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-xs flex items-center justify-center space-x-1 shadow-md transition-all"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Google Directions</span>
            </a>
          </div>

        </div>
      )}

      {/* Main Map & Fleet Container */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[65vh]">
        
        {/* Device selector list */}
        <div className="lg:col-span-1 bg-slate-800/80 border border-slate-700/60 rounded-2xl p-4 overflow-y-auto space-y-3 shadow-xl">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase">Fleet Devices ({mappedDevices.length}/{devices.length})</h3>
            <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full">ACTIVE</span>
          </div>
          
          {devices.map((dev) => {
            const hasLoc = dev.last_latitude != null && dev.last_longitude != null;
            const isSelected = selectedDevice?.id === dev.id;

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
                    {hasLoc ? `${dev.last_latitude?.toFixed(5)}, ${dev.last_longitude?.toFixed(5)}` : 'No Signal Recorded'}
                  </div>
                </div>
              </div>
            );
          })}

          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-[11px] text-slate-400 space-y-1">
            <div className="font-bold text-cyan-300 flex items-center gap-1">
              <Info className="w-3.5 h-3.5" />
              <span>Interactive Positioning</span>
            </div>
            <p>
              Click anywhere on the map to set your laptop base, or click <span className="text-emerald-300 font-bold">"📍 Set Laptop Base (Here)"</span> at the top. As you carry your phone away, watch the distance and arrow update live!
            </p>
          </div>
        </div>

        {/* Leaflet Map: Renders BOTH markers (Laptop + Mobile Phone) with connecting path */}
        <div className="lg:col-span-3 bg-slate-900 border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl relative">
          <MapContainer center={mapCenter} zoom={16} style={{ width: '100%', height: '100%' }}>
            <TileLayer
              key={mapTheme}
              attribution='&copy; <a href="https://www.esri.com/">Esri</a> & OpenStreetMap contributors'
              url={tileLayerUrls[mapTheme]}
            />

            {/* Click anywhere on map to set Laptop position */}
            <MapClickHandler onLocationSelect={(lat, lng) => setUserLocation({ lat, lng })} />

            {/* Marker 1: USER / LAPTOP LOCATION (Cyan Marker) */}
            {userLocation && (
              <Marker position={[userLocation.lat, userLocation.lng]} icon={userRadarIcon}>
                <Popup>
                  <div className="p-1 space-y-1 text-slate-900 font-sans">
                    <div className="font-bold text-sm text-cyan-700">💻 Your Location (Laptop Base)</div>
                    <div className="text-xs font-mono">📍 {userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}</div>
                  </div>
                </Popup>
              </Marker>
            )}

            {/* Connecting Polyline between Laptop and Mobile Phone */}
            {userLocation && selectedDevice?.last_latitude && selectedDevice?.last_longitude && (
              <Polyline
                positions={[
                  [userLocation.lat, userLocation.lng],
                  [selectedDevice.last_latitude, selectedDevice.last_longitude]
                ]}
                pathOptions={{
                  color: '#06b6d4',
                  weight: 3,
                  dashArray: '8, 8',
                  opacity: 0.85
                }}
              />
            )}

            {/* Marker 2: TARGET MOBILE PHONE (Red Radar Marker) */}
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
                </Marker>

                {/* Radar Accuracy Circle */}
                <Circle
                  center={[dev.last_latitude!, dev.last_longitude!]}
                  radius={dev.last_accuracy || 50}
                  pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.15, weight: 1.5 }}
                />
              </React.Fragment>
            ))}
          </MapContainer>
        </div>

      </div>
    </div>
  );
};
