import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { DashboardPage } from './pages/Dashboard';
import { DeviceDetailsPage } from './pages/DeviceDetails';
import { LiveLocationPage } from './pages/LiveLocation';
import { LocationHistoryPage } from './pages/LocationHistory';
import { LiveAudioPage } from './pages/LiveAudio';
import { CommandsPage } from './pages/Commands';
import { AuditLogsPage } from './pages/AuditLogs';
import { GeofencesPage } from './pages/Geofences';
import { SettingsPage } from './pages/Settings';
import { authApi } from './services/api';
import { User } from './types';

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAuth() {
      const token = localStorage.getItem('token') || localStorage.getItem('access_token');
      if (token) {
        try {
          const u = await authApi.getMe();
          setUser(u);
        } catch (e) {
          console.error('Session restoration failed', e);
          localStorage.removeItem('token');
          localStorage.removeItem('access_token');
        }
      }
      setLoading(false);
    }
    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">
        Initializing AuraFind Security System...
      </div>
    );
  }

  return (
    <Router>
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
        <Navbar user={user} setUser={setUser} />

        <main className="flex-1">
          <Routes>
            <Route path="/login" element={!user ? <Login setUser={setUser} /> : <Navigate to="/" replace />} />
            <Route path="/register" element={!user ? <Register setUser={setUser} /> : <Navigate to="/" replace />} />
            
            <Route path="/" element={user ? <DashboardPage /> : <Navigate to="/login" replace />} />
            <Route path="/devices/:id" element={user ? <DeviceDetailsPage /> : <Navigate to="/login" replace />} />
            <Route path="/live" element={user ? <LiveLocationPage /> : <Navigate to="/login" replace />} />
            <Route path="/history" element={user ? <LocationHistoryPage /> : <Navigate to="/login" replace />} />
            <Route path="/audio" element={user ? <LiveAudioPage /> : <Navigate to="/login" replace />} />
            <Route path="/geofences" element={user ? <GeofencesPage /> : <Navigate to="/login" replace />} />
            <Route path="/commands" element={user ? <CommandsPage /> : <Navigate to="/login" replace />} />
            <Route path="/audit" element={user ? <AuditLogsPage /> : <Navigate to="/login" replace />} />
            <Route path="/settings" element={user ? <SettingsPage currentUser={user} /> : <Navigate to="/login" replace />} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
};

export default App;
