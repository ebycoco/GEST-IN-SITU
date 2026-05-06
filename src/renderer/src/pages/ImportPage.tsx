import { useEffect, useState } from 'react';
import { 
  Upload, FileSpreadsheet, CheckCircle, 
  AlertCircle, Loader, Database, 
  ArrowRight, ShieldAlert, FileText, 
  ChevronRight, HardDrive, Zap
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';

export default function ImportPage() {
  const { user, activeSiteId } = useAuthStore();
  const [file, setFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rows: any[]; headers: string[]; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ updated: number; inserted: number } | null>(null);

  const handleSelectFile = async () => {
    try {
      const path = await window.api.import.selectFile();
      if (!path) return;
      setFile(path);
      setResult(null);
      setPreview(null);
      
      const data = await window.api.import.parseCSV(path);
      if (data.error) {
        toast.error(`Erreur de lecture: ${data.error}`);
        return;
      }
      setPreview(data);
      toast.success(`${data.total.toLocaleString('fr')} lignes détectées`);
    } catch (e) {
      toast.error('Erreur lors de la sélection du fichier');
      console.error(e);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setProgress(0);
    
    const removeListener = window.api.import.onProgress((p: number) => {
      setProgress(p);
    });
    
    try {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      if (!siteIdToUse) {
        toast.error('Aucun site sélectionné');
        setImporting(false);
        return;
      }

      await window.api.import.clearTemp(siteIdToUse);
      const res = await window.api.import.processFile(file, user?.login || 'ADMIN', preview?.total, siteIdToUse);
      setResult(res);
      toast.success(`Migration terminée !`);
    } catch (e) {
      toast.error(`Échec de l'importation`);
    } finally {
      removeListener();
      setImporting(false);
      setProgress(100);
    }
  };

  return (
    <div className="page-content custom-scrollbar">
      <div className="max-w-5xl mx-auto py-10 space-y-10">
        
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shadow-xl shadow-indigo-500/5">
              <HardDrive size={28} />
            </div>
            <h1 className="text-3xl font-black text-white tracking-tight">Migration Massive</h1>
          </div>
          <p className="text-slate-400 font-medium ml-1">
            Importez vos fichiers CSV/Excel dans le moteur Turbo-SQLite haute performance.
          </p>
        </div>

        {/* Upload Zone */}
        <div className="premium-card p-10 border-white/5 bg-white/[0.01] flex flex-col items-center gap-8 text-center group">
          <div className="relative">
            <div className="absolute inset-0 bg-indigo-500/20 blur-3xl rounded-full scale-150 opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative w-24 h-24 rounded-[2rem] bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-2xl transition-transform group-hover:scale-110">
              <Upload size={40} />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-xl font-black text-white">Sélectionnez votre source</h3>
            <p className="text-slate-400 max-w-sm mx-auto">Supporte les formats .xlsx, .xls et .csv avec détection automatique de l'encodage.</p>
          </div>

          <button className="premium-button py-4 px-10 group/btn" onClick={handleSelectFile} disabled={importing}>
            <FileSpreadsheet size={20} className="mr-3" /> 
            Choisir le fichier
            <ChevronRight size={18} className="ml-2 opacity-0 group-hover/btn:translate-x-1 group-hover/btn:opacity-100 transition-all" />
          </button>

          {file && (
            <div className="flex items-center gap-3 py-3 px-6 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 animate-slide-up">
              <FileText size={18} />
              <span className="text-sm font-black">{file.split('\\').pop()}</span>
            </div>
          )}
        </div>

        {/* Preview & Action */}
        {preview && !result && (
          <div className="premium-card overflow-hidden border-white/5 animate-slide-up">
            <div className="p-6 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <Zap size={18} />
                </div>
                <h2 className="text-lg font-black text-white">Analyse du Fichier ({preview.total.toLocaleString('fr')} lignes)</h2>
              </div>
              <button 
                className="premium-button bg-emerald-600 hover:bg-emerald-500 border-none shadow-lg shadow-emerald-600/20" 
                onClick={handleImport} 
                disabled={importing}
              >
                {importing ? <Loader size={18} className="mr-3 animate-spin" /> : <Zap size={18} className="mr-3" />}
                {importing ? 'Migration en cours...' : 'Lancer le Moteur Turbo'}
              </button>
            </div>

            <div className="p-6">
              {importing && (
                <div className="mb-10 p-8 rounded-2xl bg-white/[0.02] border border-white/10 space-y-4">
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-xs font-black text-indigo-400 uppercase tracking-widest mb-1">Status</p>
                      <p className="text-sm font-bold text-white">Traitement haute performance des paquets...</p>
                    </div>
                    <span className="text-2xl font-black text-indigo-400">{progress}%</span>
                  </div>
                  <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5">
                    <div className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-300" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-white/5">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-white/[0.03] text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      {preview.headers.slice(0, 8).map((h, i) => <th key={i} className="px-4 py-3">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {preview.rows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="text-xs text-slate-400 hover:text-white transition-colors">
                        {preview.headers.slice(0, 8).map((h, j) => {
                          const key = h.toLowerCase().replace(/\s+/g, '_');
                          return <td key={j} className="px-4 py-3 truncate max-w-[150px]">{row[key] || '—'}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Success Result */}
        {result && (
          <div className="premium-card p-10 border-emerald-500/20 bg-emerald-500/5 flex items-center gap-8 animate-slide-up">
            <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 shadow-inner">
              <CheckCircle size={40} />
            </div>
            <div className="space-y-4">
              <div>
                <h3 className="text-2xl font-black text-white">Processus Terminé !</h3>
                <p className="text-slate-400 mt-1 font-medium">L'indexation SQLite FTS5 a été mise à jour avec succès.</p>
              </div>
              <div className="flex gap-6">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Nouveaux</p>
                  <p className="text-xl font-black text-white">{result.inserted.toLocaleString('fr')}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Mis à jour</p>
                  <p className="text-xl font-black text-white">{result.updated.toLocaleString('fr')}</p>
                </div>
              </div>
              <button className="premium-button bg-white/5 border-white/5 text-slate-300" onClick={() => setResult(null)}>
                Nouvelle Migration
              </button>
            </div>
          </div>
        )}

        {/* Critical Zone */}
        {(user?.role === 'ADMINISTRATEUR' || (user?.role === 'SUPER ADMIN' && activeSiteId)) && (
          <div className="premium-card p-8 border-rose-500/10 bg-rose-500/[0.02] flex items-center justify-between gap-10">
            <div className="flex gap-6 items-center">
              <div className="p-4 rounded-2xl bg-rose-500/10 text-rose-500">
                <ShieldAlert size={32} />
              </div>
              <div className="space-y-1">
                <h4 className="text-lg font-black text-white uppercase tracking-tight">Zone de Maintenance Critique</h4>
                <p className="text-slate-500 text-sm font-medium">Purge définitive de l'inventaire des cartes pour ce site.</p>
              </div>
            </div>
            <button 
              className="px-8 py-4 bg-rose-600/10 hover:bg-rose-600 border border-rose-500/20 text-rose-500 hover:text-white font-black rounded-2xl transition-all"
              onClick={async () => {
                const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
                if (!siteIdToUse) return;
                if (confirm('Voulez-vous vraiment VIDER TOUTE LA BASE ?')) {
                  const pass = prompt('Saisissez "CONFIRMER" :');
                  if (pass === 'CONFIRMER') {
                    try {
                      await window.api.maintenance.clearDatabaseCartes(siteIdToUse);
                      toast.success('Données purgées');
                    } catch (e) { toast.error('Échec'); }
                  }
                }
              }}
            >
              VIDER LE SITE
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
