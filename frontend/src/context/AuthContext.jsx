import { createContext, useContext, useState, useEffect, useRef } from 'react';
import api from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('portail_dfe_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [notifCount, setNotifCount] = useState(0);
  const heartbeatRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('portail_dfe_token');
    if (token) {
      api.get('/auth/me')
        .then(r => {
          setUser(r.data.user);
          setNotifCount(r.data.notifications_non_lues);
          localStorage.setItem('portail_dfe_user', JSON.stringify(r.data.user));
        })
        .catch(() => {
          localStorage.removeItem('portail_dfe_token');
          localStorage.removeItem('portail_dfe_user');
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // Heartbeat pour maintenir la session active
  useEffect(() => {
    if (user) {
      heartbeatRef.current = setInterval(() => {
        api.post('/auth/heartbeat').catch(() => {});
      }, 5 * 60 * 1000); // toutes les 5 minutes
    }
    return () => clearInterval(heartbeatRef.current);
  }, [user]);

  async function login(email, password) {
    const r = await api.post('/auth/login', { email, password });
    localStorage.setItem('portail_dfe_token', r.data.token);
    localStorage.setItem('portail_dfe_user', JSON.stringify(r.data.user));
    setUser(r.data.user);
    return r.data;
  }

  async function logout() {
    try { await api.post('/auth/logout'); } catch {}
    localStorage.removeItem('portail_dfe_token');
    localStorage.removeItem('portail_dfe_user');
    setUser(null);
    clearInterval(heartbeatRef.current);
  }

  function refreshNotifCount() {
    if (user) {
      api.get('/auth/me').then(r => setNotifCount(r.data.notifications_non_lues)).catch(() => {});
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, notifCount, setNotifCount, refreshNotifCount }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
