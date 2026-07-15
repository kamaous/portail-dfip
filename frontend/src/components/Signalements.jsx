import { useEffect, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { Flag, CheckCircle, ChevronDown } from 'lucide-react';

/* Signalements de non-conformité :
   - BoutonSignaler : sur une fiche tutorat / évaluation (Responsable de formation)
   - PanneauSignalements : liste + traitement (Responsable pédagogique du pôle) */

export function BoutonSignaler({ cibleType, cibleId, contexte }) {
  const [open, setOpen] = useState(false);
  const [objet, setObjet] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function envoyer(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/signalements', { cible_type: cibleType, cible_id: cibleId, objet, message });
      toast.success('Signalement envoyé au Responsable pédagogique du pôle');
      setOpen(false); setObjet(''); setMessage('');
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="text-xs font-medium text-amber-700 hover:bg-amber-50 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5"
        title="Signaler une non-conformité ou une remarque au Responsable pédagogique">
        <Flag size={13} /> Signaler
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b">
              <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                <Flag size={17} className="text-amber-500" /> Signaler une non-conformité
              </h2>
              {contexte && <p className="text-xs text-slate-500 mt-1">{contexte}</p>}
            </div>
            <form onSubmit={envoyer} className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Objet *</label>
                <input value={objet} onChange={e => setObjet(e.target.value)}
                  placeholder="Ex: Dates incohérentes avec la maquette" required autoFocus />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Détail *</label>
                <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4}
                  placeholder="Décrivez précisément le point à corriger ou la remarque..." required />
              </div>
              <p className="text-xs text-slate-500 bg-slate-50 rounded-xl p-2.5">
                Le Responsable pédagogique du pôle sera notifié (portail + email) et devra traiter ce signalement.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1">Annuler</button>
                <button type="submit" disabled={loading} className="btn-primary flex-1 !bg-amber-600 hover:!bg-amber-700">
                  {loading ? '...' : 'Envoyer le signalement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export function PanneauSignalements({ cibleType, user }) {
  const [items, setItems] = useState([]);
  const [ouvert, setOuvert] = useState(true);
  const [reponses, setReponses] = useState({});

  const peutTraiter = ['RESPONSABLE_PEDAGOGIQUE', 'DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  const concerne = peutTraiter || ['RESPONSABLE_FORMATION', 'CHEF_SERVICE', 'CHEF_DIV_TECHNOPEDAGOGIE', 'CHEF_DIV_EVALUATION', 'RESPONSABLE_POLE'].includes(user?.role);

  function load() {
    if (!concerne) return;
    api.get(`/signalements?cible_type=${cibleType}`).then(r => setItems(r.data)).catch(() => {});
  }
  useEffect(load, [cibleType]);

  if (!concerne || items.length === 0) return null;
  const ouverts = items.filter(s => s.statut === 'OUVERT');

  async function traiter(id) {
    const reponse = (reponses[id] || '').trim();
    if (!reponse) return toast.error('Rédigez la réponse de traitement');
    try {
      await api.post(`/signalements/${id}/traiter`, { reponse });
      toast.success('Signalement traité — le responsable de formation est notifié');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  return (
    <div className={`card !p-0 overflow-hidden border ${ouverts.length ? '!border-amber-200' : ''}`}>
      <button onClick={() => setOuvert(o => !o)}
        className={`w-full flex items-center gap-2 px-4 py-3 text-left ${ouverts.length ? 'bg-amber-50' : 'bg-slate-50'}`}>
        <Flag size={16} className={ouverts.length ? 'text-amber-600' : 'text-slate-400'} />
        <span className="font-semibold text-sm text-slate-800">
          Signalements {peutTraiter ? 'à traiter' : ''}
        </span>
        {ouverts.length > 0 && (
          <span className="badge bg-amber-500 text-white text-[11px]">{ouverts.length} ouvert(s)</span>
        )}
        <ChevronDown size={16} className={`ml-auto text-slate-400 transition-transform ${ouvert ? 'rotate-180' : ''}`} />
      </button>
      {ouvert && (
        <div className="divide-y divide-slate-100">
          {items.map(s => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-start gap-2 flex-wrap">
                <span className={`badge shrink-0 ${s.statut === 'OUVERT' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                  {s.statut === 'OUVERT' ? 'Ouvert' : 'Traité'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">{s.objet}
                    {s.formation_nom && <span className="font-normal text-slate-400"> — {s.formation_nom}</span>}
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">{s.message}</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Par {s.signale_par_prenom} {s.signale_par_nom} · {s.pole_code || ''} · {s.created_at?.slice(0, 16)}
                  </p>
                  {s.statut === 'TRAITE' && (
                    <div className="mt-2 bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-xs text-green-800 flex items-start gap-1.5">
                      <CheckCircle size={13} className="shrink-0 mt-0.5" />
                      <span><strong>{s.traite_par_prenom} {s.traite_par_nom} :</strong> {s.reponse}</span>
                    </div>
                  )}
                  {s.statut === 'OUVERT' && peutTraiter && (
                    <div className="mt-2 flex gap-2">
                      <input value={reponses[s.id] || ''} onChange={e => setReponses(r => ({ ...r, [s.id]: e.target.value }))}
                        placeholder="Réponse / action menée..." className="!py-1.5 !text-xs flex-1" />
                      <button onClick={() => traiter(s.id)} className="btn-primary !py-1.5 text-xs shrink-0">Traiter</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
