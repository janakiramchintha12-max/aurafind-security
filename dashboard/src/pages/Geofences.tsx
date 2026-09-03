import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Circle, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Shield, Plus, Trash2, ShieldAlert, CheckCircle, Navigation, MapPin } from 'lucide-react';
import { geofencesApi, devicesApi } from '../services/api';
import { Geofence, GeofenceEvent, Device } from '../types';

const geofenceCenterIcon = new L.DivIcon({
  className: 'geofence-center-marker',
  html: `
    <div style="width: 24px; height: 24px; border-radius: 50%; background: #10b981; border: 2.5px solid #ffffff; box-shadow: 0 0 12px rgba(16, 185, 129, 0.8); display: flex; align-items: center; justify-content: center; color: white; font-size: 11px; font-weight: bold;">
      🛡️
    </div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -14]
});

function MapRecenter({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom || 15);
  }, [center, zoom, map]);
  return null;
}

function MapClickHandler({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

export const GeofencesPage: React.FC = () => {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [events, setEvents] = useState<GeofenceEvent[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapTheme, setMapTheme] = useState<'satellite' | 'dark' | 'street'>('satellite');

  // New Geofence State
  const [name, setName] = useState('Home Zone');
  const [lat, setLat] = useState<number>(14.0415);
  const [lng, setLng] = useState<number>(79.2625);
  const [radius, setRadius] = useState<number>(200);
  const [desc, setDesc] = useState('Safe Primary Zone');
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchData = async () => {
    try {
      const gfs = await geofencesApi.list();
      setGeofences(gfs);
      const evs = await geofencesApi.listEvents();
      setEvents(evs);
      const devs = await devicesApi.list();
      setDevices(devs);
      if (devs.length > 0 && devs[0].last_latitude && devs[0].last_longitude) {
        setLat(devs[0].last_latitude);
        setLng(devs[0].last_longitude);
      }
    } catch (e) {
      console.error('Failed to load geofences', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await geofencesApi.create(name, lat, lng, radius, desc);
      setShowAddModal(false);
      fetchData();
    } catch (e) {
      alert('Failed to create geofence');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this geofence boundary?')) return;
    try {
      await geofencesApi.delete(id);
      fetchData();
    } catch (e) {
      alert('Failed to delete geofence');
    }
  };

  const activeDevice = devices.find(d => d.last_latitude != null && d.last_longitude != null);
  const centerCoord: [number, number] = geofences.length > 0
    ? [geofences[0].latitude, geofences[0].longitude]
    : activeDevice?.last_latitude && activeDevice?.last_longitude
    ? [activeDevice.last_latitude, activeDevice.last_longitude]
    : [14.0415, 79.2625];

  const tileLayerUrls = {
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    street: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-800/90 border border-slate-700/60 rounded-2xl p-5 shadow-2xl">
        <div>
          <h1 className="text-2xl font-black text-white tracking-wide flex items-center space-x-2">
            <Shield className="w-6 h-6 text-emerald-400" />
            <span>Geofencing & Anti-Theft Boundary Hub</span>
          </h1>
          <p className="text-sm text-slate-400">Configure virtual safety perimeters and monitor entry/exit breach alarms</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Map Layer Switcher */}
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
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30"
          >
            <Plus className="w-4 h-4" />
            <span>Create Safe Perimeter</span>
          </button>
        </div>
      </div>

      {/* Main Map & Zones Split View */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[65vh]">
        
        {/* Safe Zones Map */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl relative">
          <MapContainer center={centerCoord} zoom={15} style={{ width: '100%', height: '100%' }}>
            <TileLayer
              key={mapTheme}
              attribution='&copy; <a href="https://www.esri.com/">Esri</a> & OpenStreetMap contributors'
              url={tileLayerUrls[mapTheme]}
            />

            <MapRecenter center={centerCoord} zoom={15} />

            {/* Click to reposition modal coordinates */}
            {showAddModal && <MapClickHandler onLocationSelect={(clickLat, clickLng) => { setLat(clickLat); setLng(clickLng); }} />}

            {geofences.map((gf) => (
              <React.Fragment key={gf.id}>
                <Marker position={[gf.latitude, gf.longitude]} icon={geofenceCenterIcon}>
                  <Popup>
                    <div className="p-1 text-slate-900 text-xs font-sans">
                      <div className="font-bold text-emerald-700">{gf.name}</div>
                      <div>Radius: {gf.radius_meters}m</div>
                      <div className="text-slate-500">{gf.description}</div>
                    </div>
                  </Popup>
                </Marker>
                <Circle
                  center={[gf.latitude, gf.longitude]}
                  radius={gf.radius_meters}
                  pathOptions={{ color: '#10b981', fillColor: '#10b981', fillOpacity: 0.2, weight: 2 }}
                />
              </React.Fragment>
            ))}
          </MapContainer>
        </div>

        {/* Zones List & Breach Logs */}
        <div className="bg-slate-800/90 border border-slate-700/60 rounded-2xl p-4 flex flex-col space-y-4 overflow-y-auto">
          
          {/* Active Safe Zones */}
          <div className="space-y-2">
            <h2 className="text-xs font-bold uppercase text-slate-400 tracking-wider">Active Boundaries ({geofences.length})</h2>
            {geofences.length === 0 ? (
              <div className="text-xs text-slate-400 p-4 text-center bg-slate-900/60 rounded-xl border border-slate-700/50">
                No active safe zones. Click "Create Safe Perimeter" to add your home or office.
              </div>
            ) : (
              geofences.map((gf) => (
                <div key={gf.id} className="p-3 bg-slate-900/70 border border-slate-700/60 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="font-bold text-xs text-white flex items-center space-x-1.5">
                      <Shield className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{gf.name}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Radius: <span className="text-emerald-300 font-bold">{gf.radius_meters}m</span> | {gf.description || 'No description'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(gf.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Breach Activity Logs */}
          <div className="space-y-2 pt-2 border-t border-slate-700">
            <h2 className="text-xs font-bold uppercase text-slate-400 tracking-wider">Breach & Movement Logs</h2>
            {events.length === 0 ? (
              <div className="text-xs text-slate-400 p-4 text-center bg-slate-900/60 rounded-xl border border-slate-700/50">
                Zero security breaches detected.
              </div>
            ) : (
              events.map((ev) => (
                <div key={ev.id} className="p-2.5 bg-slate-900/70 border border-slate-700/60 rounded-xl text-xs space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className={`font-bold ${ev.event_type === 'EXIT' ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {ev.event_type === 'EXIT' ? '🚨 ZONE BREACH (EXIT)' : '✅ ZONE ARRIVAL (ENTER)'}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Geofence: <span className="text-slate-200">{ev.geofence_id}</span>
                  </div>
                </div>
              ))
            )}
          </div>

        </div>

      </div>

      {/* Add Geofence Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white flex items-center space-x-2">
              <Shield className="w-5 h-5 text-emerald-400" />
              <span>Configure Safe Perimeter</span>
            </h3>

            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Zone Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  placeholder="e.g. Home, Hostel, Office"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => setLat(parseFloat(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lng}
                    onChange={(e) => setLng(parseFloat(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-white font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Safe Perimeter Radius: <span className="text-emerald-400 font-bold">{radius} meters</span>
                </label>
                <input
                  type="range"
                  min="50"
                  max="2000"
                  step="50"
                  value={radius}
                  onChange={(e) => setRadius(parseInt(e.target.value))}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
                  placeholder="e.g. Alerts me if taken outside building"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/30"
                >
                  Save Perimeter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
