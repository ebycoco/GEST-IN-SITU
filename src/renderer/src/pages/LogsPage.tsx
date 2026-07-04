import { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

interface Log { 
  id_log: number; 
  id_user: number;
  login_user: string;
  action: string; 
  detail: string; 
  date_heure: string; 
}

export default function LogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const { user, activeSiteId } = useAuthStore();

  const loadLogs = () => {
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    const logFilters: any = { siteId: siteIdToUse };
    if (user?.role === 'ADMIN_CENTRE' && user?.centre_id) {
      logFilters.centreId = user.centre_id;
    }
    window.api.logs.get(0, 100, logFilters).then((res: any) => {
      if (res && res.rows) {
        setLogs(res.rows);
      }
    });
  };

  useEffect(() => {
    loadLogs();
  }, [activeSiteId, user?.site_id]);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ padding: 12, background: 'var(--gradient-button)', borderRadius: 12, color: 'white' }}>
          <FileText size={24} />
        </div>
        <div>
          <h2 style={{ margin: 0 }}>Journaux d'Audit</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Suivi des actions effectuées sur le système.</p>
        </div>
      </div>

  <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
    <div className="table-responsive-wrapper" style={{ flex: 1 }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Date & Heure</th>
            <th>Utilisateur</th>
            <th>Action</th>
            <th>Détails</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                Aucun journal d'activité trouvé.
              </td>
            </tr>
          ) : (
            logs.map((l) => (
              <tr key={l.id_log}>
                <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  {new Date(l.date_heure).toLocaleString('fr-FR')}
                </td>
                <td style={{ fontWeight: 600 }}>{l.login_user}</td>
                <td>
                  <span className="badge" style={{ 
                    background: 'var(--bg-card-hover)', 
                    color: 'var(--text-color)',
                    border: '1px solid var(--border-color)',
                    fontSize: 11
                  }}>
                    {l.action}
                  </span>
                </td>
                <td className="log-detail-cell" title={l.detail} style={{ fontSize: 13 }}>
                  {l.detail}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </div>
    </div>
  );
}
