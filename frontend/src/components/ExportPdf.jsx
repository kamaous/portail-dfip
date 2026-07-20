import { useState } from 'react';
import { FileDown } from 'lucide-react';
import PlageDates from './PlageDates';

/* Bouton « Export PDF » : choisit une période puis ouvre le rapport imprimable
   (/rapport) — l'impression navigateur produit le PDF avec données + graphiques. */
export default function BoutonExportPdf() {
  const [open, setOpen] = useState(false);
  const [plage, setPlage] = useState({ debut: '', fin: '' });

  function generer() {
    window.open(`/rapport?du=${plage.debut}&au=${plage.fin}`, '_blank');
    setOpen(false);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary flex items-center gap-2">
        <FileDown size={15} /> Export PDF
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto nav-scroll">
            <div className="flex items-center justify-between p-5 border-b">
              <h2 className="font-semibold text-slate-800">📄 Export PDF — période du rapport</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-500">
                Sélectionnez la période : le rapport regroupe toutes les données (tutorat, évaluations,
                incidents, délibérations) avec graphiques, prêt à être <strong>enregistré en PDF</strong> via l'impression.
              </p>
              <PlageDates debut={plage.debut} fin={plage.fin} onChange={setPlage} />
              <div className="flex gap-2">
                <button onClick={() => setOpen(false)} className="btn-secondary flex-1">Annuler</button>
                <button onClick={generer} disabled={!plage.debut || !plage.fin} className="btn-primary flex-1 disabled:opacity-40">
                  Générer le rapport
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
