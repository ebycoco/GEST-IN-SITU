import { useEffect, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader, Database } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ImportPage() {
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
    
    // Listen for progress
    const removeListener = window.api.import.onProgress((p: number) => {
      setProgress(p);
    });
    
    try {
      await window.api.import.clearTemp();
      const res = await window.api.import.processFile(file, 'SUPERADMIN', preview?.total);
      setResult(res);
      toast.success(`Importation terminée !`);
    } catch (e) {
      toast.error(`Erreur d'importation: ${String(e)}`);
    } finally {
      removeListener();
      setImporting(false);
      setProgress(100);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Database size={20} color="var(--accent-primary)" />
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Migration & Importation Massive</h2>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title"><FileSpreadsheet size={16} /> Source de données (Excel / CSV)</span>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: 40 }}>
          <div style={{ width: 80, height: 80, borderRadius: 20, background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border-color)' }}>
            <Upload size={32} color="var(--accent-primary)" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Glissez votre fichier ici ou cliquez pour parcourir</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Supporte .xlsx, .xls et .csv (séparateur virgule ou point-virgule)</p>
          </div>
          <button className="btn btn-primary" onClick={handleSelectFile} disabled={importing}>
            <FileSpreadsheet size={16} /> Choisir le fichier V1
          </button>
          {file && (
            <div style={{ padding: '8px 16px', background: 'rgba(108,99,255,0.1)', borderRadius: 8, border: '1px solid var(--accent-primary)' }}>
              <p style={{ fontSize: 13, color: 'var(--text-primary)' }}>📂 {file.split('\\').pop()}</p>
            </div>
          )}
        </div>
      </div>

      {preview && !result && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Aperçu des données ({preview.total.toLocaleString('fr')} lignes au total)</span>
            <button className="btn btn-success" onClick={handleImport} disabled={importing}>
              {importing ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={14} />}
              {importing ? 'Importation en cours...' : 'Lancer l\'importation Turbo'}
            </button>
          </div>
          <div className="card-body">
            {importing && (
              <div style={{ marginBottom: 20, padding: 20, background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Traitement haute performance...</span>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>{progress}%</span>
                </div>
                <div className="progress-bar" style={{ height: 10 }}><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Veuillez ne pas fermer l'application durant cette opération.</p>
              </div>
            )}
            
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {preview.headers.slice(0, 10).map((h, i) => <th key={i}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 10).map((row, i) => (
                    <tr key={i}>
                      {preview.headers.slice(0, 10).map((h, j) => {
                        const key = h.toLowerCase().replace(/\s+/g, '_');
                        return <td key={j}>{row[key] || '—'}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12, textAlign: 'center' }}>
              Affichage des 10 premières lignes sur {preview.total.toLocaleString('fr')}.
            </p>
          </div>
        </div>
      )}

      {result && (
        <div className="card" style={{ borderColor: 'var(--accent-green)', background: 'rgba(39,174,96,0.05)' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 30 }}>
            <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(39,174,96,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle size={32} color="var(--accent-green)" />
            </div>
            <div>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-white)' }}>Importation Réussie !</h3>
              <p style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
                <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>{result.inserted.toLocaleString('fr')}</span> nouvelles cartes ont été ajoutées.
                <br />
                <span style={{ color: 'var(--accent-blue)', fontWeight: 700 }}>{result.updated.toLocaleString('fr')}</span> cartes existantes ont été mises à jour.
              </p>
              <button className="btn btn-outline btn-sm" style={{ marginTop: 16 }} onClick={() => setResult(null)}>Importer un autre fichier</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
