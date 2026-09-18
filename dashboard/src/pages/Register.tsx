import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, Lock, UserRound, Shield } from 'lucide-react';
import { authApi } from '../services/api';

interface RegisterProps {
  setUser: (user: any) => void;
}

export const Register: React.FC<RegisterProps> = ({ setUser }) => {
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await authApi.register(username.trim(), password, fullName.trim() || undefined);
      await authApi.login(username.trim(), password);
      setUser(await authApi.getMe());
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Unable to create the account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center px-4">
      <div className="flex items-center space-x-3 mb-8">
        <div className="p-3 bg-cyan-600 rounded-2xl shadow-lg shadow-cyan-600/30">
          <Shield className="w-8 h-8 text-white" />
        </div>
        <span className="text-2xl font-black text-white tracking-wide">AuraFind</span>
      </div>
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-8 max-w-md w-full shadow-2xl">
        <div className="text-center mb-6">
          <h2 className="text-xl font-bold text-white">Create your account</h2>
          <p className="text-xs text-slate-400 mt-1">Use this account to manage your enrolled devices</p>
        </div>
        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-400 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="block text-xs font-semibold text-slate-300 mb-1">Username</span>
            <span className="relative block">
              <UserRound className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
              <input required value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white" />
            </span>
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-slate-300 mb-1">Name (optional)</span>
            <span className="relative block">
              <UserRound className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white" />
            </span>
          </label>
          {[['Password', password, setPassword], ['Confirm password', confirmPassword, setConfirmPassword]].map(([label, value, setter]) => (
            <label className="block" key={label as string}>
              <span className="block text-xs font-semibold text-slate-300 mb-1">{label as string}</span>
              <span className="relative block">
                <Lock className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
                <input required type="password" minLength={10} value={value as string} onChange={(e) => (setter as React.Dispatch<React.SetStateAction<string>>)(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white" />
              </span>
            </label>
          ))}
          <p className="text-xs text-slate-500">Password must be at least 10 characters.</p>
          <button disabled={loading} className="w-full py-2.5 bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold rounded-xl text-sm disabled:opacity-50">
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>
        <div className="mt-6 text-center text-xs text-slate-500">
          Already have an account? <Link to="/login" className="text-cyan-400 font-semibold">Sign in</Link>
        </div>
      </div>
    </div>
  );
};
