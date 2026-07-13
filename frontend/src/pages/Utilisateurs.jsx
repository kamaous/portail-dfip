import { useEffect, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, RefreshCw, UserX, UserCheck, Edit } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ROLES = ['RECTEUR', 'VICE_RECTEUR', 'DIRECTEUR', 'DIRECTEUR_DES', 'CHEF_SERVICE', 'CHEF_DIV_TECHNOPEDAGOGIE', 'CHEF_DIV_EVALUATION', 'RESPONSABLE_POLE', 'RESPONSABLE_PEDAGOGIQUE', 'RESPONSABLE_FORMATION', 'MEMBRE_POLE', 'SCOLARITE', 'ENSEIGNANT', 'ETUDIANT', 'ADMIN_PORTAIL'];
const ROLE_LABELS = {
  RECTEUR: 'Recteur', VICE_RECTEUR: 'Vice-Recteur Pédagogie', DIRECTEUR: 'Directeur DFIP',
  DIRECTEUR_DES: 'Directeur des Études et de la Scolarité (DES)',
  CHEF_SERVICE: 'Chef de Service', CHEF_DIV_TECHNOPEDAGOGIE: 'Chef div. Technopédagogie',
  CHEF_DIV_EVALUATION: 'Chef division DFE (Formation & Évaluations)', RESPONSABLE_POLE: 'Directeur de Pôle',
  RESPONSABLE_PEDAGOGIQUE: 'Responsable pédagogique du Pôle',
  RESPONSABLE_FORMATION: 'Responsable de Formation', MEMBRE_POLE: 'Membre de Pôle',
  SCOLARITE: 'Scolarité', ENSEIGNANT: 'Enseignant', ETUDIANT: 'Étudiant', ADMIN_PORTAIL: 'Admin Portail',
};
const ROLE_COLORS = {
  RECTEUR: 'bg-slate-800 text-white',
  VICE_RECTEUR: 'bg-slate-200 text-slate-800',
  DIRECTEUR: 'bg-purple-100 text-purple-800',
  DIRECTEUR_DES: 'bg-fuchsia-100 text-fuchsia-800',
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

function ModalUser({ poles, user: editUser, onClose, onSaved }) {
  const [form, setForm] = useState(editUser ? {
    nom: editUser.nom, prenom: editUser.prenom || '', email: editUser.email,
    role: editUser.role, pole_id: editUser.pole_id || '', service: editUser.service || '', actif: editUser.actif
  } : { nom: '', prenom: '', email: '', role: 'MEMBRE_POLE', pole_id: '', service: '', password: '' });
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
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required disabled={!!editUser} />
          </div>
          {!editUser && (
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Mot de passe (laissez vide pour auto)</label>
              <input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Auto-généré si vide" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Rôle *</label>
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} required>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
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

  function load() {
    setLoading(true);
    Promise.all([api.get('/users'), api.get('/poles')])
      .then(([u, p]) => { setUsers(u.data); setPoles(p.data); })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function resetPassword(u) {
    if (!confirm(`Réinitialiser le mot de passe de ${u.prenom} ${u.nom} ?`)) return;
    const r = await api.post(`/users/${u.id}/reset-password`);
    toast.success(`Nouveau MP temporaire : ${r.data.tmp_password}`, { duration: 10000 });
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
                  <span className={`badge ${ROLE_COLORS[u.role]}`}>{ROLE_LABELS[u.role] || u.role}</span>
                </td>
                <td className="px-4 py-3 text-slate-500">{u.pole_nom || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`badge ${u.actif ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {u.actif ? 'Actif' : 'Inactif'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => setModal(u)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Modifier">
                      <Edit size={15} />
                    </button>
                    <button onClick={() => resetPassword(u)} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded" title="Réinitialiser MP">
                      <RefreshCw size={15} />
                    </button>
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

      {modal && (
        <ModalUser
          poles={poles}
          user={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
