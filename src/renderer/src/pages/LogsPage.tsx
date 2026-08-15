import { useState, useEffect, Fragment } from 'react';
import { FileText, ChevronLeft, ChevronRight, Trash2, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useCacheStore } from '../stores/cacheStore';
import { confirmService } from '../components/confirmService';
import { getActionMeta, getActionBadgeStyle, formatAuditDetails } from '../utils/auditLogCatalog';

// Durée de fraîcheur du cache d'agents (voir agentsCache dans cacheStore) avant de forcer un
// rechargement : évite un appel IPC users:getAll à chaque montage de LogsPage si la page
// Agents a déjà peuplé le cache récemment.
const AGENTS_CACHE_TTL_MS = 5 * 60 * 1000;

interface AuditLog {
  id: number;
  operator_id: string;
  action_type: string;
  details: string;
  timestamp: string;
  // 'local' = t_audit_log (poste courant uniquement) ; 'sync' = t_logs (action CRUD
  // cross-poste, synchronisée Supabase — voir handlers.ts logs:consultation). Les lignes
  // 'sync' ne sont pas supprimables individuellement ici (audit:delete ne cible que
  // t_audit_log) : le bouton Supprimer est désactivé pour elles.
  source?: 'local' | 'sync';
}

export default function LogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Index login -> agent (nom_user, prenom_user, centre_nom, roles...) pour l'enrichissement
  // de l'identité de l'opérateur dans le tableau et la modal (voir l'effet plus bas qui le
  // peuple via window.api.users.getAll()). Variable d'état locale (et non lue directement
  // depuis useCacheStore.getState() à chaque rendu) pour que l'arrivée des données déclenche
  // bien un re-rendu de la page.
  const [agentsIndex, setAgentsIndex] = useState<Record<string, any>>({});
  const { user } = useAuthStore();
  const limit = 15; // Pagination stricte demandée

  const handleDeleteLog = async (id: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    const isConfirmed = await confirmService.confirm({
      title: "Supprimer l'enregistrement d'audit",
      message: "Voulez-vous vraiment supprimer cet enregistrement d'audit ?",
      isDanger: true,
      requirePassword: true,
      actionName: `Suppression du log d'audit ID ${id}`
    });
    if (!isConfirmed) return;

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
     setIsRefreshing(true);
     window.api.logs.consultation(offset, limit, {}).then((res: any) => {
       if (res) {
         setLogs(res.rows || []);
         setTotal(res.total || 0);
       }
     }).catch((err: any) => {
       console.error('Erreur lors du chargement des logs d\'audit:', err);
     }).finally(() => {
       setIsRefreshing(false);
     });
   };

  // Libère la sidebar et l'interface globale (audit agent-9 : cette page ne
  // levait jamais l'overlay "Chargement sécurisé en cours...", gel permanent).
  useEffect(() => {
    useAuthStore.getState().setInitialDataLoading(false);
  }, []);

  useEffect(() => {
    loadLogs();
  }, [currentPage]);

  // Enrichissement identité opérateur (nom, prénom, centre) : réutilise le cache déjà rempli
  // par AgentsPage (canal IPC users:getAll, déjà autorisé aux 3 rôles qui accèdent à /logs —
  // voir ProtectedRoute dans App.tsx) s'il est encore frais, sinon le recharge directement
  // depuis cette page. Aucun changement côté handler IPC : la requête SQL de users:getAll
  // (queries.getUsers) joint déjà t_centres pour renvoyer nom_user/prenom_user/centre_nom.
  useEffect(() => {
    const buildIndex = (list: any[]) => {
      const index: Record<string, any> = {};
      for (const u of list || []) {
        if (u && u.login) index[u.login] = u;
      }
      return index;
    };

    const cache = useCacheStore.getState().agentsCache;
    const isFresh = !!cache.cachedAt && (Date.now() - cache.cachedAt) < AGENTS_CACHE_TTL_MS && cache.list.length > 0;
    if (isFresh) {
      setAgentsIndex(buildIndex(cache.list));
      return;
    }

    window.api.users.getAll().then((list: any[]) => {
      if (Array.isArray(list) && list.length > 0) {
        useCacheStore.getState().setAgentsCache(list);
        setAgentsIndex(buildIndex(list));
      }
    }).catch((err: any) => {
      // Non bloquant : en cas d'échec, le tableau retombe simplement sur l'affichage du seul
      // login (comportement précédent), sans casser la page.
      console.error('[LogsPage] Erreur lors du chargement des agents pour enrichissement identité:', err);
    });
  }, []);

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
            onClick={loadLogs}
            disabled={isRefreshing}
            className="btn"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, fontSize: 13,
              background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', color: 'white',
              cursor: isRefreshing ? 'not-allowed' : 'pointer', opacity: isRefreshing ? 0.6 : 1, transition: 'all 0.2s'
            }}
            onMouseOver={(e) => { if (!isRefreshing) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
            onMouseOut={(e) => { if (!isRefreshing) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
          >
            <RefreshCw size={16} style={{ animation: isRefreshing ? 'spin 1.5s linear infinite' : 'none' }} />
            {isRefreshing ? 'Actualisation...' : 'Actualiser'}
          </button>
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
                logs.map((l) => {
                  const agent = agentsIndex[l.operator_id];
                  const fullName = agent ? `${agent.prenom_user || ''} ${agent.nom_user || ''}`.trim() : '';
                  const actionMeta = getActionMeta(l.action_type);
                  const actionStyle = getActionBadgeStyle(l.action_type);
                  const detailsFormatted = formatAuditDetails(l.action_type, l.details);
                  return (
                  <tr
                    key={l.id}
                    onClick={() => setSelectedLog(l)}
                    style={{ cursor: 'pointer' }}
                    className="table-row-hover"
                  >
                    <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                      {new Date(l.timestamp).toLocaleString('fr-FR')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{fullName || l.operator_id}</span>
                        {fullName && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {l.operator_id}{agent?.centre_nom ? ` — ${agent.centre_nom}` : ''}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="badge" style={{
                        background: actionStyle.bg,
                        color: actionStyle.color,
                        border: '1px solid currentColor',
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 4,
                        whiteSpace: 'nowrap'
                      }}>
                        {actionMeta.label}
                      </span>
                    </td>
                    <td className="log-detail-cell" title={detailsFormatted.summary} style={{ fontSize: 13, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {detailsFormatted.summary}
                    </td>
                    {(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'ADMIN_CENTRE') && (
                      <td style={{ textAlign: 'center' }}>
                        <button
                          onClick={(e) => { if (l.source !== 'sync') handleDeleteLog(l.id, e); else e.stopPropagation(); }}
                          disabled={l.source === 'sync'}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: l.source === 'sync' ? 'var(--text-muted)' : '#ef4444',
                            cursor: l.source === 'sync' ? 'not-allowed' : 'pointer',
                            opacity: l.source === 'sync' ? 0.4 : 1,
                            padding: '4px 8px',
                            borderRadius: 4,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          className="btn-delete-hover"
                          title={l.source === 'sync' ? 'Action CRUD synchronisée cross-poste : suppression individuelle non disponible ici' : 'Supprimer ce log'}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                  );
                })
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
            maxHeight: '90vh',
            overflowY: 'auto',
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
              {(() => {
                if (!selectedLog) return null;
                const agent = agentsIndex[selectedLog.operator_id];
                const fullName = agent ? `${agent.prenom_user || ''} ${agent.nom_user || ''}`.trim() : '';
                const actionMeta = getActionMeta(selectedLog.action_type);
                const actionStyle = getActionBadgeStyle(selectedLog.action_type);
                const detailsFormatted = formatAuditDetails(selectedLog.action_type, selectedLog.details);
                return (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Opérateur / Agent :</span>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{fullName || selectedLog.operator_id}</span>
                        {(fullName || agent?.centre_nom) && (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {[fullName ? selectedLog.operator_id : null, agent?.centre_nom || null].filter(Boolean).join(' — ')}
                          </span>
                        )}
                        {agent && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2, justifyContent: 'flex-end' }}>
                            {(agent.roles || [agent.role]).map((r: string) => (
                              <span key={r} className="badge badge-outline" style={{ fontSize: 9, fontWeight: 700, borderColor: 'rgba(255,255,255,0.15)', color: '#fbbf24', background: 'rgba(251, 191, 36, 0.05)', padding: '1px 4px', borderRadius: 4 }}>
                                {r}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Type d'Action :</span>
                      <span className="badge" style={{
                        background: actionStyle.bg,
                        color: actionStyle.color,
                        border: '1px solid currentColor',
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '3px 10px',
                        borderRadius: 4
                      }}>
                        {actionMeta.label}
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Description détaillée :</span>
                      <div style={{
                        background: 'var(--bg-card-hover)',
                        padding: 12,
                        borderRadius: 6,
                        fontSize: 14,
                        lineHeight: '1.5',
                        fontWeight: 500,
                        border: '1px solid var(--border-color)'
                      }}>
                        {detailsFormatted.summary}
                      </div>
                      {detailsFormatted.entries.length > 0 && (
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'auto 1fr',
                          rowGap: 6,
                          columnGap: 12,
                          padding: '10px 12px',
                          borderRadius: 6,
                          fontSize: 12,
                          border: '1px dashed var(--border-color)'
                        }}>
                          {detailsFormatted.entries.map((entry, idx) => (
                            <Fragment key={idx}>
                              <span style={{ color: 'var(--text-muted)' }}>{entry.label}</span>
                              <span style={{ fontWeight: 500, wordBreak: 'break-word' }}>{entry.value}</span>
                            </Fragment>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
              {(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'ADMIN_CENTRE') && selectedLog?.source !== 'sync' && (
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
