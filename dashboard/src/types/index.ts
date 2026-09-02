export interface User {
  id: string;
  email: string;
  full_name?: string;
  created_at: string;
}

export interface Device {
  id: string;
  user_id: string;
  device_name: string;
  device_model: string;
  android_version: string;
  app_version: string;
  device_token: string;
  
  battery_pct: number;
  is_charging: boolean;
  network_type: string;
  wifi_status: boolean;
  sim_status: boolean;
  sim_number?: string;
  gps_status: boolean;
  
  last_latitude?: number;
  last_longitude?: number;
  last_accuracy?: number;
  last_location_time?: string;
  
  last_sync_time?: string;
  last_heartbeat?: string;
  status: 'ONLINE' | 'OFFLINE' | 'UNREACHABLE';
  permission_status?: string;
  tracking_mode: 'NORMAL' | 'HIGH_ACCURACY' | 'BATTERY_SAVER' | 'OFFLINE';
  is_tracking_enabled: boolean;

  is_lost_mode?: boolean;
  lost_mode_message?: string;

  created_at: string;
}

export interface LocationRecord {
  id: string;
  device_id: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
  speed?: number;
  bearing?: number;
  provider: string;
  battery_level?: number;
  is_offline_record: boolean;
  is_battery_beacon?: boolean;
  client_timestamp: string;
  server_timestamp: string;
  sync_batch_id?: string;
}

export interface Command {
  id: string;
  device_id: string;
  user_id: string;
  command_type: 'LOCATE_NOW' | 'HIGH_ACCURACY_MODE' | 'PLAY_ALARM' | 'STOP_ALARM' | 'DISPLAY_MESSAGE' | 'REFRESH_STATUS' | 'FORCE_SYNC' | 'TOGGLE_TRACKING' | 'CAPTURE_SNAPSHOT' | 'ENABLE_LOST_MODE' | 'DISABLE_LOST_MODE' | 'SPEAK_TEXT';
  status: 'PENDING' | 'SENT' | 'EXECUTED' | 'FAILED' | 'EXPIRED';
  payload?: string;
  result?: string;
  created_at: string;
  executed_at?: string;
  expires_at: string;
}

export interface Snapshot {
  id: string;
  device_id: string;
  image_data: string;
  latitude?: number;
  longitude?: number;
  is_intruder_alert?: boolean;
  timestamp: string;
}

export interface Geofence {
  id: string;
  user_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  description?: string;
  created_at: string;
}

export interface GeofenceEvent {
  id: string;
  geofence_id: string;
  device_id: string;
  event_type: 'ENTER' | 'EXIT';
  latitude: number;
  longitude: number;
  timestamp: string;
}

export interface AuditLog {
  id: string;
  user_id?: string;
  device_id?: string;
  action: string;
  resource: string;
  ip_address?: string;
  details?: string;
  timestamp: string;
}
