import { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import toast from 'react-hot-toast';
import { BarChart3, Building2, Users, FlaskConical, Plus, Trash2, RefreshCw, LayoutGrid, FileDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import PlageDates from '../components/PlageDates';

/* Module STATISTIQUES — base d'aide à la programmation des évaluations :
   ENO & capacités · effectifs par formation/ENO (fichier DES) · simulateur.
   Chaque onglet dispose de SEGMENTS (pôle, promotion, niveau...) et d'un EXPORT CSV. */

const POLE_COLOR = { SEJA: '#ea580c', STN: '#16a34a', LSHE: '#6d28d9' };
const POLE_LIGHT = { SEJA: '#fdeee3', STN: '#e8f6ec', LSHE: '#f0e9fb' };
const NIVEAUX_L = ['L1', 'L2', 'L3', 'M1', 'M2'];

/* Export CSV compatible Excel (BOM UTF-8, séparateur ;) */
function telechargerCSV(nomFichier, lignes) {
  const csv = '﻿' + lignes.map(l => l.map(c => {
    const s = String(c ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = nomFichier; a.click();
  URL.revokeObjectURL(url);
}

function BoutonExport({ onClick, label = 'Export CSV' }) {
  return (
    <button onClick={onClick} className="btn-secondary !py-1.5 !px-3 !text-xs flex items-center gap-1.5 !text-green-700 !border-green-200 hover:!bg-green-50">
      <FileDown size={13} /> {label}
    </button>
  );
}

/* Segments pôles cliquables (même style que les autres modules) */
function SegmentsPoles({ segment, setSegment, compteur }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => setSegment(null)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border-2 transition-all ${segment === null ? 'bg-slate-800 text-white border-slate-800 shadow' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
        <LayoutGrid size={13} /> Tous les pôles
      </button>
      {['SEJA', 'STN', 'LSHE'].map(p => {
        const actif = segment === p;
        return (
          <button key={p} onClick={() => setSegment(actif ? null : p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border-2 transition-all ${actif ? 'text-white shadow scale-105' : 'bg-white hover:scale-[1.02]'}`}
            style={actif ? { background: POLE_COLOR[p], borderColor: POLE_COLOR[p] } : { color: POLE_COLOR[p], borderColor: `${POLE_COLOR[p]}55` }}>
            <span className="w-2 h-2 rounded-full" style={{ background: actif ? '#fff' : POLE_COLOR[p] }} />
            {p}
            {compteur && <span className={`text-[10px] px-1.5 rounded-full font-bold ${actif ? 'bg-white/25' : 'bg-slate-100 text-slate-500'}`}>{compteur(p)}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Filtre({ value, onChange, children }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={`!w-auto !py-1.5 !text-xs ${value ? '!border-blue-400 !bg-blue-50 font-semibold' : ''}`}>
      {children}
    </select>
  );
}

function Barres({ titre, data, suffixe = '', action }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">{titre}</h3>
        {action}
      </div>
      <div className="space-y-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-28 shrink-0 text-slate-600 truncate" title={d.label}>{d.label}</span>
            <div className="flex-1 h-3.5 bg-slate-100 rounded overflow-hidden">
              <div className="h-full rounded transition-all" style={{ width: `${(d.value / max) * 100}%`, background: d.color || '#1e3a5f' }} />
            </div>
            <span className="w-14 text-right font-bold text-slate-700 tabular-nums">{d.value.toLocaleString('fr-FR')}{suffixe}</span>
          </div>
        ))}
        {data.length === 0 && <p className="text-xs text-slate-400 italic">Aucune donnée</p>}
      </div>
    </div>
  );
}

export default function Statistiques() {
  const { user } = useAuth();
  const estGestion = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(user?.role);
  const estCharge = user?.role === 'CHARGE_SCOLARITE';

  const [onglet, setOnglet] = useState(estCharge ? 'ENO' : 'SYNTHESE');
  const [effectifs, setEffectifs] = useState([]);   // toutes les lignes (formation × ENO × promo × niveau)
  const [enos, setEnos] = useState([]);
  const [cursus, setCursus] = useState([]);
  const [poles, setPoles] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    Promise.all([
      api.get('/statistiques/effectifs').catch(() => ({ data: [] })),
      api.get('/statistiques/eno'),
      api.get('/statistiques/cursus').catch(() => ({ data: [] })),
      api.get('/poles').catch(() => ({ data: [] })),
    ]).then(([ef, e, c, p]) => {
      setEffectifs(ef.data); setEnos(e.data); setCursus(c.data); setPoles(p.data);
    }).finally(() => setLoading(false));
  }
  useEffect(load, []);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>;

  const ONGLETS = [
    !estCharge && ['SYNTHESE', BarChart3, 'Tableau de bord'],
    !estCharge && ['EFFECTIFS', Users, 'Effectifs'],
    ['ENO', Building2, 'ENO & capacités'],
    !estCharge && ['SIMULATEUR', FlaskConical, 'Simulateur'],
  ].filter(Boolean);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Statistiques & Simulateur</h1>
          <p className="text-slate-500 text-sm">Effectifs par ENO, capacités et aide à la programmation des évaluations</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2"><RefreshCw size={15} /> Actualiser</button>
      </div>

      <div className="card !p-3 flex flex-wrap gap-2">
        {ONGLETS.map(([k, Icon, label]) => (
          <button key={k} onClick={() => setOnglet(k)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border-2 transition-all ${onglet === k ? 'bg-[#1e3a5f] text-white border-[#1e3a5f] shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {onglet === 'SYNTHESE' && <Synthese effectifs={effectifs} enos={enos} />}
      {onglet === 'EFFECTIFS' && <Effectifs enos={enos} estGestion={estGestion} />}
      {onglet === 'ENO' && <GestionEno enos={enos} estGestion={estGestion} estCharge={estCharge} monEno={user?.eno_id} onChange={load} />}
      {onglet === 'SIMULATEUR' && <Simulateur cursus={cursus} />}
    </div>
  );
}

/* ===== Onglet Tableau de bord : calculé en direct, SEGMENTABLE, exportable ===== */
function Synthese({ effectifs, enos }) {
  const [segment, setSegment] = useState(null);   // pôle
  const [fPromo, setFPromo] = useState('');
  const [fNiveau, setFNiveau] = useState('');

  const promos = useMemo(() => [...new Set(effectifs.map(r => r.promotion_code))].sort().reverse(), [effectifs]);
  const rows = useMemo(() => effectifs.filter(r =>
    (!segment || r.pole_code === segment) &&
    (!fPromo || r.promotion_code === fPromo) &&
    (!fNiveau || r.niveau === fNiveau)), [effectifs, segment, fPromo, fNiveau]);

  const somme = (arr) => arr.reduce((s, r) => s + r.nombre, 0);
  const grouper = (cle) => {
    const m = new Map();
    rows.forEach(r => m.set(cle(r), (m.get(cle(r)) || 0) + r.nombre));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  const total = somme(rows);
  const parEno = grouper(r => r.eno_nom);
  const parPole = grouper(r => r.pole_code || '—');
  const parPromo = grouper(r => `${r.promotion_code} ${r.niveau}`);
  const topFormations = grouper(r => `${r.formation_code || r.formation_nom} (${r.pole_code || '—'})`).slice(0, 10);
  const capTotale = enos.reduce((s, e) => s + e.capacite_effective, 0);

  const kpi = [
    ['Étudiants', total.toLocaleString('fr-FR')],
    ['Formations', new Set(rows.map(r => r.formation_id)).size],
    ['Cursus (promo × niveau)', new Set(rows.map(r => `${r.promotion_code}|${r.niveau}|${r.formation_id}`)).size],
    ['ENO', enos.length],
    ['Capacité totale', capTotale.toLocaleString('fr-FR') + ' pl.'],
  ];

  function exporter() {
    const contexte = [segment && `Pôle ${segment}`, fPromo, fNiveau].filter(Boolean).join(' · ') || 'Toutes données';
    telechargerCSV(`statistiques_synthese_${new Date().toISOString().slice(0, 10)}.csv`, [
      [`Synthèse Statistiques — ${contexte}`],
      [],
      ['ÉTUDIANTS PAR ENO'], ['ENO', 'Étudiants', 'Capacité', 'Pression (étud./place)'],
      ...parEno.map(([eno, v]) => {
        const cap = enos.find(e => e.nom === eno)?.capacite_effective || 0;
        return [eno, v, cap, cap ? (v / cap).toFixed(1) : '—'];
      }),
      [],
      ['ÉTUDIANTS PAR PÔLE'], ['Pôle', 'Étudiants'], ...parPole,
      [],
      ['PAR PROMOTION / NIVEAU'], ['Cursus', 'Étudiants'], ...parPromo,
      [],
      ['TOP FORMATIONS'], ['Formation', 'Étudiants'], ...topFormations,
    ]);
  }

  return (
    <>
      <div className="card !p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentsPoles segment={segment} setSegment={setSegment}
            compteur={(p) => effectifs.filter(r => r.pole_code === p && (!fPromo || r.promotion_code === fPromo) && (!fNiveau || r.niveau === fNiveau)).reduce((s, r) => s + r.nombre, 0).toLocaleString('fr-FR')} />
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Filtre value={fPromo} onChange={setFPromo}>
              <option value="">Toutes promotions</option>
              {promos.map(p => <option key={p}>{p}</option>)}
            </Filtre>
            <Filtre value={fNiveau} onChange={setFNiveau}>
              <option value="">Tous niveaux</option>
              {NIVEAUX_L.map(n => <option key={n}>{n}</option>)}
            </Filtre>
            {(segment || fPromo || fNiveau) && (
              <button onClick={() => { setSegment(null); setFPromo(''); setFNiveau(''); }} className="text-xs text-blue-600 hover:underline">Réinitialiser</button>
            )}
            <BoutonExport onClick={exporter} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {kpi.map(([l, v]) => (
          <div key={l} className="card text-center py-4">
            <p className="text-2xl font-bold text-[#1e3a5f]">{v}</p>
            <p className="text-xs text-slate-500 mt-0.5">{l}</p>
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <Barres titre="Étudiants par ENO" data={parEno.map(([l, v]) => ({ label: l, value: v }))} />
        <div className="space-y-4">
          <Barres titre="Étudiants par pôle" data={parPole.map(([l, v]) => ({ label: l, value: v, color: POLE_COLOR[l] || '#1e3a5f' }))} />
          <Barres titre="Par promotion / niveau" data={parPromo.map(([l, v]) => ({ label: l, value: v }))} />
        </div>
        <Barres titre="Top 10 des formations" data={topFormations.map(([l, v]) => ({ label: l, value: v, color: POLE_COLOR[(l.match(/\((\w+)\)$/) || [])[1]] || '#1e3a5f' }))} />
        <Barres titre="Capacité des ENO (places)" data={enos.map(e => ({ label: e.nom, value: e.capacite_effective, color: '#0d9488' }))} />
      </div>
    </>
  );
}

/* ===== Onglet Effectifs : segments pôle + promo/niveau + recherche + export ===== */
function Effectifs({ enos, estGestion }) {
  const [promo, setPromo] = useState('P13');
  const [niveau, setNiveau] = useState('L1');
  const [segment, setSegment] = useState(null);
  const [recherche, setRecherche] = useState('');
  const [rows, setRows] = useState([]);
  const [promos, setPromos] = useState([]);

  useEffect(() => { api.get('/poles/promotions').then(r => setPromos(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    api.get(`/statistiques/effectifs?promotion_code=${promo}&niveau=${niveau}`).then(r => setRows(r.data)).catch(() => setRows([]));
  }, [promo, niveau]);

  const formations = useMemo(() => {
    const m = new Map();
    rows.forEach(r => m.set(r.formation_id, { id: r.formation_id, code: r.formation_code || r.formation_nom, nom: r.formation_nom, pole: r.pole_code }));
    return [...m.values()]
      .filter(f => (!segment || f.pole === segment)
        && (!recherche || `${f.code} ${f.nom}`.toLowerCase().includes(recherche.toLowerCase())))
      .sort((a, b) => (a.pole || '').localeCompare(b.pole || '') || a.code.localeCompare(b.code));
  }, [rows, segment, recherche]);
  const val = (fId, eId) => rows.find(r => r.formation_id === fId && r.eno_id === eId)?.nombre ?? '';

  async function maj(fId, eId, nombre) {
    try {
      await api.put('/statistiques/effectifs', { promotion_code: promo, niveau, formation_id: fId, eno_id: eId, nombre: Number(nombre) || 0 });
      setRows(rs => {
        const i = rs.findIndex(r => r.formation_id === fId && r.eno_id === eId);
        if (i >= 0) { const c = [...rs]; c[i] = { ...c[i], nombre: Number(nombre) || 0 }; return c; }
        return [...rs, { formation_id: fId, eno_id: eId, nombre: Number(nombre) || 0 }];
      });
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }

  function exporter() {
    telechargerCSV(`effectifs_${promo}_${niveau}${segment ? `_${segment}` : ''}.csv`, [
      [`Effectifs ${promo} ${niveau}${segment ? ` — Pôle ${segment}` : ''}`],
      ['Formation', 'Pôle', ...enos.map(e => e.nom), 'Total'],
      ...formations.map(f => {
        const vals = enos.map(e => val(f.id, e.id) || 0);
        return [f.code, f.pole || '', ...vals, vals.reduce((s, v) => s + Number(v), 0)];
      }),
      ['CAPACITÉ', '', ...enos.map(e => e.capacite_effective), enos.reduce((s, e) => s + e.capacite_effective, 0)],
    ]);
  }

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="p-4 space-y-2.5 border-b border-slate-100">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentsPoles segment={segment} setSegment={setSegment} />
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="🔎 Formation..." className="!w-36 !py-1.5 !text-xs" />
            <Filtre value={promo} onChange={setPromo}>
              {[...new Set(['P13', 'P12', 'P11', 'P10', 'P8', 'P7', ...promos.map(p => p.code)])].sort().reverse().map(p => <option key={p}>{p}</option>)}
            </Filtre>
            <Filtre value={niveau} onChange={setNiveau}>
              {NIVEAUX_L.map(n => <option key={n}>{n}</option>)}
            </Filtre>
            <BoutonExport onClick={exporter} />
          </div>
        </div>
      </div>
      <div className="overflow-x-auto nav-scroll">
        <table className="text-xs min-w-max">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left px-3 py-2 font-bold text-slate-500 sticky left-0 bg-slate-50 z-10">Formation</th>
              {enos.map(e => <th key={e.id} className="px-2 py-2 font-bold text-slate-500 whitespace-nowrap" title={`Capacité : ${e.capacite_effective}`}>{e.nom}</th>)}
              <th className="px-3 py-2 font-bold text-slate-600">Total</th>
            </tr>
          </thead>
          <tbody>
            {formations.map(f => {
              const total = rows.filter(r => r.formation_id === f.id).reduce((s, r) => s + r.nombre, 0);
              return (
                <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50/50" style={segment ? { background: `${POLE_LIGHT[f.pole]}55` } : undefined}>
                  <td className="px-3 py-1.5 font-semibold sticky left-0 bg-white z-10" style={{ color: POLE_COLOR[f.pole] || '#334155' }} title={f.nom}>
                    {f.code} <span className="text-slate-400 font-normal">({f.pole})</span>
                  </td>
                  {enos.map(e => (
                    <td key={e.id} className="px-1 py-1 text-center">
                      {estGestion ? (
                        <input type="number" min="0" defaultValue={val(f.id, e.id)} key={`${promo}-${niveau}-${f.id}-${e.id}-${val(f.id, e.id)}`}
                          onBlur={ev => { if (String(ev.target.value) !== String(val(f.id, e.id))) maj(f.id, e.id, ev.target.value); }}
                          className="!w-14 !py-0.5 !px-1 !text-xs text-center" />
                      ) : <span className="tabular-nums text-slate-600">{val(f.id, e.id) || '—'}</span>}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-center font-bold text-slate-700 tabular-nums">{total.toLocaleString('fr-FR')}</td>
                </tr>
              );
            })}
            {formations.length === 0 && <tr><td colSpan={enos.length + 2} className="px-3 py-8 text-center text-slate-400">Aucun effectif pour ces critères</td></tr>}
          </tbody>
        </table>
      </div>
      {estGestion && <p className="text-[11px] text-slate-400 px-4 py-2">✏️ Saisie réservée au Directeur DES / à l'administration — modifiez une cellule puis quittez le champ pour enregistrer.</p>}
    </div>
  );
}

/* ===== Onglet ENO & capacités : recherche + export ===== */
function GestionEno({ enos, estGestion, estCharge, monEno, onChange }) {
  const [nouveau, setNouveau] = useState('');
  const [recherche, setRecherche] = useState('');
  const visibles = enos.filter(e => !recherche || e.nom.toLowerCase().includes(recherche.toLowerCase()));

  async function ajouterEno() {
    if (!nouveau.trim()) return;
    try { await api.post('/statistiques/eno', { nom: nouveau }); toast.success('ENO ajouté'); setNouveau(''); onChange(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }
  async function majEno(e, patch) {
    try { await api.put(`/statistiques/eno/${e.id}`, patch); toast.success('Enregistré'); onChange(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }
  async function ajouterSalle(e, nom, capacite) {
    try { await api.post(`/statistiques/eno/${e.id}/salles`, { nom, capacite }); toast.success('Salle ajoutée'); onChange(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }
  function exporter() {
    telechargerCSV(`eno_capacites_${new Date().toISOString().slice(0, 10)}.csv`, [
      ['ENO', 'Capacité globale', 'Capacité effective', 'Nb salles', 'Salles (nom : places : dispo)', 'Note', 'Actif'],
      ...enos.map(e => [e.nom, e.capacite, e.capacite_effective, e.salles.length,
        e.salles.map(s => `${s.nom} : ${s.capacite} : ${s.disponible ? 'oui' : 'NON'}`).join(' | '), e.note || '', e.actif ? 'oui' : 'non']),
      ['TOTAL', '', enos.reduce((s, e) => s + e.capacite_effective, 0)],
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center gap-2 flex-wrap">
        {estGestion && (
          <>
            <input value={nouveau} onChange={e => setNouveau(e.target.value)} placeholder="Nouvel ENO (ex : FATICK)" className="flex-1 min-w-40 !py-2" />
            <button onClick={ajouterEno} className="btn-primary !py-2 flex items-center gap-1.5"><Plus size={15} /> Ajouter</button>
          </>
        )}
        <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="🔎 Rechercher un ENO..." className={`!py-2 ${estGestion ? '!w-48' : 'flex-1'}`} />
        <BoutonExport onClick={exporter} />
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {visibles.map(e => {
          const editable = estGestion || (estCharge && monEno === e.id);
          return (
            <div key={e.id} className={`card ${estCharge && monEno === e.id ? 'ring-2 ring-teal-400' : ''} ${!e.actif ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-2 mb-2">
                <Building2 size={16} className="text-[#1e3a5f]" />
                <h3 className="font-bold text-slate-800">ENO {e.nom}</h3>
                {estCharge && monEno === e.id && <span className="badge bg-teal-100 text-teal-700 text-[10px]">Mon ENO</span>}
                <span className="ml-auto text-lg font-bold text-[#1e3a5f] tabular-nums">{e.capacite_effective}</span>
                <span className="text-[10px] text-slate-400">places</span>
              </div>
              {editable ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 w-28">Capacité globale</span>
                    <input type="number" min="0" defaultValue={e.capacite} onBlur={ev => Number(ev.target.value) !== e.capacite && majEno(e, { capacite: ev.target.value })}
                      className="!w-20 !py-1 !text-xs text-center" />
                    {e.salles.length > 0 && <span className="text-[10px] text-slate-400">(remplacée par les salles)</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 w-28">Note</span>
                    <input defaultValue={e.note || ''} placeholder="Salles indisponibles, maintenance..."
                      onBlur={ev => (ev.target.value || null) !== e.note && majEno(e, { note: ev.target.value })} className="flex-1 !py-1 !text-xs" />
                  </div>
                </div>
              ) : e.note ? <p className="text-xs text-amber-600">⚠ {e.note}</p> : null}

              <div className="mt-2 pt-2 border-t border-slate-100 space-y-1">
                {e.salles.map(s => (
                  <SalleLigne key={s.id} salle={s} editable={editable} onChange={onChange} />
                ))}
                {editable && <AjoutSalle onAjouter={(nom, cap) => ajouterSalle(e, nom, cap)} />}
                {!editable && e.salles.length === 0 && <p className="text-[11px] text-slate-300 italic">Aucune salle détaillée</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SalleLigne({ salle, editable, onChange }) {
  async function maj(patch) {
    try { await api.put(`/statistiques/salles/${salle.id}`, patch); onChange(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }
  async function suppr() {
    if (!confirm(`Supprimer la salle ${salle.nom} ?`)) return;
    try { await api.delete(`/statistiques/salles/${salle.id}`); onChange(); }
    catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
  }
  return (
    <div className={`flex items-center gap-2 text-xs ${salle.disponible ? '' : 'opacity-50'}`}>
      <span className="text-slate-600 flex-1 truncate">{salle.nom}</span>
      <span className="tabular-nums font-semibold text-slate-700">{salle.capacite} pl.</span>
      {editable && (
        <>
          <button onClick={() => maj({ disponible: salle.disponible ? 0 : 1 })}
            className={`badge text-[10px] cursor-pointer ${salle.disponible ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
            title="Basculer disponible / indisponible">
            {salle.disponible ? 'Disponible' : 'Indisponible'}
          </button>
          <button onClick={suppr} className="text-red-300 hover:text-red-500"><Trash2 size={12} /></button>
        </>
      )}
      {!editable && !salle.disponible && <span className="badge bg-red-100 text-red-700 text-[10px]">Indispo.</span>}
    </div>
  );
}

function AjoutSalle({ onAjouter }) {
  const [nom, setNom] = useState('');
  const [cap, setCap] = useState('');
  return (
    <div className="flex items-center gap-1.5 pt-1">
      <input value={nom} onChange={e => setNom(e.target.value)} placeholder="Salle..." className="flex-1 !py-1 !text-xs" />
      <input type="number" min="0" value={cap} onChange={e => setCap(e.target.value)} placeholder="places" className="!w-16 !py-1 !text-xs" />
      <button onClick={() => { if (nom.trim() && cap) { onAjouter(nom.trim(), cap); setNom(''); setCap(''); } }}
        className="btn-secondary !py-1 !px-2 !text-xs"><Plus size={12} /></button>
    </div>
  );
}

/* ===== Onglet Simulateur : segments pôle/promo/niveau sur la liste + export du résultat ===== */
function Simulateur({ cursus }) {
  const [plage, setPlage] = useState({ debut: '', fin: '' });
  const [heures, setHeures] = useState({ debut: '', fin: '' });
  const [sel, setSel] = useState([]); // clés "promo|niveau|formation_id"
  const [filtre, setFiltre] = useState('');
  const [segment, setSegment] = useState(null);
  const [fPromo, setFPromo] = useState('');
  const [fNiveau, setFNiveau] = useState('');
  const [resultat, setResultat] = useState(null);
  const [loading, setLoading] = useState(false);

  const promos = useMemo(() => [...new Set(cursus.map(c => c.promotion_code))].sort().reverse(), [cursus]);
  const cle = (c) => `${c.promotion_code}|${c.niveau}|${c.formation_id}`;
  const visibles = cursus.filter(c =>
    (!segment || c.pole_code === segment) &&
    (!fPromo || c.promotion_code === fPromo) &&
    (!fNiveau || c.niveau === fNiveau) &&
    (!filtre || `${c.promotion_code} ${c.niveau} ${c.formation_code} ${c.formation_nom} ${c.pole_code}`.toLowerCase().includes(filtre.toLowerCase())));

  async function lancer() {
    setLoading(true);
    try {
      const selections = cursus.filter(c => sel.includes(cle(c)))
        .map(c => ({ promotion_code: c.promotion_code, niveau: c.niveau, formation_id: c.formation_id }));
      const r = await api.post('/statistiques/simuler', {
        selections, date_demarrage: plage.debut || undefined, date_fin_prevue: plage.fin || undefined,
        heure_debut: heures.debut || undefined, heure_fin: heures.fin || undefined,
      });
      setResultat(r.data);
    } catch (err) { toast.error(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  }

  function exporterResultat() {
    if (!resultat) return;
    const cursusSel = cursus.filter(c => sel.includes(cle(c))).map(c => `${c.formation_code || c.formation_nom} ${c.promotion_code} ${c.niveau}`).join(' + ');
    telechargerCSV(`simulation_${new Date().toISOString().slice(0, 10)}.csv`, [
      [`Simulation d'évaluations — ${cursusSel}`],
      [`Période : ${plage.debut || '—'} → ${plage.fin || '—'}`, `Créneau : ${heures.debut || 'journée'} → ${heures.fin || ''}`],
      [`Résultat : ${resultat.faisable ? 'FAISABLE' : 'IMPOSSIBLE'}`, `Total étudiants : ${resultat.total_demande}`],
      [],
      ['ENO', 'Étudiants', 'Capacité', 'Résultat', 'Places manquantes', 'Détail'],
      ...resultat.enos.map(r => [r.eno, r.demande, r.capacite_inconnue ? '?' : r.capacite,
        r.capacite_inconnue ? 'capacité inconnue' : r.ok ? 'OK' : 'DÉPASSEMENT', r.manque || '',
        r.detail.map(d => `${d.formation} (${d.cursus}${d.deja_programmee ? ' — programmée' : ''}) : ${d.nombre}`).join(' | ')]),
    ]);
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4 items-start">
      <div className="card space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">1 · Période envisagée (optionnelle — ajoute la charge des évaluations déjà programmées)</h3>
        <PlageDates compact debut={plage.debut} fin={plage.fin} onChange={setPlage} />
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">🕐 Créneau horaire</span>
          <input type="time" value={heures.debut} onChange={e => setHeures(h => ({ ...h, debut: e.target.value }))} className="!w-auto !py-1 !text-xs" />
          <span className="text-slate-400">→</span>
          <input type="time" value={heures.fin} onChange={e => setHeures(h => ({ ...h, fin: e.target.value }))} className="!w-auto !py-1 !text-xs" />
          <span className="text-slate-400">(vide = journée entière)</span>
        </div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 pt-2">2 · Cursus à évaluer simultanément ({sel.length} sélectionné(s))</h3>
        <SegmentsPoles segment={segment} setSegment={setSegment} compteur={(p) => cursus.filter(c => c.pole_code === p).length} />
        <div className="flex items-center gap-2 flex-wrap">
          <Filtre value={fPromo} onChange={setFPromo}>
            <option value="">Toutes promotions</option>
            {promos.map(p => <option key={p}>{p}</option>)}
          </Filtre>
          <Filtre value={fNiveau} onChange={setFNiveau}>
            <option value="">Tous niveaux</option>
            {NIVEAUX_L.map(n => <option key={n}>{n}</option>)}
          </Filtre>
          <input value={filtre} onChange={e => setFiltre(e.target.value)} placeholder="🔎 Formation..." className="flex-1 min-w-28 !py-1.5 !text-xs" />
        </div>
        <div className="border border-slate-200 rounded-xl max-h-64 overflow-y-auto nav-scroll divide-y divide-slate-50">
          {visibles.map(c => {
            const k = cle(c);
            return (
              <label key={k} className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-slate-50 ${sel.includes(k) ? 'bg-blue-50/70' : ''}`}>
                <input type="checkbox" checked={sel.includes(k)} onChange={() => setSel(s => s.includes(k) ? s.filter(x => x !== k) : [...s, k])}
                  className="!w-3.5 !h-3.5 accent-[#1e3a5f]" />
                <span className="font-semibold" style={{ color: POLE_COLOR[c.pole_code] || '#334155' }}>{c.formation_code || c.formation_nom}</span>
                <span className="text-slate-500">{c.promotion_code} {c.niveau}</span>
                <span className="ml-auto text-slate-400 tabular-nums">{c.total.toLocaleString('fr-FR')} étud.</span>
              </label>
            );
          })}
          {visibles.length === 0 && <p className="px-3 py-4 text-xs text-slate-400">Aucun cursus pour ces critères</p>}
        </div>
        <button onClick={lancer} disabled={sel.length === 0 || loading} className="btn-primary w-full disabled:opacity-40">
          {loading ? 'Calcul...' : '🧮 Simuler'}
        </button>
      </div>

      <div className="space-y-3">
        {!resultat ? (
          <div className="card py-16 text-center text-slate-400">
            <FlaskConical size={36} className="mx-auto mb-2 opacity-30" />
            Sélectionnez des cursus puis lancez la simulation
          </div>
        ) : (
          <>
            <div className={`card border-2 ${resultat.faisable ? '!border-green-300 bg-green-50/50' : '!border-red-300 bg-red-50/50'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-lg">{resultat.faisable ? '✔ Programmation FAISABLE' : '❌ Programmation IMPOSSIBLE en l\'état'}</p>
                  <p className="text-xs text-slate-600 mt-1">
                    {resultat.total_demande.toLocaleString('fr-FR')} étudiants concernés
                    {resultat.satures.length > 0 && <> · ENO saturés : <strong>{resultat.satures.map(s => `${s.eno} (+${s.manque})`).join(', ')}</strong></>}
                    {resultat.capacites_inconnues.length > 0 && <> · ⚠ capacité non renseignée : {resultat.capacites_inconnues.join(', ')}</>}
                  </p>
                </div>
                <BoutonExport onClick={exporterResultat} />
              </div>
            </div>
            <div className="card !p-0 overflow-x-auto nav-scroll">
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-50 border-b border-slate-200 text-left">
                  {['ENO', 'Étudiants', 'Capacité', 'Résultat'].map(h => <th key={h} className="px-3 py-2 font-bold text-slate-500">{h}</th>)}
                </tr></thead>
                <tbody>
                  {resultat.enos.map(r => (
                    <tr key={r.eno_id} className={`border-b border-slate-50 ${r.ok === false ? 'bg-red-50/60' : ''}`}
                      title={r.detail.map(d => `${d.formation} (${d.cursus}${d.deja_programmee ? ' — déjà programmée' : ''}) : ${d.nombre}`).join('\n')}>
                      <td className="px-3 py-1.5 font-semibold text-slate-700">{r.eno}{r.note ? ' ⚠' : ''}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.demande.toLocaleString('fr-FR')}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.capacite_inconnue ? '?' : r.capacite.toLocaleString('fr-FR')}</td>
                      <td className="px-3 py-1.5">
                        {r.capacite_inconnue ? <span className="badge bg-slate-100 text-slate-500 text-[10px]">capacité ?</span>
                          : r.ok ? <span className="text-green-600 font-bold">✔</span>
                          : <span className="badge bg-red-600 text-white text-[10px]">❌ −{r.manque}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {resultat.suggestions.length > 0 && (
              <div className="card bg-amber-50/60 border-amber-200">
                <h3 className="text-xs font-bold uppercase tracking-wide text-amber-700 mb-2">💡 Suggestions</h3>
                <ul className="text-xs text-amber-800 space-y-1 list-disc pl-4">
                  {resultat.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
