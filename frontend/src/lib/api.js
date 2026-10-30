import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('portail_dfe_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    // Un échec de connexion (401) ne doit pas recharger la page : le message
    // « tentative x/3 » doit rester affiché sur l'écran de connexion
    const routePublique = /^\/?auth\/(login|forgot-password|reset-password)/.test(err.config?.url || '');
    if (err.response?.status === 401 && !routePublique) {
      localStorage.removeItem('portail_dfe_token');
      localStorage.removeItem('portail_dfe_user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
