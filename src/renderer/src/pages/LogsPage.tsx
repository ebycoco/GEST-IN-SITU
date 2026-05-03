import { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';

interface Log { id_log: number; action_type: string; table_concernee: string; id_enregistrement: number; date_action: string; details: string; user: string; }

export default function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);

  useEffect(() => {
    window.api.logs.getRecent(100).then(setLogs);
  }, []);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <FileText size={20} color="var(--accent-primary)" />
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Journaux d'Audit</h2>
      </div>

      <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="card-body" style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Table</th><th>ID Enreg.</th><th>Détails</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id_log}>
                  <td style={{ color: 'var(--text-muted)' }}>{new Date(l.date_action).toLocaleString()}</td>
                  <td style={{ fontWeight: 600 }}>{l.user}</td>
                  <td>
                    <span className={`status-badge ${l.action_type === 'INSERT' ? 'distribue' : l.action_type === 'DELETE' ? 'annule' : 'stock'}`}>
                      {l.action_type}
                    </span>
                  </td>
                  <td>{l.table_concernee}</td>
                  <td>{l.id_enregistrement}</td>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }}>
                    {l.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
