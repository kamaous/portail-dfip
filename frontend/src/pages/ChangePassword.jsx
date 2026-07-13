import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Lock, Eye, EyeOff } from 'lucide-react';

export default function ChangePassword() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ ancien_password: '', nouveau_password: '', confirm: '' });
  const [show, setShow] = useState({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.nouveau_password !== form.confirm) return toast.error('Les mots de passe ne correspondent pas');
    if (form.nouveau_password.length < 6) return toast.error('Minimum 6 caractères');

    setLoading(true);
    try {
      await api.post('/auth/change-password', {
        ancien_password: form.ancien_password,
        nouveau_password: form.nouveau_password
      });
      toast.success('Mot de passe changé avec succès !');
      navigate('/');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  function field(key, label, placeholder) {
    return (
      <div>
        <label className="text-sm font-medium text-slate-700 block mb-1">{label}</label>
        <div className="relative">
          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type={show[key] ? 'text' : 'password'}
            value={form[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            placeholder={placeholder}
            className="pl-9 pr-10"
            required
          />
          <button type="button" onClick={() => setShow(s => ({ ...s, [key]: !s[key] }))}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            {show[key] ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a5f] to-[#0f2040] flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <Lock size={24} className="text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Changement de mot de passe</h2>
          <p className="text-sm text-slate-500 mt-1">Cette étape est obligatoire avant de continuer</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {field('ancien_password', 'Mot de passe actuel', '••••••••')}
          {field('nouveau_password', 'Nouveau mot de passe', '6 caractères minimum')}
          {field('confirm', 'Confirmer le nouveau mot de passe', '••••••••')}
          <button type="submit" disabled={loading} className="btn-primary w-full py-2.5 mt-2">
            {loading ? 'Changement...' : 'Changer le mot de passe'}
          </button>
        </form>
      </div>
    </div>
  );
}
