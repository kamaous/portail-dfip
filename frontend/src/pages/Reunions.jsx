import { useEffect, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Plus, Video, Trash2, XCircle, ExternalLink, Clock, Users, Copy, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const STATUT = {
  PLANIFIEE: { label: 'Planifiée', color: 'bg-blue-100 text-blue-700' },
  EN_COURS: { label: 'En cours', color: 'bg-green-100 text-green-700' },
  TERMINEE: { label: 'Terminée', color: 'bg-slate-100 text-slate-600' },
  ANNULEE: { label: 'Annulée', color: 'bg-red-100 text-red-700' },
};

/* Modal de programmation */
function ModalReunion({ users, onClose, onCreated }) {
  const [form, setForm] = useState({ titre: '', description: '', date_reunion: '', heure: '', duree_minutes: 60 });
  const [selection, setSelection] = useState([]);
  const [recherche, setRecherche] = useState('');
  const [loading, setLoading] = useState(false);

  const filtres = users.filter(u =>
    `${u.prenom} ${u.nom}`.toLowerCase().includes(recherche.toLowerCase())
  );

  const toggle = (id) => setSelection(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  async function submit(e) {
    e.preventDefault();
    if (!form.titre || !form.date_reunion || !form.heure) return toast.error('Titre, date et heure requis');
    setLoading(true);
    try {
      await api.post('/reunions', { ...form, participants: selection });
      toast.success('Réunion programmée — invitations envoyées par email');
      onCreated(); onClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <h2 className="font-semibold text-slate-800 flex items-center gap-2"><Video size={18} className="text-blue-600" /> Programmer une réunion</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Titre *</label>
            <input value={form.titre} onChange={e => setForm(f => ({ ...f, titre: e.target.value }))} placeholder="Ex: Point hebdomadaire DFE" required />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Ordre du jour..." />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Date *</label>
              <input type="date" value={form.date_reunion} onChange={e => setForm(f => ({ ...f, date_reunion: e.target.value }))} required />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Heure *</label>
              <input type="time" value={form.heure} onChange={e => setForm(f => ({ ...f, heure: e.target.value }))} required />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-700 block mb-1">Durée (min)</label>
              <input type="number" min="15" step="15" value={form.duree_minutes} onChange={e => setForm(f => ({ ...f, duree_minutes: parseInt(e.target.value) || 60 }))} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">
              Participants <span className="text-slate-400 font-normal">({selection.length} sélectionné{selection.length > 1 ? 's' : ''})</span>
            </label>
            <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="Rechercher un membre..." className="mb-2" />
            <div className="border border-slate-200 rounded-lg max-h-44 overflow-y-auto divide-y divide-slate-50">
              {filtres.map(u => (
                <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={selection.includes(u.id)} onChange={() => toggle(u.id)} className="!w-auto" />
                  <span className="text-sm text-slate-700 flex-1">{u.prenom} {u.nom}</span>
                  <span className="text-xs text-slate-400">{u.role_label || u.role}</span>
                </label>
              ))}
              {filtres.length === 0 && <p className="text-center text-slate-400 text-sm py-4">Aucun membre trouvé</p>}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Envoi...' : 'Programmer et inviter'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* Salle de réunion intégrée (TerangaMeet en iframe) */
function SalleReunion({ reunion, onClose }) {
  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#1e3a5f] shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Video size={18} className="text-white shrink-0" />
          <div className="min-w-0">
            <p className="text-white font-semibold text-sm truncate">{reunion.titre}</p>
            <p className="text-white/50 text-xs truncate">TerangaMeet — {reunion.salle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={reunion.lien} target="_blank" rel="noopener noreferrer"
            className="text-white/70 hover:text-white text-xs flex items-center gap-1 px-2 py-1.5 rounded hover:bg-white/10" title="Ouvrir dans un nouvel onglet">
            <ExternalLink size={14} /> Nouvel onglet
          </a>
          <button onClick={onClose} className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg flex items-center gap-1">
            <X size={14} /> Quitter
          </button>
        </div>
      </div>
      <iframe
        src={reunion.lien}
        title={reunion.titre}
        className="flex-1 w-full border-0"
        allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
      />
    </div>
  );
}

export default function Reunions() {
  const { user } = useAuth();
  const [reunions, setReunions] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [salle, setSalle] = useState(null);
  const [embeddable, setEmbeddable] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([api.get('/reunions'), api.get('/users')])
      .then(([r, u]) => { setReunions(r.data); setUsers(u.data); })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);
  useEffect(() => {
    api.get('/reunions/config').then(r => setEmbeddable(!!r.data.embeddable)).catch(() => {});
  }, []);

  async function changerStatut(r, statut) {
    await api.put(`/reunions/${r.id}`, { statut });
    toast.success(statut === 'ANNULEE' ? 'Réunion annulée — participants notifiés' : 'Statut mis à jour');
    load();
  }
  async function supprimer(id) {
    if (!confirm('Supprimer cette réunion ?')) return;
    await api.delete(`/reunions/${id}`);
    toast.success('Supprimée'); load();
  }
  function copierLien(lien) {
    navigator.clipboard.writeText(lien);
    toast.success('Lien copié');
  }
  function rejoindre(r) {
    if (r.statut === 'PLANIFIEE') api.put(`/reunions/${r.id}`, { statut: 'EN_COURS' }).then(load).catch(() => {});
    if (embeddable) {
      setSalle(r); // salle intégrée dans le portail
    } else {
      // TerangaMeet bloque encore l'iframe (X-Frame-Options) → nouvel onglet
      window.open(r.lien, '_blank', 'noopener');
      toast('Réunion ouverte dans un nouvel onglet', { icon: '🎥' });
    }
  }

  const peutGerer = (r) => r.organisateur_id === user?.id || ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const aVenir = reunions.filter(r => r.date_reunion >= aujourdhui && r.statut !== 'ANNULEE' && r.statut !== 'TERMINEE');
  const passees = reunions.filter(r => !aVenir.includes(r));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Réunions</h1>
          <p className="text-slate-500 text-sm">Programmez et tenez vos réunions via TerangaMeet, sans quitter le portail</p>
        </div>
        <button onClick={() => setModal(true)} className="btn-primary flex items-center gap-2">
          <Plus size={16} /> Programmer une réunion
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <Section titre={`À venir (${aVenir.length})`} vide="Aucune réunion à venir">
            {aVenir.map(r => (
              <CarteReunion key={r.id} r={r} peutGerer={peutGerer(r)} onRejoindre={rejoindre}
                onAnnuler={() => changerStatut(r, 'ANNULEE')} onTerminer={() => changerStatut(r, 'TERMINEE')}
                onSupprimer={() => supprimer(r.id)} onCopier={copierLien} />
            ))}
          </Section>
          {passees.length > 0 && (
            <Section titre={`Passées / annulées (${passees.length})`}>
              {passees.map(r => (
                <CarteReunion key={r.id} r={r} peutGerer={peutGerer(r)} passee
                  onRejoindre={rejoindre} onSupprimer={() => supprimer(r.id)} onCopier={copierLien} />
              ))}
            </Section>
          )}
        </>
      )}

      {modal && <ModalReunion users={users.filter(u => u.id !== user?.id)} onClose={() => setModal(false)} onCreated={load} />}
      {salle && <SalleReunion reunion={salle} onClose={() => { setSalle(null); load(); }} />}
    </div>
  );
}

function Section({ titre, vide, children }) {
  const items = Array.isArray(children) ? children : [children].filter(Boolean);
  return (
    <div>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">{titre}</h2>
      {items.length === 0 ? (
        <div className="card py-10 text-center text-slate-400">
          <Video size={32} className="mx-auto mb-2 opacity-30" />
          {vide}
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">{children}</div>
      )}
    </div>
  );
}

function CarteReunion({ r, peutGerer, passee, onRejoindre, onAnnuler, onTerminer, onSupprimer, onCopier }) {
  const st = STATUT[r.statut] || STATUT.PLANIFIEE;
  return (
    <div className={`card ${passee ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-800 truncate">{r.titre}</h3>
          <p className="text-xs text-slate-500">Organisée par {r.organisateur?.prenom} {r.organisateur?.nom}</p>
        </div>
        <span className={`badge ${st.color} shrink-0`}>{st.label}</span>
      </div>
      {r.description && <p className="text-sm text-slate-500 mb-3 line-clamp-2">{r.description}</p>}
      <div className="flex items-center gap-4 text-xs text-slate-500 mb-4">
        <span className="flex items-center gap-1"><Clock size={13} /> {r.date_reunion} à {r.heure} · {r.duree_minutes} min</span>
        <span className="flex items-center gap-1"><Users size={13} /> {(r.participants_detail || []).length + 1} participant(s)</span>
      </div>
      <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
        {r.statut !== 'ANNULEE' && r.statut !== 'TERMINEE' && (
          <button onClick={() => onRejoindre(r)} className="btn-primary !py-1.5 text-xs flex items-center gap-1.5 flex-1 justify-center">
            <Video size={14} /> Rejoindre
          </button>
        )}
        <button onClick={() => onCopier(r.lien)} className="p-1.5 text-slate-500 hover:bg-slate-100 rounded" title="Copier le lien">
          <Copy size={15} />
        </button>
        {peutGerer && r.statut === 'PLANIFIEE' && (
          <button onClick={onAnnuler} className="p-1.5 text-orange-500 hover:bg-orange-50 rounded" title="Annuler la réunion">
            <XCircle size={15} />
          </button>
        )}
        {peutGerer && r.statut === 'EN_COURS' && (
          <button onClick={onTerminer} className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="Marquer terminée">
            <XCircle size={15} />
          </button>
        )}
        {peutGerer && (
          <button onClick={onSupprimer} className="p-1.5 text-red-400 hover:bg-red-50 rounded" title="Supprimer">
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
