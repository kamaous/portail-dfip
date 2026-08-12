import { useEffect, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, UserX, UserCheck, Edit } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ROLES = ['RECTEUR', 'VICE_RECTEUR', 'DIRECTEUR', 'DIRECTEUR_DES', 'DIRECTEUR_DEVES', 'COORDONNATEUR', 'CHEF_SERVICE', 'CHEF_DIV_TECHNOPEDAGOGIE', 'CHEF_DIV_EVALUATION', 'RESPONSABLE_POLE', 'RESPONSABLE_PEDAGOGIQUE', 'RESPONSABLE_FORMATION', 'CHARGE_SCOLARITE', 'MEMBRE_POLE', 'SCOLARITE', 'ENSEIGNANT', 'ETUDIANT', 'ADMIN_PORTAIL'];
const ROLE_LABELS = {
  RECTEUR: 'Recteur', VICE_RECTEUR: 'Vice-Recteur Pédagogie', DIRECTEUR: 'Directeur DFIP',
  DIRECTEUR_DES: 'Directeur des Études et de la Scolarité (DES)',
  DIRECTEUR_DEVES: 'Directeur DEVES',
  COORDONNATEUR: 'Coordonnateur du Projet',
  CHARGE_SCOLARITE: 'Chargé de la Scolarité (ENO)',
  CHEF_SERVICE: 'Chef de Service', CHEF_DIV_TECHNOPEDAGOGIE: 'Chef div. Technopédagogie',
  CHEF_DIV_EVALUATION: 'Chef division DFE (Formation & Évaluations)', RESPONSABLE_POLE: 'Directeur de Pôle',
  RESPONSABLE_PEDAGOGIQUE: 'Responsable pédagogique du Pôle',
  RESPONSABLE_FORMATION: 'Responsable de Formation', MEMBRE_POLE: 'Membre de Pôle',
  SCOLARITE: 'Scolarité', ENSEIGNANT: 'Enseignant', ETUDIANT: 'Étudiant', ADMIN_PORTAIL: 'Admin Plateforme',
};
const ROLE_COLORS = {
  RECTEUR: 'bg-slate-800 text-white',
  VICE_RECTEUR: 'bg-slate-200 text-slate-800',
  DIRECTEUR: 'bg-purple-100 text-purple-800',
  DIRECTEUR_DES: 'bg-fuchsia-100 text-fuchsia-800',
  DIRECTEUR_DEVES: 'bg-rose-100 text-rose-800',
  COORDONNATEUR: 'bg-yellow-100 text-yellow-800',
  CHARGE_SCOLARITE: 'bg-emerald-100 text-emerald-800',
  CHEF_SERVICE: 'bg-blue-100 text-blue-800',
  CHEF_DIV_TECHNOPEDAGOGIE: 'bg-teal-100 text-teal-800',
  CHEF_DIV_EVALUATION: 'bg-indigo-100 text-indigo-800',
  RESPONSABLE_POLE: 'bg-amber-100 text-amber-800',
  RESPONSABLE_PEDAGOGIQUE: 'bg-rose-100 text-rose-800',
  RESPONSABLE_FORMATION: 'bg-lime-100 text-lime-800',
  MEMBRE_POLE: 'bg-green-100 text-green-800',
  SCOLARITE: 'bg-orange-100 text-orange-800',
  ENSEIGNANT: 'bg-cyan-100 text-cyan-800',
  ETUDIANT: 'bg-slate-100 text-slate-600',
  ADMIN_PORTAIL: 'bg-red-100 text-red-800',
};

/* ===== Réinitialisation de mot de passe par l'administrateur =====
   - générer un mot de passe temporaire (affiché + envoyé par email), OU en définir un ;
   - dans les deux cas, l'utilisateur DEVRA le changer à sa première connexion. */
function ModalResetPassword({ user, onClose, onDone }) {
  const [mode, setMode] = useState('AUTO');   // AUTO = temporaire généré | CHOISI
  const [mdp, setMdp] = useState('');
  const [resultat, setResultat] = useState(null); // mot de passe issu du serveur
  const [loading, setLoading] = useState(false);

  async function lancer() {
    if (mode === 'CHOISI' && mdp.trim().length < 6) return toast.error('6 caractères minimum');
    setLoading(true);
    try {
      const r = await api.post(`/users/${user.id}/reset-password`, { password: mode === 'CHOISI' ? mdp.trim() : '' });
      setResultat(r.data.tmp_password);
      onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }

  function copier() {
    navigator.clipboard?.writeText(resultat).then(() => toast.success('Mot de passe copié'))
      .catch(() => toast.error('Copie impossible — notez-le manuellement'));
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-slate-800">🔑 Réinitialiser le mot de passe</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">
            Compte : <strong>{user.prenom} {user.nom}</strong> <span className="text-slate-400">({user.email})</span>
          </p>

          {resultat === null ? (
            <>
              <div className="space-y-2">
                {[['AUTO', 'Générer un mot de passe temporaire', 'Le mot de passe est créé automatiquement, affiché ici et envoyé par email à l\'utilisateur.'],
                  ['CHOISI', 'Définir moi-même le mot de passe', 'Vous saisissez le mot de passe et le communiquez vous-même à l\'utilisateur.']].map(([v, l, d]) => (
                  <label key={v} className={`block border-2 rounded-xl p-3 cursor-pointer ${mode === v ? 'border-[#1e3a5f] bg-blue-50/50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <span className="flex items-center gap-2">
                      <input type="radio" checked={mode === v} onChange={() => setMode(v)} className="accent-[#1e3a5f]" />
                      <span className="text-sm font-semibold text-slate-800">{l}</span>
                    </span>
                    <span className="block text-xs text-slate-500 mt-1 ml-6">{d}</span>
                  </label>
                ))}
              </div>
              {mode === 'CHOISI' && (
                <input value={mdp} onChange={e => setMdp(e.target.value)} placeholder="Nouveau mot de passe (6 caractères min.)" autoFocus />
              )}
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-2.5">
                ⚠️ Dans tous les cas, l'utilisateur devra <strong>changer ce mot de passe à sa première connexion</strong>
                (nouveau ≠ mot de passe communiqué). Ses sessions en cours restent valides jusqu'à expiration.
              </p>
              <div className="flex gap-2 pt-1">
                <button onClick={onClose} className="btn-secondary flex-1">Annuler</button>
                <button onClick={lancer} disabled={loading} className="btn-primary flex-1">{loading ? '...' : 'Réinitialiser'}</button>
              </div>
            </>
          ) : (
            <>
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                <p className="text-xs text-green-700 mb-2">✅ Mot de passe réinitialisé — communiquez-le à l'utilisateur :</p>
                <p className="text-xl font-bold tracking-wider text-slate-800 font-mono select-all">{resultat}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={copier} className="btn-secondary flex-1">📋 Copier</button>
                <button onClick={onClose} className="btn-primary flex-1">Fermer</button>
              </div>
              <p className="text-[11px] text-slate-400 text-center">Un email a également été envoyé à {user.email}.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===== Gestion des PROFILS PERSONNALISÉS (Administrateur) =====
   Un profil = nom + description + PRIVILÈGES hérités d'un rôle de base ;
   le périmètre est celui du rôle de base + le pôle/ENO affecté au compte. */
function ModalProfil({ profil, onClose, onDone }) {
  const edition = !!profil;
  const [f, setF] = useState({
    nom: profil?.nom || '', description: profil?.description || '',
    base_role: profil?.base_role || 'MEMBRE_POLE', actif: profil ? profil.actif : 1,
  });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!f.nom.trim()) return toast.error('Le nom du profil est requis');
    setLoading(true);
    try {
      if (edition) await api.put(`/profils/${profil.id}`, f);
      else await api.post('/profils', f);
      toast.success(edition ? 'Profil modifié' : 'Profil créé — il apparaît maintenant dans la liste des rôles');
      onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-800">{edition ? 'Modifier le profil' : 'Nouveau profil personnalisé'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Nom du profil *</label>
            <input value={f.nom} onChange={e => setF(x => ({ ...x, nom: e.target.value }))}
              placeholder="Ex : Assistant DFE, Superviseur ENO Nord…" autoFocus />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Description</label>
            <textarea value={f.description} onChange={e => setF(x => ({ ...x, description: e.target.value }))}
              rows={2} placeholder="À quoi sert ce profil, qui le porte…" className="resize-y" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Privilèges — hérités du rôle *</label>
            <select value={f.base_role} onChange={e => setF(x => ({ ...x, base_role: e.target.value }))}>
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
            </select>
            <p className="text-xs text-slate-500 mt-1.5 bg-slate-50 border border-slate-100 rounded-xl p-2.5">
              🔐 Le profil dispose <strong>exactement des privilèges</strong> du rôle choisi (créations, validations, restrictions).
              Son <strong>périmètre</strong> (pôle, ENO) se définit sur chaque compte utilisateur lors de son affectation.
            </p>
          </div>
          {edition && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={!!f.actif} onChange={e => setF(x => ({ ...x, actif: e.target.checked ? 1 : 0 }))} className="accent-[#1e3a5f]" />
              Profil actif <span className="text-xs text-slate-400">(désactivé : les comptes rattachés ne peuvent plus se connecter)</span>
            </label>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? '...' : edition ? 'Enregistrer' : 'Créer le profil'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalUser({ poles, enos = [], profils = [], user: editUser, onClose, onSaved }) {
  const [form, setForm] = useState(editUser ? {
    nom: editUser.nom, prenom: editUser.prenom || '', email: editUser.email,
    role: editUser.role, pole_id: editUser.pole_id || '', eno_id: editUser.eno_id || '', service: editUser.service || '',
    actif: editUser.actif, password: ''
  } : { nom: '', prenom: '', email: '', role: 'MEMBRE_POLE', pole_id: '', eno_id: '', service: '', password: '' });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      if (editUser) {
        await api.put(`/users/${editUser.id}`, form);
        toast.success('Utilisateur mis à jour');
      } else {
        const r = await api.post('/users', form);
        toast.success(`Compte créé — MP temporaire : ${r.data.tmp_password}`, { duration: 8000 });
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-800">{editUser ? 'Modifier' : 'Nouvel'} utilisateur</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Prénom</label>
              <input type="text" value={form.prenom} onChange={e => setForm(f => ({ ...f, prenom: e.target.value }))} />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Nom *</label>
              <input type="text" value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} required />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Email *</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">
              {editUser ? 'Nouveau mot de passe (laissez vide pour ne pas changer)' : 'Mot de passe (laissez vide pour auto)'}
            </label>
            <input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder={editUser ? 'Inchangé si vide' : 'Auto-généré si vide'} />
            {editUser && form.password && (
              <p className="text-xs text-amber-600 mt-1">⚠️ Ce mot de passe remplacera l'actuel et sera définitif.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Rôle / Profil *</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} required>
                <optgroup label="Rôles standards">
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </optgroup>
                {profils.filter(p => p.actif).length > 0 && (
                  <optgroup label="Profils personnalisés">
                    {profils.filter(p => p.actif).map(p => (
                      <option key={p.code} value={p.code}>{p.nom} (privilèges : {p.base_role_label || p.base_role})</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Pôle</label>
              <select value={form.pole_id} onChange={e => setForm(f => ({ ...f, pole_id: e.target.value }))}>
                <option value="">Aucun</option>
                {poles.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
            </div>
          </div>
          {/* Périmètre ENO : requis quand le rôle (ou le rôle de base du profil) est Chargé de scolarité */}
          {(form.role === 'CHARGE_SCOLARITE' || profils.find(p => p.code === form.role)?.base_role === 'CHARGE_SCOLARITE') && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">ENO rattaché (périmètre) *</label>
              <select value={form.eno_id} onChange={e => setForm(f => ({ ...f, eno_id: e.target.value }))} required>
                <option value="">Choisir un ENO...</option>
                {enos.map(e => <option key={e.id} value={e.id}>ENO {e.nom}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Service</label>
            <input type="text" value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} placeholder="Ex: Service Scolarité" />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Sauvegarde...' : (editUser ? 'Mettre à jour' : 'Créer le compte')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Utilisateurs() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [poles, setPoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'new' | user_object

  const [enos, setEnos] = useState([]);
  const [profils, setProfils] = useState([]);
  const [profilModal, setProfilModal] = useState(null); // null | 'new' | profil
  const estAdmin = me?.role === 'ADMIN_PORTAIL';
  function load() {
    setLoading(true);
    Promise.all([
      api.get('/users'), api.get('/poles'),
      api.get('/statistiques/eno').catch(() => ({ data: [] })),
      api.get('/profils').catch(() => ({ data: [] })),
    ])
      .then(([u, p, e, pr]) => { setUsers(u.data); setPoles(p.data); setEnos(e.data); setProfils(pr.data); })
      .finally(() => setLoading(false));
  }

  async function supprimerProfil(p) {
    if (!confirm(`Supprimer le profil « ${p.nom} » ?`)) return;
    try {
      await api.delete(`/profils/${p.id}`);
      toast.success('Profil supprimé');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  useEffect(load, []);

  const [resetModal, setResetModal] = useState(null); // utilisateur ciblé par la réinitialisation
  function resetPassword(u) { setResetModal(u); }

  async function debloquer(u) {
    if (!confirm(`Débloquer le compte de ${u.prenom} ${u.nom} ?\n(Il avait été bloqué après 3 tentatives de connexion échouées.)`)) return;
    try {
      await api.post(`/users/${u.id}/debloquer`);
      toast.success('Compte débloqué — l\'utilisateur peut se reconnecter');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  async function toggleActif(u) {
    if (!confirm(`${u.actif ? 'Désactiver' : 'Réactiver'} ${u.prenom} ${u.nom} ?`)) return;
    if (u.actif) {
      await api.delete(`/users/${u.id}`);
    } else {
      await api.put(`/users/${u.id}`, { ...u, actif: 1 });
    }
    toast.success('Utilisateur mis à jour');
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Utilisateurs</h1>
          <p className="text-slate-500 text-sm">{users.length} compte(s)</p>
        </div>
        <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Créer un compte
        </button>
      </div>

      {/* PROFILS PERSONNALISÉS : créés par l'administrateur, privilèges hérités d'un rôle de base */}
      {estAdmin && (
        <div className="card">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h2 className="font-semibold text-slate-800">🎭 Profils personnalisés</h2>
            <span className="text-xs text-slate-400">({profils.length})</span>
            <button onClick={() => setProfilModal('new')} className="ml-auto text-sm font-semibold text-blue-700 border border-blue-200 bg-white rounded-lg px-2.5 py-1 hover:bg-blue-50 flex items-center gap-1">
              <Plus size={13} /> Nouveau profil
            </button>
          </div>
          {profils.length === 0 ? (
            <p className="text-xs text-slate-400 italic">
              Aucun profil personnalisé. Créez-en un pour définir un intitulé propre (ex : « Assistant DFE ») avec les privilèges d'un rôle existant —
              le périmètre (pôle / ENO) se définit ensuite sur chaque compte.
            </p>
          ) : (
            <div className="space-y-1.5">
              {profils.map(p => (
                <div key={p.id} className={`flex items-center gap-3 flex-wrap bg-slate-50 rounded-xl px-3 py-2 text-sm ${!p.actif ? 'opacity-50' : ''}`}>
                  <span className="badge bg-cyan-100 text-cyan-800 font-bold">{p.nom}</span>
                  <span className="text-xs text-slate-500">privilèges : <strong>{p.base_role_label || p.base_role}</strong></span>
                  {p.description && <span className="text-xs text-slate-400 truncate max-w-72" title={p.description}>· {p.description}</span>}
                  <span className="text-xs text-slate-400">· {p.nb_utilisateurs} compte(s)</span>
                  {!p.actif && <span className="badge bg-slate-200 text-slate-500 text-[10px]">Inactif</span>}
                  <span className="ml-auto flex items-center gap-1">
                    <button onClick={() => setProfilModal(p)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Modifier"><Edit size={14} /></button>
                    <button onClick={() => supprimerProfil(p)} className="p-1.5 text-red-400 hover:bg-red-50 rounded" title="Supprimer (impossible si des comptes l'utilisent)">🗑</button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 table-header">Nom</th>
              <th className="text-left px-4 py-3 table-header">Email</th>
              <th className="text-left px-4 py-3 table-header">Rôle</th>
              <th className="text-left px-4 py-3 table-header">Pôle</th>
              <th className="text-left px-4 py-3 table-header">Statut</th>
              <th className="text-right px-4 py-3 table-header">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(u => (
              <tr key={u.id} className={`hover:bg-slate-50 ${!u.actif ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
                      {u.prenom?.[0]}{u.nom?.[0]}
                    </div>
                    <span className="font-medium text-slate-800">{u.prenom} {u.nom}</span>
                    {u.must_change_password === 1 && (
                      <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">MP à changer</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${ROLE_COLORS[u.role] || 'bg-cyan-100 text-cyan-800'}`}>{u.role_label || ROLE_LABELS[u.role] || u.role}</span>
                </td>
                <td className="px-4 py-3 text-slate-500">{u.pole_nom || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${u.actif ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {u.actif ? 'Actif' : 'Inactif'}
                  </span>
                  {u.bloque === 1 && (
                    <span className="badge bg-red-100 text-red-700 ml-1" title="Bloqué après 3 tentatives de connexion échouées">🔒 Bloqué</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => setModal(u)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Modifier">
                      <Edit size={15} />
                    </button>
                    <button onClick={() => resetPassword(u)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded" title="Réinitialiser MP">
                      <RefreshCw size={15} />
                    </button>
                    {u.bloque === 1 && (
                      <button onClick={() => debloquer(u)} className="p-1.5 text-green-600 hover:bg-green-50 rounded font-bold" title="Débloquer le compte (3 tentatives échouées)">
                        🔓
                      </button>
                    )}
                    {u.id !== me?.id && (
                      <button onClick={() => toggleActif(u)} className={`p-1.5 rounded ${u.actif ? 'text-red-500 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`} title={u.actif ? 'Désactiver' : 'Réactiver'}>
                        {u.actif ? <UserX size={15} /> : <UserCheck size={15} />}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {profilModal && (
        <ModalProfil profil={profilModal === 'new' ? null : profilModal}
          onClose={() => setProfilModal(null)} onDone={() => { setProfilModal(null); load(); }} />
      )}

      {resetModal && (
        <ModalResetPassword user={resetModal} onClose={() => setResetModal(null)} onDone={load} />
      )}

      {modal && (
        <ModalUser
          poles={poles}
          enos={enos}
          profils={profils}
          user={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
