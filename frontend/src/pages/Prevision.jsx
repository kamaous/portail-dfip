import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { BookOpen, ClipboardCheck, CalendarClock, RefreshCw, Check, Pencil, X, AlertTriangle, Info, Landmark } from 'lucide-react';

/* Module PRÉVISION — anticiper les activités à partir du Planning annuel.
   Pour chaque cohorte (pôle × promotion × niveau) et chacune de ses formations,
   le serveur propose les dates de la fiche de tutorat et des évaluations
   (session normale, rattrapage) de chaque semestre. Chaque proposition peut être
   validée telle quelle ou modifiée puis validée : la création passe par les routes
   habituelles (mêmes droits, mêmes contrôles que les modules Tutorat / Évaluations). */

const POLES_SEG = {
  STN: { color: '#16a34a', light: '#e8f6ec' },
  SEJA: { color: '#ea580c', light: '#fdeee3' },
  LSHE: { color: '#6d28d9', light: '#f0e9fb' },
  DFIP: { color: '#1e3a5f', light: '#e8eef5' },
};
const ONGLETS_ORDRE = ['DFIP', 'STN', 'SEJA', 'LSHE'];
const NIVEAU_LABEL = { L1: 'LICENCE 1', L2: 'LICENCE 2', L3: 'LICENCE 3', M1: 'MASTER 1', M2: 'MASTER 2' };
const ETAPES = {
  TUTORAT: { label: 'Fiche de tutorat', court: 'Tutorat', Icon: BookOpen },
  SN: { label: 'Évaluation — session normale', court: 'Session normale', Icon: ClipboardCheck },
  SR: { label: 'Évaluation — rattrapage', court: 'Rattrapage', Icon: ClipboardCheck },
};
const STATUTS = {
  CREE: ['Créé', 'bg-green-100 text-green-700'],
  A_CREER: ['À créer', 'bg-blue-100 text-blue-700'],
  EN_RETARD: ['En retard', 'bg-red-100 text-red-700'],
};
const fmt = (d) => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—';
const nbJours = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000) + 1;

function Filtre({ value, onChange, children }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={`!w-auto !py-1.5 !text-xs ${value ? '!border-blue-400 !bg-blue-50 font-semibold' : ''}`}>
      {children}
    </select>
  );
}

/* Charge utile de création, selon l'étape */
function charge(annee, pole, cohorte, semestre, formation, etape, debut, fin) {
  const base = { annee_id: annee.id, pole_id: pole.id, promotion_id: cohorte.promotion_id, formation_id: formation.id, niveau: cohorte.niveau, semestre_code: semestre };
  return etape === 'TUTORAT'
    ? ['/tutorat', { ...base, date_debut: debut, date_fin: fin }]
    : ['/evaluations', { ...base, session_num: etape === 'SN' ? 1 : 2, type_evaluation: 'EVALUATION', date_demarrage: debut, date_fin_prevue: fin }];
}

/* Cellule d'une étape : existant, ou proposition avec Valider / Modifier */
function CelluleEtape({ e, peutCreer, onCreer }) {
  const [edition, setEdition] = useState(null); // { debut, fin }
  const [envoi, setEnvoi] = useState(false);
  if (!e) return <td className="px-3 py-2 text-slate-300">—</td>;

  if (e.statut === 'CREE') {
    return (
      <td className="px-3 py-2 align-top">
        <span className={`badge ${STATUTS.CREE[1]} text-[10px]`}>✓ Créé</span>
        <p className="text-xs text-slate-600 tabular-nums mt-1">{fmt(e.existant.debut)} → {fmt(e.existant.fin)}</p>
        {e.existant.statut_fiche === 'SOUMISE' && <p className="text-[10px] text-amber-700">⏳ fiche à valider</p>}
        {e.existant.groupes > 1 && <p className="text-[10px] text-slate-400">{e.existant.groupes} groupes</p>}
      </td>
    );
  }

  const p = e.proposition;
  async function valider(debut, fin) {
    if (!debut || !fin || fin < debut) return toast.error('Dates invalides : la fin doit suivre le début');
    setEnvoi(true);
    try { await onCreer(debut, fin); setEdition(null); }
    finally { setEnvoi(false); }
  }

  return (
    <td className="px-3 py-2 align-top">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`badge ${STATUTS[e.statut][1]} text-[10px]`}>{STATUTS[e.statut][0]}</span>
        {p.hors_plage && <span className="badge bg-amber-100 text-amber-800 text-[10px]" title="En dehors de la plage du Planning annuel">hors plage</span>}
        <span title={p.source} className="cursor-help"><Info size={12} className="text-slate-400" /></span>
      </div>
      {edition ? (
        <div className="mt-1.5 space-y-1">
          <input type="date" value={edition.debut} onChange={ev => setEdition(x => ({ ...x, debut: ev.target.value }))} className="!py-1 !text-xs !w-36" />
          <input type="date" value={edition.fin} onChange={ev => setEdition(x => ({ ...x, fin: ev.target.value }))} className="!py-1 !text-xs !w-36" />
          <div className="flex gap-1">
            <button disabled={envoi} onClick={() => valider(edition.debut, edition.fin)}
              className="flex items-center gap-1 text-[11px] font-semibold bg-[#1e3a5f] text-white rounded-md px-2 py-1 disabled:opacity-50"><Check size={12} /> Valider</button>
            <button onClick={() => setEdition(null)} className="flex items-center gap-1 text-[11px] text-slate-500 border border-slate-200 rounded-md px-2 py-1"><X size={12} /> Annuler</button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs font-semibold text-slate-800 tabular-nums mt-1">{fmt(p.debut)} → {fmt(p.fin)}
            <span className="font-normal text-slate-400"> · {e.etape === 'TUTORAT' ? `${Math.round(nbJours(p.debut, p.fin) / 7)} sem.` : `${nbJours(p.debut, p.fin)} j`}</span></p>
          {p.reception_epreuves && (
            <p className="text-[10px] text-slate-400 leading-tight">épreuves avant le {fmt(p.reception_epreuves)} · délibération vers le {fmt(p.deliberation)}</p>
          )}
          {peutCreer && (
            <div className="flex gap-1 mt-1.5">
              <button disabled={envoi} onClick={() => valider(p.debut, p.fin)}
                className="flex items-center gap-1 text-[11px] font-semibold bg-[#1e3a5f] hover:bg-[#2a4d7a] text-white rounded-md px-2 py-1 disabled:opacity-50"
                title="Créer avec les dates proposées"><Check size={12} /> Valider</button>
              <button onClick={() => setEdition({ debut: p.debut, fin: p.fin })}
                className="flex items-center gap-1 text-[11px] font-semibold text-blue-700 border border-blue-200 hover:bg-blue-50 rounded-md px-2 py-1"
                title="Modifier les dates puis valider"><Pencil size={12} /> Modifier</button>
            </div>
          )}
        </>
      )}
    </td>
  );
}

export default function Prevision() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [onglet, setOnglet] = useState('DFIP');
  const [fPromo, setFPromo] = useState('');
  const [fStatut, setFStatut] = useState('A_FAIRE'); // A_FAIRE | EN_RETARD | CREE | ''

  function load() {
    setLoading(true);
    api.get('/prevision').then(r => {
      setData(r.data);
      // Un seul pôle visible (responsable de pôle / de formation) : on l'ouvre directement
      if (r.data.poles.length === 1) setOnglet(r.data.poles[0].code);
    }).catch(err => toast.error(err.response?.data?.error || 'Chargement impossible'))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function creer(pole, cohorte, semestre, formation, etape, debut, fin, silencieux) {
    const [url, body] = charge(data.annee, pole, cohorte, semestre, formation, etape, debut, fin);
    try {
      await api.post(url, body);
      if (!silencieux) { toast.success(`${ETAPES[etape].court} ${formation.code || formation.nom} ${semestre} créé(e)`); load(); }
      return true;
    } catch (err) {
      toast.error(`${formation.code || formation.nom} ${semestre} : ${err.response?.data?.error || 'création impossible'}`, { duration: 8000 });
      return false;
    }
  }

  // Création groupée : toutes les propositions d'une étape d'un semestre (dates proposées)
  async function creerTout(pole, cohorte, sem, etape) {
    const cibles = sem.formations.map(l => ({ f: l.formation, e: l.etapes.find(x => x.etape === etape) }))
      .filter(x => x.e && x.e.statut !== 'CREE');
    if (!cibles.length) return;
    if (!confirm(`Créer ${cibles.length} ${ETAPES[etape].label.toLowerCase()} (${cohorte.promotion} ${cohorte.niveau} ${sem.semestre}) avec les dates proposées ?`)) return;
    let ok = 0;
    for (const c of cibles) if (await creer(pole, cohorte, sem.semestre, c.f, etape, c.e.proposition.debut, c.e.proposition.fin, true)) ok++;
    toast.success(`${ok} / ${cibles.length} créé(es)`);
    load();
  }

  const poles = data?.poles || [];
  const promotions = useMemo(() => [...new Set(poles.flatMap(p => p.cohortes.map(c => c.promotion)))]
    .sort((a, b) => b.localeCompare(a, 'fr', { numeric: true })), [poles]);
  const okStatut = (e) => !fStatut || (fStatut === 'A_FAIRE' ? e.statut !== 'CREE' : e.statut === fStatut);

  // Compteurs par pôle et par étape (vue DFIP)
  const compteurs = useMemo(() => poles.map(p => {
    const c = { pole: p, TUTORAT: {}, SN: {}, SR: {} };
    for (const co of p.cohortes) for (const s of co.semestres) for (const l of s.formations) for (const e of l.etapes) {
      c[e.etape][e.statut] = (c[e.etape][e.statut] || 0) + 1;
    }
    return c;
  }), [poles]);

  // Échéances des 30 prochains jours (propositions non créées), tous pôles
  const echeances = useMemo(() => {
    if (!data) return [];
    const limite = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const l = [];
    for (const p of poles) for (const co of p.cohortes) for (const s of co.semestres) for (const f of s.formations) for (const e of f.etapes) {
      if (e.statut !== 'CREE' && e.proposition.debut <= limite) l.push({ p, co, s, f, e });
    }
    return l.sort((a, b) => a.e.proposition.debut.localeCompare(b.e.proposition.debut));
  }, [data, poles]);

  if (loading && !data) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!data?.annee) return <div className="card text-slate-500">Aucune année académique active.</div>;

  const P = data.parametres;
  const pole = poles.find(p => p.code === onglet);
  const seg = POLES_SEG[onglet] || POLES_SEG.DFIP;
  const onglets = ONGLETS_ORDRE.filter(k => k === 'DFIP' ? poles.length > 1 : poles.some(p => p.code === k));

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><CalendarClock size={24} /> Prévision — anticiper les activités</h1>
          <p className="text-slate-500 text-sm max-w-3xl">
            Dates proposées pour les fiches de tutorat et les évaluations de chaque semestre, à partir du Planning annuel
            ({data.annee.libelle}) et des étapes déjà réalisées. Validez une proposition telle quelle ou modifiez-la avant de valider :
            la fiche ou l'évaluation est alors créée dans son module, avec les contrôles habituels.
          </p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Actualiser</button>
      </div>

      {/* Segments + filtres */}
      <div className="card !p-3 space-y-2.5 barre-collante">
        <div className="flex flex-wrap items-center gap-2">
          {onglets.map(k => {
            const s = POLES_SEG[k];
            const actif = onglet === k;
            return (
              <button key={k} onClick={() => setOnglet(k)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${actif ? 'text-white shadow-md scale-105' : 'bg-white hover:scale-[1.02]'}`}
                style={actif ? { background: s.color, borderColor: s.color } : { color: s.color, borderColor: `${s.color}55` }}>
                {k === 'DFIP' ? <ClipboardCheck size={15} /> : <BookOpen size={15} />} {k}
              </button>
            );
          })}
        </div>
        {onglet !== 'DFIP' && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Filtres :</span>
            <Filtre value={fPromo} onChange={setFPromo}>
              <option value="">Toutes promotions</option>
              {promotions.map(p => <option key={p} value={p}>{p}</option>)}
            </Filtre>
            <Filtre value={fStatut} onChange={setFStatut}>
              <option value="A_FAIRE">Étapes à créer</option>
              <option value="EN_RETARD">En retard seulement</option>
              <option value="CREE">Déjà créées</option>
              <option value="">Toutes les étapes</option>
            </Filtre>
          </div>
        )}
        <p className="text-[11px] text-slate-400 flex items-start gap-1.5">
          <Info size={12} className="shrink-0 mt-0.5" />
          Sans plage au planning, les dates sont estimées : tutorat de {Math.round(P.duree_tutorat / 7)} semaines, examen de {P.duree_examen} j
          (durées réelles médianes), session normale {P.ecart_tutorat_sn} j après le tutorat, rattrapage {P.ecart_sn_sr} j après la session normale.
          Les examens évitent week-ends et jours fériés.
        </p>
      </div>

      {onglet === 'DFIP' ? (
        /* ================== VUE D'ENSEMBLE ================== */
        <>
          <div className="card !p-0 overflow-clip">
            <div className="px-5 py-4 text-white" style={{ background: 'linear-gradient(135deg, #1e3a5f, #2563eb)' }}>
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">Vue d'ensemble des prévisions</p>
              <h2 className="font-bold text-lg leading-tight">Direction de la Formation et de l'Ingénierie pédagogique (DFIP)</h2>
            </div>
            <div className="defil-tableau nav-scroll">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-2.5 table-header">Pôle</th>
                    {Object.entries(ETAPES).map(([k, v]) => <th key={k} className="text-left px-4 py-2.5 table-header">{v.court}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {compteurs.map(c => (
                    <tr key={c.pole.code} className="border-b border-slate-50 hover:bg-slate-50/60 cursor-pointer" onClick={() => setOnglet(c.pole.code)}>
                      <td className="px-4 py-2.5 font-bold" style={{ color: POLES_SEG[c.pole.code]?.color }}>
                        <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: POLES_SEG[c.pole.code]?.color }} />{c.pole.code}
                        <span className="font-normal text-xs text-slate-400"> · {c.pole.cohortes.length} cohorte(s)</span>
                      </td>
                      {Object.keys(ETAPES).map(k => (
                        <td key={k} className="px-4 py-2.5 space-x-1">
                          {['A_CREER', 'EN_RETARD', 'CREE'].map(s => c[k][s] ? <span key={s} className={`badge ${STATUTS[s][1]} text-[10px]`}>{c[k][s]} {{ A_CREER: 'à créer', EN_RETARD: 'en retard', CREE: 'créé(s)' }[s]}</span> : null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <div className="card">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2"><AlertTriangle size={15} className="text-amber-500" /> Échéances des 30 prochains jours</h3>
              {echeances.length === 0 ? <p className="text-sm text-slate-400">Aucune étape à créer dans les 30 prochains jours.</p> : (
                <div className="space-y-1.5 max-h-96 overflow-y-auto nav-scroll">
                  {echeances.map(({ p, co, s, f, e }, i) => (
                    <button key={i} onClick={() => { setOnglet(p.code); setFPromo(co.promotion); }}
                      className="w-full flex items-center gap-2 text-left text-sm rounded-lg px-2 py-1.5 hover:bg-slate-50">
                      <span className="text-xs tabular-nums font-semibold text-slate-700 w-20 shrink-0">{fmt(e.proposition.debut)}</span>
                      <span className={`badge ${STATUTS[e.statut][1]} text-[10px] shrink-0`}>{ETAPES[e.etape].court}</span>
                      <span className="truncate text-slate-600">
                        <strong style={{ color: POLES_SEG[p.code]?.color }}>{p.code}</strong> · {co.promotion} {co.niveau} {s.semestre} · {f.formation.code || f.formation.nom}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="card">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-2"><Landmark size={15} className="text-slate-500" /> Calendrier institutionnel (Rectorat, DFIP & DES) — 120 jours</h3>
              {data.institutionnel.length === 0 ? <p className="text-sm text-slate-400">Aucune activité du Rectorat ou de la DFIP & DES prévue au Planning annuel dans les 120 prochains jours.</p> : (
                <div className="space-y-1.5">
                  {data.institutionnel.map(a => (
                    <div key={a.id} className="flex items-center gap-2 text-sm">
                      <span className="text-xs tabular-nums font-semibold text-slate-700 w-44 shrink-0">{fmt(a.date_debut)} → {fmt(a.date_fin)}</span>
                      <span className="badge bg-slate-100 text-slate-600 text-[10px] shrink-0">{a.segment === 'RECTORAT' ? 'Rectorat' : 'DFIP & DES'}</span>
                      <span className="truncate text-slate-700">{a.libelle} <span className="text-slate-400">· {a.ligne}</span></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : pole && (
        /* ================== ONGLET PÔLE : PROMOTION → NIVEAU → SEMESTRE ================== */
        <div className="card !p-0 overflow-clip">
          <div className="px-5 py-4 text-white" style={{ background: `linear-gradient(135deg, ${seg.color}, ${seg.color}cc)` }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/70">Prévision des activités</p>
            <h2 className="font-bold text-lg leading-tight">{pole.nom || pole.code}</h2>
            {!pole.droits.tutorat && !pole.droits.evaluation && (
              <p className="text-xs text-white/85 mt-1">Consultation seule : votre profil ne crée ni fiches de tutorat ni évaluations pour ce pôle.</p>
            )}
          </div>
          <div className="defil-tableau nav-scroll">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 table-header w-40">Programme</th>
                  {Object.entries(ETAPES).map(([k, v]) => <th key={k} className="text-left px-3 py-2.5 table-header">{v.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {pole.cohortes.filter(co => !fPromo || co.promotion === fPromo).map(co => [
                  <tr key={`p-${co.promotion}-${co.niveau}`} style={{ background: '#1e3a5f' }}>
                    <td colSpan={4} className="px-4 py-2 font-bold text-white text-sm tracking-wide">
                      🎓 PROMOTION {co.promotion} <span className="font-semibold text-blue-100">· {NIVEAU_LABEL[co.niveau] || co.niveau}</span>
                    </td>
                  </tr>,
                  ...co.semestres.flatMap(s => {
                    const lignes = s.formations.filter(l => l.etapes.some(okStatut));
                    if (!lignes.length) return [];
                    return [
                      <tr key={`s-${co.promotion}-${co.niveau}-${s.semestre}`} style={{ background: seg.light }}>
                        <td className="px-4 py-1.5 font-bold text-[13px]" style={{ color: seg.color }}>Semestre {s.semestre.replace('S', '')}</td>
                        {Object.keys(ETAPES).map(k => {
                          const pl = s.plages[k];
                          const nb = s.formations.filter(l => l.etapes.find(e => e.etape === k)?.statut !== 'CREE').length;
                          const droit = k === 'TUTORAT' ? pole.droits.tutorat : pole.droits.evaluation;
                          return (
                            <td key={k} className="px-3 py-1.5 text-[11px]" style={{ color: seg.color }}>
                              {pl ? <span title={pl.libelle}>Planning : {fmt(pl.date_debut)} → {fmt(pl.date_fin)}</span> : <span className="opacity-70">Pas de plage au planning</span>}
                              {droit && nb > 1 && (
                                <button onClick={() => creerTout(pole, co, s, k)}
                                  className="ml-2 font-semibold underline hover:no-underline">Tout valider ({nb})</button>
                              )}
                            </td>
                          );
                        })}
                      </tr>,
                      ...lignes.map(l => (
                        <tr key={`f-${co.promotion}-${co.niveau}-${s.semestre}-${l.formation.id}`} className="border-b border-slate-100 hover:bg-slate-50/60">
                          <td className="px-4 py-2 align-top">
                            <span className="font-medium text-slate-800" title={l.formation.nom}>{l.formation.code || l.formation.nom}</span>
                          </td>
                          {Object.keys(ETAPES).map(k => {
                            const e = l.etapes.find(x => x.etape === k);
                            return (
                              <CelluleEtape key={k} e={e && okStatut(e) ? e : (e?.statut === 'CREE' ? e : null)}
                                peutCreer={k === 'TUTORAT' ? pole.droits.tutorat : pole.droits.evaluation}
                                onCreer={(debut, fin) => creer(pole, co, s.semestre, l.formation, k, debut, fin)} />
                            );
                          })}
                        </tr>
                      )),
                    ];
                  }),
                ])}
                {pole.cohortes.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400">
                    Aucune cohorte pour ce pôle : les prévisions s'appuient sur les fiches et évaluations déjà saisies pour l'année.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
