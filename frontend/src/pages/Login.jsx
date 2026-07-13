import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Lock, Mail, LogIn } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await login(form.email, form.password);
      if (data.must_change_password) {
        toast('Veuillez changer votre mot de passe', { icon: '⚠️' });
        navigate('/changer-mot-de-passe');
      } else {
        navigate('/');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Connexion impossible');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Bandeau supérieur aux couleurs de l'université */}
      <div className="h-1.5 bg-gradient-to-r from-[#1e3a5f] via-blue-500 to-cyan-400" />

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* En-tête */}
          <div className="text-center mb-8">
            <img src="/dfip-icon.svg" alt="Portail DFIP" className="w-20 h-20 rounded-2xl mx-auto mb-5 shadow-lg shadow-blue-900/20" />
            <h1 className="text-slate-800 text-3xl font-bold">Portail DFIP</h1>
            <p className="text-slate-600 text-sm mt-2 font-medium">
              Direction de la Formation et de l'Ingénierie Pédagogique
            </p>
            <p className="text-slate-400 text-xs mt-1">Université numérique Cheikh Hamidou KANE - UnCHK</p>
          </div>

          {/* Carte de connexion */}
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-100 p-8">
            <h2 className="text-slate-800 font-semibold text-xl">Connexion</h2>
            <p className="text-slate-400 text-sm mb-6 mt-1">Accédez à votre espace de travail</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="text-sm font-semibold text-slate-700 block mb-1.5">Adresse email</label>
                <div className="relative">
                  <Mail size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="prenom.nom@unchk.edu.sn"
                    className="!pl-10 !py-2.5 !text-[15px] !bg-white !border-slate-300 focus:!border-blue-500"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700 block mb-1.5">Mot de passe</label>
                <div className="relative">
                  <Lock size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Votre mot de passe"
                    className="!pl-10 !pr-11 !py-2.5 !text-[15px] !bg-white !border-slate-300 focus:!border-blue-500"
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                    title={showPwd ? 'Masquer' : 'Afficher'}
                  >
                    {showPwd ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#1e3a5f] hover:bg-[#2a4d7a] text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 text-[15px] disabled:opacity-60 shadow-md shadow-blue-900/15"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Connexion en cours...
                  </>
                ) : (
                  <>
                    <LogIn size={17} /> Se connecter
                  </>
                )}
              </button>
            </form>

            <p className="text-slate-400 text-xs text-center mt-6">
              Accès réservé aux membres de la Direction.<br />
              Contactez l'administrateur si vous n'avez pas de compte.
            </p>
            <a href="/public" className="block text-center mt-4 text-sm font-medium text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-xl py-2.5 transition-colors">
              📅 Consulter le planning annuel (visiteur, sans compte)
            </a>
          </div>

          <p className="text-center text-slate-400 text-xs mt-6">
            © {new Date().getFullYear()} UnCHK — Portail DFIP
          </p>
        </div>
      </div>
    </div>
  );
}
