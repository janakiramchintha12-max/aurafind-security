import axios from 'axios';
import { Device, LocationRecord, Command, Geofence, GeofenceEvent, AuditLog, Snapshot } from '../types';

const API_BASE_URL = 'http://127.0.0.1:8000/api/v1';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const authApi = {
  login: async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    return res.data;
  },
  register: async (email: string, password: string, fullName?: string) => {
    const res = await api.post('/auth/register', { email, password, full_name: fullName });
    return res.data;
  },
  me: async () => {
    const res = await api.get('/auth/me');
    return res.data;
  },
  getMe: async () => {
    const res = await api.get('/auth/me');
    return res.data;
  },
  logout: async () => {
    localStorage.removeItem('token');
  }
};

export const devicesApi = {
  list: async (): Promise<Device[]> => {
    const res = await api.get('/devices');
    return res.data;
  },
  get: async (id: string): Promise<Device> => {
    const res = await api.get(`/devices/${id}`);
    return res.data;
  },
  register: async (deviceName: string, deviceModel: string, androidVersion: string): Promise<Device> => {
    const res = await api.post('/devices/register', {
      device_name: deviceName,
      device_model: deviceModel,
      android_version: androidVersion,
    });
    return res.data;
  },
  update: async (id: string, updates: Partial<Device>): Promise<Device> => {
    const res = await api.patch(`/devices/${id}`, updates);
    return res.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/devices/${id}`);
  },
};

export const locationsApi = {
  getLatest: async (deviceId: string): Promise<LocationRecord> => {
    const res = await api.get(`/devices/${deviceId}/locations/latest`);
    return res.data;
  },
  getHistory: async (deviceId: string, range: string = 'today', startDate?: string, endDate?: string): Promise<LocationRecord[]> => {
    const params: any = { range };
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    const res = await api.get(`/devices/${deviceId}/locations/history`, { params });
    return res.data;
  },
};

export const commandsApi = {
  dispatch: async (deviceId: string, commandType: string, payload?: object): Promise<Command> => {
    const res = await api.post(`/devices/${deviceId}/commands`, {
      command_type: commandType,
      payload: payload ? JSON.stringify(payload) : '{}',
    });
    return res.data;
  },
  list: async (deviceId: string): Promise<Command[]> => {
    const res = await api.get(`/devices/${deviceId}/commands`);
    return res.data;
  },
};

export const snapshotsApi = {
  list: async (deviceId: string): Promise<Snapshot[]> => {
    const res = await api.get(`/devices/${deviceId}/snapshots`);
    return res.data;
  },
};

export const geofencesApi = {
  list: async (): Promise<Geofence[]> => {
    const res = await api.get('/geofences');
    return res.data;
  },
  create: async (name: string, latitude: number, longitude: number, radiusMeters: number, description?: string): Promise<Geofence> => {
    const res = await api.post('/geofences', {
      name,
      latitude,
      longitude,
      radius_meters: radiusMeters,
      description,
    });
    return res.data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/geofences/${id}`);
  },
  getEvents: async (): Promise<GeofenceEvent[]> => {
    const res = await api.get('/geofences/events');
    return res.data;
  },
  listEvents: async (): Promise<GeofenceEvent[]> => {
    const res = await api.get('/geofences/events');
    return res.data;
  }
};

export const auditApi = {
  list: async (): Promise<AuditLog[]> => {
    const res = await api.get('/audit-logs');
    return res.data;
  },
};

export function connectWebSocket(onMessage: (data: any) => void): () => void {
  const token = localStorage.getItem('token');
  if (!token) return () => {};

  const wsUrl = `ws://127.0.0.1:8000/api/v1/ws?token=${token}`;
  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (e) {
      console.error('Failed to parse WS message', e);
    }
  };

  return () => {
    ws.close();
  };
}
