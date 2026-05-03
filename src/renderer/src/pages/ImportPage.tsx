import { useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ImportPage() {
  const [file, setFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rows: Record<string, string>[]; headers: string[]; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ updated: number; inserted: number } | null>(null);

  const handleSelectFile = async () => {
    const path = await window.api.import.selectFile();
    if (!path) return;
    setFile(path);
    setResult(null);
    const data = await window.api.import.parseCSV(path);
    if (data.error) { toast.error(`Erreur: ${data.error}`); return; }
    setPreview(data);
    toast.success(`${data.total} lignes chargées`);
  };

  const handleImport = async () => {
    if (!preview) return;
    setImporting(true);
    setProgress(0);
    try {
      const BATCH = 5000;
      const rows = preview.rows;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        await window.api.import.executeBatch(batch, 'AGENT');
        setProgress(Math.round(((i + batch.length) / rows.length) * 100));
      }
      const res = await window.api.import.fusionner();
      setResult(res);
      toast.success(`Import terminé: ${res.inserted} nouvelles, ${res.updated} mises à jour`);
    } catch (e) { toast.error('Erreur import: ' + String(e)); }
    finally { setImporting(false); setProgress(100); }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Upload size={20} color="var(--accent-primary)" />
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Importation de données</h2>
      </div>

      {/* File Selection */}
      <div className="card">
        <div className="card-header"><span className="card-title"><FileSpreadsheet size={16} /> Sélection du fichier</span></div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: 40 }}>
          <div style={{ width: 80, height: 80, borderRadius: 20, background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border-color)' }}>
            <Upload size={32} color="var(--accent-primary)" />
          </div>
          <p style={{ color: 'var(--text-secondary)' }}>Formats acceptés: CSV, Excel (.xlsx, .xls)</p>
          <button className="btn btn-primary" onClick={handleSelectFile}>
            <FileSpreadsheet size={16} /> Choisir un fichier
          </button>
          {file && <p style={{ fontSize: 12, color: 'var(--accent-secondary)' }}>📁 {file}</p>}
        </div>
      </div>

      {/* Preview */}
      {preview && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Aperçu ({preview.total} lignes)</span>
            <button className="btn btn-success" onClick={handleImport} disabled={importing}>
              {importing ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={14} />}
              {importing ? 'Importation...' : 'Lancer l\'import'}
            </button>
          </div>
          <div className="card-body" style={{ overflowX: 'auto' }}>
            {importing && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Progression</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)' }}>{progress}%</span>
                </div>
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
              </div>
            )}
            <table className="data-table">
              <thead><tr>{preview.headers.slice(0, 8).map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {preview.rows.slice(0, 10).map((row, i) => (
                  <tr key={i}>{preview.headers.slice(0, 8).map(h => <td key={h}>{row[h.toLowerCase().replace(/\s+/g, '_')] || '—'}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {preview.total > 10 && <p style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>... et {preview.total - 10} lignes supplémentaires</p>}
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card" style={{ borderColor: 'var(--accent-green)' }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <CheckCircle size={32} color="var(--accent-green)" />
            <div>
              <p style={{ fontWeight: 700, fontSize: 16 }}>Import terminé avec succès !</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {result.inserted} nouvelles cartes insérées • {result.updated} cartes mises à jour
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
