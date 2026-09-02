import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Circle, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { Map, Plus, Trash2, ShieldAlert, CheckCircle, Navigation } from 'lucide-react';
import { geofencesApi } from '../services/api';
import { Geofence, GeofenceEvent } from '../types';

const geofenceIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export const GeofencesPage: React.FC = () => {
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [events, setEvents] = useState<GeofenceEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // New Geofence State
  const [name, setName] = useState('Home Zone');
  const [lat, setLat] = useState<number>(37.7749);
  const [lng, setLng] = useState<number>(-122.4194);
  const [radius, setRadius] = useState<number>(200);
  const [desc, setDesc] = useState('Primary Residence');
  const [showAddModal, setShowAddModal] = useState(false);

  const fetchData = async () => {
    try {
      const gfs = await geofencesApi.list();
      setGeofences(gfs);
      const evs = await geofencesApi.listEvents();
      setEvents(evs);
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Geofencing & Security Perimeters</h1>
          <p className="text-sm text-slate-400">Define safe zones (Home, College, Work) and track automated boundary events</p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center space-x-2 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl text-sm shadow-lg shadow-cyan-600/30"
        >
          <Plus className="w-4 h-4" />
          <span>New Geofence</span>
        </button>
      </div>

      {/* Grid view */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[70vh]">
        
        {/* Interactive Map */}
        <div className="lg:col-span-2 bg-slate-800/80 border border-slate-700/60 rounded-2xl overflow-hidden shadow-2xl relative">
          <MapContainer center={[lat, lng]} zoom={12} style={{ width: '100%', height: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {geofences.map((gf) => (
              <React.Fragment key={gf.id}>
                <Marker position={[gf.latitude, gf.longitude]} icon={geofenceIcon}>
                  <Popup>
                    <div className="p-1 space-y-1 text-slate-900 text-xs">
                      <div className="font-bold text-cyan-700">{gf.name}</div>
                      <div>{gf.description}</div>
                      <div>Radius: {gf.radius_meters} meters</div>
                    </div>
                  </Popup>
                </Marker>

                <Circle
                  center={[gf.latitude, gf.longitude]}
                  radius={gf.radius_meters}
                  pathOptions={{ color: '#0284c7', fillColor: '#0284c7', fillOpacity: 0.2, weight: 2 }}
                />
              </React.Fragment>
            ))}
          </MapContainer>
        </div>

        {/* Geofence Cards & Logs Sidebar */}
        <div className="space-y-6 overflow-y-auto pr-1">
          
          {/* Active Geofences List */}
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-4 space-y-3 shadow-xl">
            <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase">
              Active Geofences ({geofences.length})
            </h3>

            {geofences.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-xs">No geofence perimeters configured.</div>
            ) : (
              geofences.map((gf) => (
                <div key={gf.id} className="p-3 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-white">{gf.name}</span>
                    <button
                      onClick={() => handleDelete(gf.id)}
                      className="p-1 text-slate-500 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-xs text-slate-400">{gf.description || 'No description'}</div>
                  <div className="text-[11px] font-mono text-cyan-400 flex items-center justify-between">
                    <span>Radius: {gf.radius_meters}m</span>
                    <span>{gf.latitude.toFixed(4)}, {gf.longitude.toFixed(4)}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Event Activity Log */}
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-4 space-y-3 shadow-xl">
            <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase">
              Boundary Activity Log ({events.length})
            </h3>

            {events.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-xs">No entry/exit events logged yet.</div>
            ) : (
              events.slice(0, 10).map((ev) => (
                <div key={ev.id} className="p-2.5 bg-slate-900/60 border border-slate-800 rounded-xl text-xs space-y-1">
                  <div className="flex items-center justify-between font-semibold">
                    <span className={ev.event_type === 'ENTER' ? 'text-emerald-400' : 'text-amber-400'}>
                      {ev.event_type === 'ENTER' ? 'Entered Zone' : 'Exited Zone'}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">Device ID: {ev.device_id.substring(0, 8)}...</div>
                </div>
              ))
            )}
          </div>

        </div>
      </div>

      {/* Modal for adding geofence */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-3">Create Geofence Zone</h3>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-300 mb-1">Zone Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => setLat(parseFloat(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lng}
                    onChange={(e) => setLng(parseFloat(e.target.value))}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Radius (Meters): {radius}m</label>
                <input
                  type="range"
                  min="50"
                  max="2000"
                  step="50"
                  value={radius}
                  onChange={(e) => setRadius(parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-300 mb-1">Description</label>
                <input
                  type="text"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-xl"
                >
                  Save Geofence
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
