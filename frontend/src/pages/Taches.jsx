import { useEffect, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, CheckCircle, Clock, AlertCircle, MessageSquare, Trash2, ChevronDown } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useAuth } from '../context/AuthContext';

const STATUT_STYLES = {
  OUVERTE: 'bg-blue-100 text-blue-700',
  EN_COURS: 'bg-amber-100 text-amber-700',
  COMPLETEE: 'bg-green-100 text-green-700',
  ANNULEE: 'bg-slate-100 text-slate-500',
};
const PRIORITE_STYLES = {
  HAUTE: 'bg-red-100 text-red-700',
  NORMALE: 'bg-slate-100 text-slate-600',
  BASSE: 'bg-green-100 text-green-700',
};

function ModalTache({ users, onClose, onCreated }) {
  const { user } = useAuth();
  const [form, setForm] = useState({ titre: '', description: '', priorite: 'NORMALE', assigne_a: '', date_echeance: '' });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/taches', form);
      toast.success('Tâche créée et notifiée');
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-slate-800">Nouvelle tâche</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Titre *</label>
            <input type="text" value={form.titre} onChange={e => setForm(f => ({ ...f, titre: e.target.value }))} required />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Assigné à *</label>
              <select value={form.assigne_a} onChange={e => setForm(f => ({ ...f, assigne_a: e.target.value }))} required>
                <option value="">Choisir...</option>
                {users.filter(u => u.id !== user.id).map(u => (
                  <option key={u.id} value={u.id}>{u.prenom} {u.nom} ({u.role})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Priorité</label>
              <select value={form.priorite} onChange={e => setForm(f => ({ ...f, priorite: e.target.value }))}>
                <option value="BASSE">Basse</option>
                <option value="NORMALE">Normale</option>
                <option value="HAUTE">Haute</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Date d'échéance</label>
            <input type="date" value={form.date_echeance} onChange={e => setForm(f => ({ ...f, date_echeance: e.target.value }))} />
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Création...' : 'Créer et notifier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TacheCard({ tache, onRefresh, currentUserId }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState(null);
  const [comment, setComment] = useState('');
  const isAssigne = tache.assigne_a === currentUserId;

  async function loadDetail() {
    if (detail) { setExpanded(v => !v); return; }
    const r = await api.get(`/taches/${tache.id}`);
    setDetail(r.data);
    setExpanded(true);
  }

  async function changerStatut(statut) {
    try {
      await api.put(`/taches/${tache.id}/statut`, { statut });
      toast.success('Statut mis à jour');
      onRefresh();
    } catch { toast.error('Erreur'); }
  }

  async function ajouterComment() {
    if (!comment.trim()) return;
    await api.post(`/taches/${tache.id}/commentaires`, { contenu: comment });
    setComment('');
    const r = await api.get(`/taches/${tache.id}`);
    setDetail(r.data);
    toast.success('Commentaire ajouté');
  }

  async function supprimer() {
    if (!confirm('Supprimer cette tâche ?')) return;
    await api.delete(`/taches/${tache.id}`);
    toast.success('Tâche supprimée');
    onRefresh();
  }

  return (
    <div className="card hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`badge ${STATUT_STYLES[tache.statut]}`}>{tache.statut}</span>
            <span className={`badge ${PRIORITE_STYLES[tache.priorite]}`}>{tache.priorite}</span>
          </div>
          <h3 className="font-medium text-slate-800">{tache.titre}</h3>
          {tache.description && <p className="text-sm text-slate-500 mt-1 line-clamp-2">{tache.description}</p>}
          <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
            <span>De : {tache.assigne_par_prenom} {tache.assigne_par_nom}</span>
            <span>À : {tache.assigne_a_prenom} {tache.assigne_a_nom}</span>
            {tache.date_echeance && <span className="text-red-500">📅 {format(new Date(tache.date_echeance), 'dd/MM/yyyy')}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isAssigne && tache.statut !== 'COMPLETEE' && (
            <button onClick={() => changerStatut('COMPLETEE')} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title="Marquer comme complétée">
              <CheckCircle size={16} />
            </button>
          )}
          {isAssigne && tache.statut === 'OUVERTE' && (
            <button onClick={() => changerStatut('EN_COURS')} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg" title="Mettre en cours">
              <Clock size={16} />
            </button>
          )}
          <button onClick={loadDetail} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg">
            <MessageSquare size={16} />
          </button>
          <button onClick={supprimer} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
            <Trash2 size={16} />
          </button>
          <button onClick={loadDetail} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg">
            <ChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {expanded && detail && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Commentaires ({detail.commentaires?.length || 0})</h4>
          <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
            {detail.commentaires?.map(c => (
              <div key={c.id} className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-700">{c.prenom} {c.nom}</p>
                <p className="text-sm text-slate-600 mt-0.5">{c.contenu}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: fr })}
                </p>
              </div>
            ))}
            {!detail.commentaires?.length && <p className="text-xs text-slate-400">Aucun commentaire</p>}
          </div>
          <div className="flex gap-2">
            <input type="text" value={comment} onChange={e => setComment(e.target.value)} placeholder="Ajouter un commentaire..." className="flex-1" onKeyDown={e => e.key === 'Enter' && ajouterComment()} />
            <button onClick={ajouterComment} className="btn-primary px-3">Envoyer</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Taches() {
  const { user } = useAuth();
  const [taches, setTaches] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('toutes');
  const [modal, setModal] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      api.get(`/taches?mode=${mode}`),
      api.get('/users')
    ]).then(([t, u]) => {
      setTaches(t.data);
      setUsers(u.data);
    }).finally(() => setLoading(false));
  }

  useEffect(load, [mode]);

  const tabs = [
    { key: 'toutes', label: 'Toutes' },
    { key: 'recues', label: 'Reçues' },
    { key: 'assignees', label: 'Assignées' },
  ];

  const filtrees = mode === 'toutes'
    ? taches
    : mode === 'recues'
    ? taches.filter(t => t.assigne_a === user.id)
    : taches.filter(t => t.assigne_par === user.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Tâches</h1>
          <p className="text-slate-500 text-sm">{filtrees.length} tâche(s)</p>
        </div>
        <button onClick={() => setModal(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Nouvelle tâche
        </button>
      </div>

      <div className="flex gap-1 bg-white rounded-xl p-1 w-fit border border-slate-200">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setMode(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${mode === t.key ? 'bg-[#1e3a5f] text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {filtrees.length === 0 && (
            <div className="card text-center py-12 text-slate-400">
              <CheckCircle size={40} className="mx-auto mb-2 opacity-30" />
              <p>Aucune tâche trouvée</p>
            </div>
          )}
          {filtrees.map(t => (
            <TacheCard key={t.id} tache={t} onRefresh={load} currentUserId={user.id} />
          ))}
        </div>
      )}

      {modal && <ModalTache users={users} onClose={() => setModal(false)} onCreated={load} />}
    </div>
  );
}
