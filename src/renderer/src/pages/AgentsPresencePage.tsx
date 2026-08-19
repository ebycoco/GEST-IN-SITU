import { useEffect, useState, useCallback, useMemo } from 'react';
import { Users, RefreshCw, WifiOff, Clock, MapPin, ShieldAlert, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { AgentPresenceRow } from '../../../shared/types';

// ============================================================================
// Page "Présence des Agents" (Pilotage & Monitoring, réservée SUPER ADMIN /
// ADMINISTRATEUR_SITE). Consomme window.api.presence.getAgents() (handler IPC
// presence:getAgents, src/main/ipc/handlers.ts), lui-même adossé à
// getAgentsPresence() (src/main/sync/presence.service.ts — module stable, non
// modifié). Aucun statut n'est calculé côté service (D4 du plan d'impact) :
// tout le calcul En ligne / Inactif / Hors ligne se fait ici, côté renderer,
// à partir des timestamps bruts.
// ============================================================================

type PresenceStatus = 'EN_LIGNE' | 'INACTIF' | 'HORS_LIGNE';

const STATUS_META: Record<PresenceStatus, { label: string; color: string; bg: string; border: string }> = {
  EN_LIGNE: { label: 'En ligne', color: '#34d399', bg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.3)' },
  INACTIF: { label: 'Inactif', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.3)' },
  HORS_LIGNE: { label: 'Hors ligne', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.3)' },
};

// Libellés courts pour la colonne "Rôle" (rôles concernés par la présence — cf.
// PRESENCE_ROLES dans presence.service.ts, non dupliqué ici : simple table d'affichage).
const ROLE_LABELS: Record<string, string> = {
  OPERATEUR_VERIFICATION: 'Vérification',
  OPERATEUR_QUALITE: 'Qualité',
  OPERATEUR_SAISIE: 'Saisie',
  OPERATEUR_LOGISTIQUE: 'Logistique',
  OPERATEUR_INVENTAIRE: 'Inventaire',
  OPERATEUR_APUREMENT: 'Apurement',
  ADMIN_CENTRE: 'Admin Centre',
};

// Seuils validés (plan d'impact, non renégociables ici) :
//  - En ligne  : last_heartbeat_at < 5 min
//  - Inactif   : last_heartbeat_at < 5 min MAIS last_action_at >= 10 min (ou absent)
//  - Hors ligne: last_logout_at plus récent que last_heartbeat_at, OU last_heartbeat_at
//                absent/>= 15 min
const HEARTBEAT_ONLINE_MAX_MIN = 5;
const HEARTBEAT_OFFLINE_MIN = 15;
const ACTION_STALE_MIN = 10;
const POLL_INTERVAL_MS = 45000; // 45s (fourchette 30-60s demandée par le plan)
const CLOCK_TICK_MS = 30000; // recalcule les badges même sans nouvelle donnée serveur
const PAGE_SIZE = 10; // pagination CÔTÉ CLIENT du tableau "Détail par agent" (aucune requête serveur)

function computeStatus(row: AgentPresenceRow, nowMs: number): PresenceStatus {
  const heartbeatMs = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : null;
  const logoutMs = row.last_logout_at ? new Date(row.last_logout_at).getTime() : null;
  const actionMs = row.last_action_at ? new Date(row.last_action_at).getTime() : null;

  if (!heartbeatMs || isNaN(heartbeatMs)) return 'HORS_LIGNE';
  if (logoutMs && !isNaN(logoutMs) && logoutMs >= heartbeatMs) return 'HORS_LIGNE';

  const heartbeatAgeMin = (nowMs - heartbeatMs) / 60000;
  if (heartbeatAgeMin >= HEARTBEAT_OFFLINE_MIN) return 'HORS_LIGNE';

  // Zone intermédiaire (5-15 min de battement) non explicitement tranchée par les seuils
  // validés (qui ne couvrent que < 5 min = En ligne et >= 15 min = Hors ligne) : traitée
  // par prudence comme Inactif, au même titre qu'une action utilisateur devenue silencieuse
  // (>= 10 min ou absente) alors que le battement est encore frais.
  const actionAgeMin = actionMs && !isNaN(actionMs) ? (nowMs - actionMs) / 60000 : Infinity;
  if (heartbeatAgeMin >= HEARTBEAT_ONLINE_MAX_MIN || actionAgeMin >= ACTION_STALE_MIN) {
    return 'INACTIF';
  }

  return 'EN_LIGNE';
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('fr-FR');
  } catch {
    return iso;
  }
}

function displayName(row: AgentPresenceRow): string {
  const full = `${row.prenom_user ?? ''} ${row.nom_user ?? ''}`.trim();
  return full || row.login;
}

export default function AgentsPresencePage() {
  const user = useAuthStore((s) => s.user);
  const activeSiteId = useAuthStore((s) => s.activeSiteId);
  const isSuperAdmin = user?.role === 'SUPER ADMIN';

  const [rows, setRows] = useState<AgentPresenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [networkOnline, setNetworkOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [siteFilter, setSiteFilter] = useState<number | 'ALL'>('ALL');
  const [sites, setSites] = useState<Array<{ id: number; nom: string }>>([]);
  const [centreNameById, setCentreNameById] = useState<Record<number, string>>({});
  const [currentPage, setCurrentPage] = useState(1); // pagination client du tableau "Détail par agent" (1-based)

  // Synchronise la valeur initiale du filtre local avec le sélecteur "CONTEXTE
  // OPÉRATIONNEL" du Sidebar (activeSiteId, SUPER ADMIN uniquement — cf. Sidebar.tsx).
  // Ne s'exécute qu'au montage et à chaque changement effectif de activeSiteId (donc à
  // chaque bascule de contexte côté Sidebar) : un choix local du filtre effectué par
  // l'utilisateur sur CETTE page, entre deux bascules de contexte, n'est jamais écrasé.
  useEffect(() => {
    if (!isSuperAdmin) return;
    setSiteFilter(activeSiteId ?? 'ALL');
  }, [isSuperAdmin, activeSiteId]);

  // Libellés (sites/centres) — lecture SQLite locale déjà cantonnée côté serveur
  // (hierarchy:getSites / hierarchy:getCentres), une seule fois au montage.
  useEffect(() => {
    let cancelled = false;
    if (window.api?.hierarchy?.getSites) {
      window.api.hierarchy.getSites()
        .then((data: any[]) => { if (!cancelled) setSites((data || []).map((s: any) => ({ id: s.id, nom: s.nom }))); })
        .catch(() => {});
    }
    if (window.api?.hierarchy?.getCentres) {
      window.api.hierarchy.getCentres()
        .then((data: any[]) => {
          if (cancelled) return;
          const map: Record<number, string> = {};
          (data || []).forEach((c: any) => { map[c.id] = c.nom; });
          setCentreNameById(map);
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, []);

  const loadPresence = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      // Dégradation gracieuse (décision D3 du plan) : cette page dépend d'une lecture
      // Supabase en direct. Un état réseau non ONLINE est signalé explicitement plutôt que
      // de laisser croire à une liste d'agents réellement vide.
      let online = true;
      if (window.api?.sync?.getStatus) {
        try {
          const status = await window.api.sync.getStatus();
          online = !status || status.state === 'ONLINE';
        } catch {
          online = true; // indéterminé : ne pas afficher un faux bandeau hors-ligne
        }
      }
      setNetworkOnline(online);

      if (!window.api?.presence?.getAgents) {
        setRows([]);
        setFetchError(null);
        return;
      }
      const data = await window.api.presence.getAgents();
      setRows(data || []);
      setFetchError(null);
    } catch (err: any) {
      console.error('Impossible de charger la présence des agents:', err);
      setFetchError(err?.message || "Impossible de charger la présence des agents.");
      if (!opts?.silent) {
        toast.error('Échec du chargement de la présence des agents.');
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Libère l'overlay global "Chargement sécurisé en cours..." (MainLayout) au cas où
    // cette page serait le premier écran consulté après connexion — même réflexe que
    // SyncStatusDashboard.
    useAuthStore.getState().setInitialDataLoading(false);

    loadPresence();

    // Polling 30-60s (ici 45s), nettoyé au démontage — politique low-memory CLAUDE.md §2 :
    // un seul intervalle de données + un seul intervalle d'horloge, tous deux clearInterval.
    const pollInterval = setInterval(() => loadPresence({ silent: true }), POLL_INTERVAL_MS);
    const clockInterval = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);

    return () => {
      clearInterval(pollInterval);
      clearInterval(clockInterval);
    };
  }, [loadPresence]);

  const visibleRows = useMemo(() => {
    if (!isSuperAdmin || siteFilter === 'ALL') return rows;
    return rows.filter((r) => r.site_id === siteFilter);
  }, [rows, isSuperAdmin, siteFilter]);

  // Pagination CÔTÉ CLIENT (simple slice en mémoire, aucune requête supplémentaire —
  // politique low-memory CLAUDE.md §2) du tableau "Détail par agent" uniquement : les
  // widgets récapitulatifs juste en dessous comptent toujours sur visibleRows en entier.
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));

  // Reset à la page 1 quand le filtre de site change (nouveau périmètre de lignes).
  useEffect(() => {
    setCurrentPage(1);
  }, [siteFilter]);

  // Reset à la page 1 quand la page courante n'existe plus (ex. un refresh silencieux
  // du polling a réduit le nombre de lignes filtrées sous la page actuellement affichée).
  useEffect(() => {
    setCurrentPage((p) => (p > totalPages ? 1 : p));
  }, [totalPages]);

  const paginatedRows = useMemo(
    () => visibleRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [visibleRows, currentPage]
  );

  const counts = useMemo(() => {
    const c: Record<PresenceStatus, number> = { EN_LIGNE: 0, INACTIF: 0, HORS_LIGNE: 0 };
    visibleRows.forEach((r) => { c[computeStatus(r, now)]++; });
    return c;
  }, [visibleRows, now]);

  const siteNameById = useMemo(() => {
    const map: Record<number, string> = {};
    sites.forEach((s) => { map[s.id] = s.nom; });
    return map;
  }, [sites]);

  const inputStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255, 215, 0, 0.25)',
    borderRadius: 8,
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: 600,
    padding: '7px 12px',
    cursor: 'pointer',
    outline: 'none',
    colorScheme: 'dark',
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: '100vh', overflowY: 'auto', padding: '24px 32px 80px' }}>

      <style dangerouslySetInnerHTML={{ __html: `
        .presence-glass-card {
          background: rgba(26, 31, 74, 0.45);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 24px;
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.25s ease;
        }
        .presence-glass-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3), 0 0 15px rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.15);
        }
        .presence-btn-refresh {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--text-primary);
          padding: 10px 16px;
          border-radius: 10px;
          font-weight: 600;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .presence-btn-refresh:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.15);
          border-color: rgba(255, 255, 255, 0.25);
        }
        .presence-btn-refresh:disabled { opacity: 0.5; cursor: not-allowed; }
        .presence-spin { animation: presence-spin-smooth 1s linear infinite; }
        .presence-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        .presence-table th {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .presence-table td {
          font-size: 13px;
          padding: 14px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          color: var(--text-secondary);
          vertical-align: middle;
        }
        .presence-table tr:hover { background: rgba(255, 255, 255, 0.02); }
        .presence-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
        }
        @keyframes presence-spin-smooth { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'linear-gradient(135deg, #ffd700 0%, #b8860b 100%)', width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(255, 215, 0, 0.2)' }}>
              <Users size={18} color="black" />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>Présence des Agents</h2>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 48, margin: 0 }}>
            État courant (en ligne / inactif / hors ligne) des agents de terrain, rafraîchi automatiquement.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {isSuperAdmin && sites.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <MapPin size={14} color="var(--text-muted)" />
              <select
                value={siteFilter === 'ALL' ? 'ALL' : String(siteFilter)}
                onChange={(e) => setSiteFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                style={inputStyle}
              >
                <option value="ALL" style={{ background: '#0d111b' }}>Tous les sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id} style={{ background: '#0d111b' }}>{s.nom}</option>
                ))}
              </select>
            </div>
          )}
          <button className="presence-btn-refresh" disabled={loading} onClick={() => loadPresence()}>
            <RefreshCw size={16} className={loading ? 'presence-spin' : ''} />
            <span>RAFRAÎCHIR</span>
          </button>
        </div>
      </div>

      {/* Bandeau réseau (dégradation gracieuse, décision D3) */}
      {!networkOnline && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.3)', borderRadius: 12, padding: '12px 16px' }}>
          <WifiOff size={18} color="#f87171" />
          <span style={{ fontSize: 13, color: '#f87171', fontWeight: 600 }}>
            Connexion Supabase indisponible : la présence des agents ne peut pas être actualisée hors-ligne. Les données affichées peuvent être obsolètes.
          </span>
        </div>
      )}
      {networkOnline && fetchError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(248, 113, 113, 0.1)', border: '1px solid rgba(248, 113, 113, 0.3)', borderRadius: 12, padding: '12px 16px' }}>
          <ShieldAlert size={18} color="#f87171" />
          <span style={{ fontSize: 13, color: '#f87171', fontWeight: 600 }}>{fetchError}</span>
        </div>
      )}

      {/* Widgets récapitulatifs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        {(['EN_LIGNE', 'INACTIF', 'HORS_LIGNE'] as PresenceStatus[]).map((status) => {
          const meta = STATUS_META[status];
          return (
            <div key={status} className="presence-glass-card" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ background: meta.bg, border: `1px solid ${meta.border}`, width: 46, height: 46, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="presence-dot" style={{ backgroundColor: meta.color, width: 14, height: 14 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{meta.label}</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: meta.color }}>{counts[status]}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tableau des agents */}
      <div className="presence-glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <Clock size={16} color="#ffd700" />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Détail par agent</h3>
        </div>

        {loading && rows.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 200, color: 'var(--text-muted)', fontSize: 13 }}>
            <RefreshCw size={28} className="presence-spin" color="#ffd700" />
            <span>Chargement de la présence des agents...</span>
          </div>
        ) : visibleRows.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 200, color: 'var(--text-muted)', fontSize: 13 }}>
            <CheckCircle2 size={28} color="#34d399" />
            <span>Aucun agent trouvé pour ce périmètre.</span>
          </div>
        ) : (
          <>
          <div style={{ overflowX: 'auto' }}>
            <table className="presence-table">
              <thead>
                <tr>
                  <th>Statut</th>
                  <th>Agent</th>
                  <th>Rôle</th>
                  <th>Centre</th>
                  <th>Dernière connexion</th>
                  <th>Dernière déconnexion</th>
                  <th>Dernière action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedRows.map((row) => {
                  const status = computeStatus(row, now);
                  const meta = STATUS_META[status];
                  const centreNom = row.centre_id != null ? (centreNameById[row.centre_id] || `Centre #${row.centre_id}`) : '—';
                  const siteNom = isSuperAdmin && row.site_id != null ? (siteNameById[row.site_id] || `Site #${row.site_id}`) : null;

                  return (
                    <tr key={row.sync_id}>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800, letterSpacing: '0.05em' }}>
                          <span className="presence-dot" style={{ backgroundColor: meta.color }} />
                          {meta.label}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{displayName(row)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.login}{siteNom ? ` · ${siteNom}` : ''}</div>
                      </td>
                      <td>{row.role ? (ROLE_LABELS[row.role] || row.role) : '—'}</td>
                      <td>{centreNom}</td>
                      <td>{formatDateTime(row.last_login_at)}</td>
                      <td>{status === 'HORS_LIGNE' ? formatDateTime(row.last_logout_at) : '—'}</td>
                      <td>
                        {row.last_action_label ? (
                          <>
                            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.last_action_label}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatDateTime(row.last_action_at)}</div>
                          </>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination client (slice en mémoire de visibleRows, aucun impact sur les
              widgets récapitulatifs ni sur les données chargées) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {visibleRows.length} agent{visibleRows.length > 1 ? 's' : ''} au total
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="presence-btn-refresh"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{ padding: '8px 12px' }}
              >
                <ChevronLeft size={14} />
                <span>PRÉCÉDENT</span>
              </button>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#ffd700', minWidth: 60, textAlign: 'center' }}>
                {currentPage} / {totalPages}
              </span>
              <button
                className="presence-btn-refresh"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                style={{ padding: '8px 12px' }}
              >
                <span>SUIVANT</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
