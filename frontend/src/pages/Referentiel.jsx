import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { ChevronDown, ChevronRight, Plus, Trash2, Eye, GraduationCap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/* ===== RÉFÉRENTIEL (pôles · formations · promotions) =====
   - AJOUT : Directeur DES uniquement (pôles, formations, promotions)
   - ÉDITION : Directeur DES / Direction / Admin (clic sur une puce)
   - SUPPRESSION : demande transmise au VICE-RECTEUR qui valide ou rejette */

const POLE_COLOR = {
  SEJA: { color: '#ea580c', light: '#fff7ed' },
  STN: { color: '#16a34a', light: '#f0fdf4' },
  LSHE: { color: '#6d28d9', light: '#f5f3ff' },
};
const TYPE_LBL = { POLE: 'Pôle', FORMATION: 'Formation', PROMOTION: 'Promotion', ENO: 'ENO' };

export default function Referentiel() {
  const { user } = useAuth();
  const estDES = user?.role_reel === 'DIRECTEUR_DES';
  const peutEditer = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role); // DES inclus via alias
  const estVR = user?.role === 'VICE_RECTEUR';

  const [poles, setPoles] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [demandes, setDemandes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalFormation, setModalFormation] = useState(null); // { pole, formation? }
  const [modalPole, setModalPole] = useState(null);           // { pole? } — création/édition

  function load() {
    setLoading(true);
    Promise.all([
      api.get('/poles').catch(() => ({ data: [] })),
      api.get('/poles/promotions').catch(() => ({ data: [] })),
      api.get('/referentiel/suppressions').catch(() => ({ data: [] })),
    ]).then(([p, pr, d]) => { setPoles(p.data); setPromotions(pr.data); setDemandes(d.data); })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  const enAttente = useMemo(() => demandes.filter(d => d.statut === 'EN_ATTENTE'), [demandes]);
  const enAttenteRef = (type, id) => enAttente.some(d => d.type === type && d.ref_id === id);

  async function demanderSuppr(url, libelle) {
    if (!window.confirm(`Demander la suppression de « ${libelle} » ?\nLa suppression ne sera effective qu'après validation du Vice-Recteur.`)) return;
    try {
      const r = await api.delete(url);
      toast.success(r.data?.message || 'Demande transmise au Vice-Recteur');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  async function decider(dem, decision) {
    try {
      const r = await api.post(`/referentiel/suppressions/${dem.id}/decider`, { decision });
      toast.success(r.data?.message || 'Décision enregistrée');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur', { duration: 6000 }); }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Référentiel</h1>
          <p className="text-slate-500 text-sm">
            Pôles, formations et promotions — ajout par le Directeur DES · toute suppression est validée par le Vice-Recteur
          </p>
        </div>
        {estDES && (
          <button onClick={() => setModalPole({})} className="btn-primary flex items-center gap-2"><Plus size={15} /> Pôle</button>
        )}
      </div>

      {/* Demandes de suppression (validation Vice-Recteur) */}
      {demandes.length > 0 && (
        <div className={`card ${enAttente.length > 0 ? 'border-2 border-amber-200 bg-amber-50/60' : ''}`}>
          <h2 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
            🛡 Suppressions {enAttente.length > 0 ? `en attente du Vice-Recteur (${enAttente.length})` : '— historique'}
          </h2>
          <div className="space-y-1.5">
            {demandes.slice(0, enAttente.length > 0 ? 12 : 5).map(d => (
              <div key={d.id} className="bg-white rounded-xl px-3 py-2 flex items-center gap-3 flex-wrap text-sm">
                <span className={`badge shrink-0 ${d.statut === 'EN_ATTENTE' ? 'bg-amber-100 text-amber-700' : d.statut === 'VALIDEE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {TYPE_LBL[d.type]}
                </span>
                <span className="font-semibold text-slate-700">{d.libelle}</span>
                <span className="text-xs text-slate-400">
                  demandé par {d.demandeur_prenom} {d.demandeur_nom} · {(d.created_at || '').slice(0, 10)}
                  {d.statut !== 'EN_ATTENTE' && ` — ${d.statut === 'VALIDEE' ? 'validée' : 'rejetée'}${d.decideur_nom ? ` par ${d.decideur_prenom} ${d.decideur_nom}` : ''}`}
                </span>
                <span className="ml-auto shrink-0">
                  {d.statut === 'EN_ATTENTE' && (estVR ? (
                    <span className="flex gap-2">
                      <button onClick={() => decider(d, 'VALIDER')} className="btn-primary !py-1 !px-3 text-xs !bg-green-600 hover:!bg-green-700">✓ Valider</button>
                      <button onClick={() => decider(d, 'REJETER')} className="btn-secondary !py-1 !px-3 text-xs !text-red-600 !border-red-200 hover:!bg-red-50">✕ Rejeter</button>
                    </span>
                  ) : <span className="badge bg-amber-100 text-amber-700">En attente</span>)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Promotions */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <GraduationCap size={16} className="text-[#1e3a5f]" />
          <h2 className="font-semibold text-slate-800">Promotions</h2>
          <span className="text-xs text-slate-400">({promotions.length})</span>
          {estDES && <AjoutPromotion onDone={load} />}
        </div>
        <div className="flex flex-wrap gap-2">
          {promotions.map(p => (
            <span key={p.id} className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 pl-3 pr-1.5 py-1 text-sm ${enAttenteRef('PROMOTION', p.id) ? 'opacity-50' : ''}`}>
              <strong className="text-[#1e3a5f]">{p.code}</strong>
              {p.annee_entree && <span className="text-xs text-slate-400">({p.annee_entree})</span>}
              {enAttenteRef('PROMOTION', p.id) && <span className="text-[10px] text-amber-600">⏳</span>}
              {peutEditer && !enAttenteRef('PROMOTION', p.id) && (
                <button onClick={() => demanderSuppr(`/poles/promotions/${p.id}`, p.code)}
                  className="text-slate-300 hover:text-red-500 p-0.5" title="Demander la suppression">✕</button>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Pôles + formations */}
      {poles.map(p => (
        <SectionPole key={p.id} pole={p} estDES={estDES} peutEditer={peutEditer}
          enAttenteRef={enAttenteRef}
          onAjouterFormation={() => setModalFormation({ pole: p })}
          onEditerFormation={(f) => setModalFormation({ pole: p, formation: f })}
          onEditerPole={() => setModalPole({ pole: p })}
          onSupprimerPole={() => demanderSuppr(`/poles/${p.id}`, `${p.code}${p.nom ? ` — ${p.nom}` : ''}`)}
          onSupprimerFormation={(f) => demanderSuppr(`/poles/formations/${f.id}`, `${f.code || ''} ${f.nom}`.trim())} />
      ))}

      {modalFormation && (
        <ModalFormation ctx={modalFormation} onClose={() => setModalFormation(null)} onDone={() => { setModalFormation(null); load(); }} />
      )}
      {modalPole && (
        <ModalPole pole={modalPole.pole} onClose={() => setModalPole(null)} onDone={() => { setModalPole(null); load(); }} />
      )}
    </div>
  );
}

function SectionPole({ pole, estDES, peutEditer, enAttenteRef, onAjouterFormation, onEditerFormation, onEditerPole, onSupprimerPole, onSupprimerFormation }) {
  const [ouvert, setOuvert] = useState(true);
  const seg = POLE_COLOR[pole.code] || { color: '#1e3a5f', light: '#f8fafc' };
  const licences = (pole.formations || []).filter(f => f.cycle !== 'MASTER');
  const masters = (pole.formations || []).filter(f => f.cycle === 'MASTER');

  const Chips = ({ titre, list }) => list.length > 0 && (
    <div className="mb-2">
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
        <Eye size={12} /> {titre} ({list.length})
      </p>
      <div className="flex flex-wrap gap-2">
        {list.map(f => {
          const attente = enAttenteRef('FORMATION', f.id);
          return (
            <span key={f.id} className={`inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white pl-3 pr-1.5 py-1 text-sm shadow-sm ${attente ? 'opacity-50' : ''}`}>
              <button onClick={() => peutEditer && !attente && onEditerFormation(f)}
                className={`flex items-center gap-1.5 ${peutEditer && !attente ? 'hover:underline' : 'cursor-default'}`}
                title={peutEditer ? `${f.nom} — cliquer pour modifier` : f.nom}>
                {/* Abréviation TOUJOURS en gras avant le nom complet */}
                <strong style={{ color: seg.color }}>{f.code || '—'}</strong>
                <span className="text-slate-600 max-w-56 truncate">{f.nom}</span>
              </button>
              {attente && <span className="text-[10px] text-amber-600" title="Suppression en attente du Vice-Recteur">⏳</span>}
              {peutEditer && !attente && (
                <button onClick={() => onSupprimerFormation(f)} className="text-slate-300 hover:text-red-500 p-0.5" title="Demander la suppression">✕</button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="card" style={{ background: seg.light }}>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setOuvert(o => !o)} className="text-slate-400 hover:text-slate-600">
          {ouvert ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
        </button>
        <span className="badge text-white font-bold" style={{ background: seg.color }}>{pole.code}</span>
        <button onClick={() => peutEditer && onEditerPole()} className={`font-semibold text-slate-800 ${peutEditer ? 'hover:underline' : 'cursor-default'}`}
          title={peutEditer ? 'Cliquer pour modifier le pôle' : undefined}>
          {pole.nom || `Pôle ${pole.code}`}
        </button>
        <span className="text-xs text-slate-400">({(pole.formations || []).length} formation{(pole.formations || []).length > 1 ? 's' : ''})</span>
        <span className="ml-auto flex items-center gap-2">
          {estDES && (
            <button onClick={onAjouterFormation} className="text-sm font-semibold text-blue-700 border border-blue-200 bg-white rounded-lg px-2.5 py-1 hover:bg-blue-50 flex items-center gap-1">
              <Plus size={13} /> Formation
            </button>
          )}
          {peutEditer && (
            enAttenteRef('POLE', pole.id)
              ? <span className="text-[10px] text-amber-600" title="Suppression en attente">⏳</span>
              : <button onClick={onSupprimerPole} className="p-1.5 text-red-300 hover:text-red-500 hover:bg-red-50 rounded" title="Demander la suppression du pôle"><Trash2 size={15} /></button>
          )}
        </span>
      </div>
      {ouvert && (
        <div className="mt-3 pl-7">
          <Chips titre="Licences" list={licences} />
          <Chips titre="Masters" list={masters} />
          {(pole.formations || []).length === 0 && <p className="text-xs text-slate-400 italic">Aucune formation</p>}
        </div>
      )}
    </div>
  );
}

function AjoutPromotion({ onDone }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [annee, setAnnee] = useState('');
  async function ajouter() {
    if (!code.trim()) return;
    try {
      await api.post('/poles/promotions', { code: code.trim(), annee_entree: annee || null });
      toast.success('Promotion ajoutée'); setCode(''); setAnnee(''); setOpen(false); onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }
  return open ? (
    <span className="flex items-center gap-1.5 ml-2">
      <input value={code} onChange={e => setCode(e.target.value)} placeholder="P14" className="!w-20 !py-1 !text-xs" autoFocus />
      <input value={annee} onChange={e => setAnnee(e.target.value)} placeholder="Année (2026)" className="!w-24 !py-1 !text-xs" />
      <button onClick={ajouter} className="btn-primary !py-1 !px-2.5 text-xs">OK</button>
      <button onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-600">Annuler</button>
    </span>
  ) : (
    <button onClick={() => setOpen(true)} className="ml-2 text-sm font-semibold text-blue-700 border border-blue-200 bg-white rounded-lg px-2.5 py-1 hover:bg-blue-50 flex items-center gap-1">
      <Plus size={13} /> Promotion
    </button>
  );
}

/* Ajout / édition d'une formation : Abréviation (sigle) + Nom complet + Cycle */
function ModalFormation({ ctx, onClose, onDone }) {
  const edition = !!ctx.formation;
  const [f, setF] = useState({
    code: ctx.formation?.code || '',
    nom: ctx.formation?.nom || '',
    cycle: ctx.formation?.cycle === 'MASTER' ? 'MASTER' : 'LICENCE',
  });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!f.code.trim()) return toast.error("L'abréviation (sigle) est requise");
    if (!f.nom.trim()) return toast.error('Le nom complet est requis');
    setLoading(true);
    try {
      if (edition) await api.put(`/poles/formations/${ctx.formation.id}`, f);
      else await api.post(`/poles/${ctx.pole.id}/formations`, f);
      toast.success(edition ? 'Formation modifiée' : 'Formation ajoutée');
      onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-slate-800">{edition ? 'Modifier la formation' : `Nouvelle formation — Pôle ${ctx.pole.code}`}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Abréviation ou Sigle *</label>
            <input value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value.toUpperCase() }))} placeholder="Ex : ANG, SCE, MSRSC" autoFocus />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Nom complet *</label>
            <input value={f.nom} onChange={e => setF(x => ({ ...x, nom: e.target.value }))} placeholder="Ex : Anglais, Sciences de l'Education" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Cycle *</label>
            <select value={f.cycle} onChange={e => setF(x => ({ ...x, cycle: e.target.value }))}>
              <option value="LICENCE">Licence</option>
              <option value="MASTER">Master</option>
            </select>
          </div>
          {f.code && f.nom && (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-2.5">
              Aperçu : <strong className="text-[#1e3a5f]">{f.code}</strong> {f.nom}
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? '...' : edition ? 'Enregistrer' : 'Ajouter'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ModalPole({ pole, onClose, onDone }) {
  const edition = !!pole;
  const [f, setF] = useState({ code: pole?.code || '', nom: pole?.nom || '' });
  const [loading, setLoading] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (!f.code.trim()) return toast.error('Le code est requis');
    setLoading(true);
    try {
      if (edition) await api.put(`/poles/${pole.id}`, f);
      else await api.post('/poles', f);
      toast.success(edition ? 'Pôle modifié' : 'Pôle ajouté');
      onDone();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-slate-800">{edition ? 'Modifier le pôle' : 'Nouveau pôle'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Code *</label>
            <input value={f.code} onChange={e => setF(x => ({ ...x, code: e.target.value.toUpperCase() }))} placeholder="Ex : STN" autoFocus />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">Nom</label>
            <input value={f.nom} onChange={e => setF(x => ({ ...x, nom: e.target.value }))} placeholder="Ex : Pôle Sciences, Technologies et Numérique" />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? '...' : edition ? 'Enregistrer' : 'Ajouter'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
