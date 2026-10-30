import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Mail, Lock, Eye, EyeOff, KeyRound, ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react';

/* Récupération du mot de passe (sans compte connecté) :
   - MotDePasseOublie : saisie de l'email → lien envoyé si le compte existe,
     sinon invitation à se rapprocher de l'administrateur
   - ReinitialiserMotDePasse : page ouverte depuis le lien reçu par email */

function Cadre({ titre, sousTitre, children }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="h-1.5 bg-gradient-to-r from-[#1e3a5f] via-blue-500 to-cyan-400" />
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <img src="/dfip-icon.svg" alt="SUIVI PÉDAGOGIQUE" className="w-16 h-16 rounded-2xl mx-auto mb-4 shadow-lg shadow-blue-900/20" />
            <h1 className="text-slate-800 text-2xl font-bold">SUIVI PÉDAGOGIQUE</h1>
            <p className="text-slate-400 text-xs mt-1">Université numérique Cheikh Hamidou KANE - UnCHK</p>
          </div>
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-100 p-8">
            <h2 className="text-slate-800 font-semibold text-xl flex items-center gap-2"><KeyRound size={20} className="text-amber-600" /> {titre}</h2>
            <p className="text-slate-400 text-sm mb-6 mt-1">{sousTitre}</p>
            {children}
            <Link to="/login" className="mt-6 flex items-center justify-center gap-1.5 text-sm font-medium text-blue-700 hover:text-blue-900">
              <ArrowLeft size={15} /> Retour à la connexion
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Message({ type, children }) {
  const styles = type === 'succes'
    ? 'bg-green-50 border-green-300 text-green-800'
    : type === 'alerte' ? 'bg-amber-50 border-amber-300 text-amber-900' : 'bg-red-50 border-red-300 text-red-800';
  const Icone = type === 'succes' ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm flex gap-2 ${styles}`}>
      <Icone size={17} className="shrink-0 mt-0.5" /><span>{children}</span>
    </div>
  );
}

export function MotDePasseOublie() {
  const location = useLocation();
  const [email, setEmail] = useState(location.state?.email || '');
  const [loading, setLoading] = useState(false);
  const [resultat, setResultat] = useState(null); // { type, message }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setResultat(null);
    try {
      const r = await api.post('/auth/forgot-password', { email: email.trim() });
      setResultat({ type: 'succes', message: r.data.message });
    } catch (err) {
      const st = err.response?.status;
      setResultat({
        type: st === 404 || st === 423 ? 'erreur' : 'alerte',
        message: err.response?.data?.error || 'Demande impossible pour le moment',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Cadre titre="Mot de passe oublié" sousTitre="Saisissez l'adresse email de votre compte : un lien de récupération vous sera envoyé.">
      {resultat?.type === 'succes' ? (
        <Message type="succes">{resultat.message} Pensez à vérifier vos spams.</Message>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-sm font-semibold text-slate-700 block mb-1.5">Adresse email</label>
            <div className="relative">
              <Mail size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="prenom.nom@unchk.edu.sn" autoComplete="email" required
                className="!pl-10 !py-2.5 !text-[15px] !bg-white !border-slate-300 focus:!border-blue-500" />
            </div>
          </div>
          {resultat && <Message type={resultat.type}>{resultat.message}</Message>}
          <button type="submit" disabled={loading}
            className="w-full bg-[#1e3a5f] hover:bg-[#2a4d7a] text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 text-[15px] disabled:opacity-60 shadow-md shadow-blue-900/15">
            {loading ? 'Envoi en cours...' : <><Mail size={17} /> Recevoir le lien de récupération</>}
          </button>
        </form>
      )}
    </Cadre>
  );
}

export function ReinitialiserMotDePasse() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [etat, setEtat] = useState({ chargement: true, email: '', erreur: '' });
  const [form, setForm] = useState({ nouveau_password: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) { setEtat({ chargement: false, email: '', erreur: 'Lien de récupération incomplet. Faites une nouvelle demande.' }); return; }
    api.get(`/auth/reset-password/${encodeURIComponent(token)}`)
      .then(r => setEtat({ chargement: false, email: r.data.email, erreur: '' }))
      .catch(err => setEtat({ chargement: false, email: '', erreur: err.response?.data?.error || 'Lien invalide' }));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.nouveau_password !== form.confirm) return toast.error('Les mots de passe ne correspondent pas');
    if (form.nouveau_password.length < 6) return toast.error('Minimum 6 caractères');
    setLoading(true);
    try {
      const r = await api.post('/auth/reset-password', { token, nouveau_password: form.nouveau_password });
      toast.success(r.data.message);
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Cadre titre="Nouveau mot de passe" sousTitre={etat.email ? `Compte : ${etat.email}` : 'Réinitialisation du mot de passe'}>
      {etat.chargement ? (
        <div className="flex justify-center py-6"><div className="w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>
      ) : etat.erreur ? (
        <div className="space-y-3">
          <Message type="erreur">{etat.erreur}</Message>
          <Link to="/mot-de-passe-oublie" className="block text-center text-sm font-semibold text-amber-700 hover:underline">Faire une nouvelle demande</Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {[['nouveau_password', 'Nouveau mot de passe', '6 caractères minimum'], ['confirm', 'Confirmer le mot de passe', '••••••••']].map(([k, label, ph]) => (
            <div key={k}>
              <label className="text-sm font-semibold text-slate-700 block mb-1.5">{label}</label>
              <div className="relative">
                <Lock size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type={show ? 'text' : 'password'} value={form[k]} placeholder={ph} required autoComplete="new-password"
                  onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
                  className="!pl-10 !pr-11 !py-2.5 !text-[15px] !bg-white !border-slate-300 focus:!border-blue-500" />
                <button type="button" onClick={() => setShow(v => !v)} title={show ? 'Masquer' : 'Afficher'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5">
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>
          ))}
          <button type="submit" disabled={loading}
            className="w-full bg-[#1e3a5f] hover:bg-[#2a4d7a] text-white font-semibold py-3 rounded-xl transition-colors text-[15px] disabled:opacity-60">
            {loading ? 'Enregistrement...' : 'Enregistrer le nouveau mot de passe'}
          </button>
        </form>
      )}
    </Cadre>
  );
}
