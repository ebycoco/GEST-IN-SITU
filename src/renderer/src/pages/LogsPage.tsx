import { useState, useEffect } from 'react';
import { FileText, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useCacheStore } from '../stores/cacheStore';

interface AuditLog {
  id: number;
  operator_id: string;
  action_type: string;
  details: string;
  timestamp: string;
}

export default function LogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const { user } = useAuthStore();
  const limit = 15; // Pagination stricte demandée

  const handleDeleteLog = (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm('Voulez-vous vraiment supprimer cet enregistrement d\'audit ?')) return;

    window.api.audit.delete(id, user).then((res: any) => {
      if (res && res.success) {
        setSelectedLog(null);
        loadLogs();
      }
    }).catch((err: any) => {
      console.error('Erreur lors de la suppression de l\'audit:', err);
      alert('Erreur lors de la suppression : ' + (err.message || err));
    });
  };

  const handleExport = () => {
    window.api.logs.export({ periode_export: 'Toute la période' }).then((res: any) => {
      if (res && res.success) {
        alert(`Export réussi ! Fichier enregistré sous : ${res.filePath}\nNombre de lignes exportées : ${res.nombre_lignes_exportées}`);
      } else if (res && !res.canceled) {
        alert(`Erreur lors de l'export : ${res.error || 'Erreur inconnue'}`);
      }
    }).catch((err: any) => {
      console.error('Erreur export logs:', err);
      alert(`Erreur : ${err.message || err}`);
    });
  };

  const handlePurge = () => {
    window.api.logs.purge({ periode_purge: 'Toute la période' }).then((res: any) => {
      if (res && res.success) {
        alert(`Purge réussie ! ${res.nombre_lignes_supprimées} lignes supprimées.`);
        loadLogs();
      } else if (res && res.error) {
        alert(`Purge annulée ou échouée : ${res.error}`);
      }
    }).catch((err: any) => {
      console.error('Erreur purge logs:', err);
      alert(`Erreur : ${err.message || err}`);
    });
  };

  const loadLogs = () => {
     const offset = (currentPage - 1) * limit;
     window.api.logs.consultation(offset, limit, {}).then((res: any) => {
       if (res) {
         setLogs(res.rows || []);
         setTotal(res.total || 0);
       }
     }).catch((err: any) => {
       console.error('Erreur lors du chargement des logs d\'audit:', err);
     });
   };

  useEffect(() => {
    loadLogs();
  }, [currentPage]);

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: 12, background: 'var(--gradient-button)', borderRadius: 12, color: 'white' }}>
            <FileText size={24} />
          </div>
          <div>
            <h2 style={{ margin: 0 }}>Journal d'Audit Système</h2>
            <p style={{ margin: 0, color: 'var(--text-muted)' }}>Suivi des connexions, déconnexions et retraits de cartes CMU.</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button 
            className="btn btn-secondary"
            onClick={handleExport}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            Exporter
          </button>
          {(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE') && (
            <button 
              className="btn"
              onClick={handlePurge}
              style={{ background: '#ef4444', color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}
            >
              Purger
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="table-responsive-wrapper" style={{ flex: 1 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date & Heure</th>
                <th>Opérateur</th>
                <th>Type d'Action</th>
                <th>Détails</th>
                {(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'ADMIN_CENTRE') && (
                  <th style={{ width: 80, textAlign: 'center' }}>Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'ADMIN_CENTRE') ? 5 : 4} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    Aucun log d'activité d'audit enregistré.
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr 
                    key={l.id} 
                    onClick={() => setSelectedLog(l)}
                    style={{ cursor: 'pointer' }}
                    className="table-row-hover"
                  >
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      {new Date(l.timestamp).toLocaleString('fr-FR')}
                    </td>
                    <td style={{ fontWeight: 600 }}>{l.operator_id}</td>
                    <td>
                      <span className="badge" style={{
                        background: l.action_type === 'CONNEXION' ? 'rgba(34, 197, 94, 0.15)' : 
                                     l.action_type === 'DECONNEXION' ? 'rgba(239, 68, 68, 0.15)' : 
                                     l.action_type === 'RETRAIT' ? 'rgba(234, 179, 8, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                        color: l.action_type === 'CONNEXION' ? '#22c55e' : 
                               l.action_type === 'DECONNEXION' ? '#ef4444' : 
                               l.action_type === 'RETRAIT' ? '#eab308' : '#3b82f6',
                        border: '1px solid currentColor',
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 4
                      }}>
                        {l.action_type}
                      </span>
                    </td>
                    <td className="log-detail-cell" title={l.details} style={{ fontSize: 13, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.details}
                    </td>
                    {(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'ADMIN_CENTRE') && (
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={(e) => handleDeleteLog(l.id, e)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            borderRadius: 4,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          className="btn-delete-hover"
                          title="Supprimer ce log"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Contrôles de Pagination Plein Soleil */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 24px',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-card)'
        }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Total : <strong>{total}</strong> log(s)
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="btn btn-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                opacity: currentPage === 1 ? 0.5 : 1,
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
              }}
            >
              <ChevronLeft size={16} /> Précédent
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-color)', fontWeight: 500 }}>
              Page {currentPage} sur {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className="btn btn-secondary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                opacity: currentPage === totalPages ? 0.5 : 1,
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
              }}
            >
              Suivant <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {selectedLog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          animation: 'fade-in 0.2s ease-out'
        }} onClick={() => setSelectedLog(null)}>
          <div className="card animate-scale-up" style={{
            width: '100%',
            maxWidth: 550,
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileText size={20} style={{ color: 'var(--text-color)' }} />
                <h3 style={{ margin: 0 }}>Détail de l'Audit</h3>
              </div>
              <button 
                onClick={() => setSelectedLog(null)}
                style={{ 
                  background: 'transparent', 
                  border: 'none', 
                  color: 'var(--text-muted)', 
                  cursor: 'pointer',
                  fontSize: 20
                }}
              >
                &times;
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Date & Heure :</span>
                <span style={{ fontWeight: 500 }}>{selectedLog?.timestamp ? new Date(selectedLog.timestamp).toLocaleString('fr-FR') : ''}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Opérateur / Agent :</span>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ fontWeight: 600 }}>{selectedLog?.operator_id}</span>
                  {(() => {
                    const agent = useCacheStore.getState().agentsCache.list.find(u => u.login === selectedLog?.operator_id);
                    if (agent) {
                      return (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                          {(agent.roles || [agent.role]).map((r: string) => (
                            <span key={r} className="badge badge-outline" style={{ fontSize: 9, fontWeight: 700, borderColor: 'rgba(255,255,255,0.15)', color: '#fbbf24', background: 'rgba(251, 191, 36, 0.05)', padding: '1px 4px', borderRadius: 4 }}>
                              {r}
                            </span>
                          ))}
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>Type d'Action :</span>
                <span className="badge" style={{
                  background: selectedLog?.action_type === 'CONNEXION' ? 'rgba(34, 197, 94, 0.15)' : 
                               selectedLog?.action_type === 'DECONNEXION' ? 'rgba(239, 68, 68, 0.15)' : 
                               selectedLog?.action_type === 'RETRAIT' ? 'rgba(234, 179, 8, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                  color: selectedLog?.action_type === 'CONNEXION' ? '#22c55e' : 
                         selectedLog?.action_type === 'DECONNEXION' ? '#ef4444' : 
                         selectedLog?.action_type === 'RETRAIT' ? '#eab308' : '#3b82f6',
                  border: '1px solid currentColor',
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4
                }}>
                  {selectedLog?.action_type}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
                <span style={{ color: 'var(--text-muted)' }}>Description détaillée :</span>
                <div style={{ 
                  background: 'var(--bg-card-hover)', 
                  padding: 12, 
                  borderRadius: 6, 
                  fontSize: 13, 
                  lineHeight: '1.5',
                  border: '1px solid var(--border-color)' 
                }}>
                  {selectedLog?.details}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
              {(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'ADMIN_CENTRE') && (
                <button 
                  className="btn" 
                  style={{ 
                    background: '#ef4444', 
                    color: 'white', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 6 
                  }}
                  onClick={() => selectedLog && handleDeleteLog(selectedLog.id)}
                >
                  <Trash2 size={16} /> Supprimer
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setSelectedLog(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
