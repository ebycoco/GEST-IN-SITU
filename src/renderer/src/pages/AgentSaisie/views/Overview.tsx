import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Calendar, Target, CalendarDays, ClipboardList, ChevronLeft, ChevronRight, RefreshCw, CheckCircle2, Clock3, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';

const PAGE_SIZE = 20;

interface AgentStats {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  year: number;
}

const EMPTY_STATS: AgentStats = { today: 0, yesterday: 0, week: 0, month: 0, year: 0 };

// Présentation du badge de statut de synchro par ligne (Travail du jour) — copie à l'identique
// de SYNC_STATUS_META/SyncStatusBadge de src/renderer/src/pages/AgentVerification/views/Overview.tsx
// (même palette vert succès / ambre attente / rouge échec). Dupliqué volontairement plutôt que
// factorisé dans un fichier partagé : périmètre de cette tâche limité aux 2 fichiers Overview.tsx
// déjà existants, pas de nouvelle abstraction pour seulement 2 usages.
// Libellé PENDING volontairement différent de la version Vérification : sur ce portail Saisie,
// createCarte()/updateCarte() n'appellent jamais enqueueOutbox() (workflow de synchro 100%
// manuel, push en masse déclenché plus tard par un admin via upload-worker.js) — l'état ERROR
// y est donc structurellement inatteignable et rien ne se résout tout seul en quelques
// secondes/minutes, contrairement à Vérification où l'auto-refresh 30s a un vrai sens. D'où un
// libellé qui reflète cette réalité plutôt qu'un simple "En attente" trompeur.
const SYNC_STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; Icon: typeof CheckCircle2 }> = {
  SYNCED: { label: 'Synchronisé', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.25)', Icon: CheckCircle2 },
  PENDING: { label: 'À synchroniser (admin)', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.25)', Icon: Clock3 },
  ERROR: { label: 'Échec', color: '#f87171', bg: 'rgba(248, 113, 113, 0.1)', border: 'rgba(248, 113, 113, 0.25)', Icon: AlertTriangle }
};

function SyncStatusBadge({ status }: { status: string }) {
  const meta = SYNC_STATUS_META[status] || SYNC_STATUS_META.PENDING;
  const { Icon } = meta;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
      <Icon size={11} /> {meta.label}
    </span>
  );
}

/**
 * Vue d'ensemble du Portail de Saisie (rôle OPERATEUR_SAISIE) :
 * - 4 KPI (Aujourd'hui/Semaine/Mois/Année) : endpoint dédié stats:getAgentStats →
 *   getAgentStats (stats.queries.ts), filtré sur created_by=agent connecté (aucun filtre
 *   statut/site), même filtre que l'ancien widget "Mes saisies aujourd'hui"
 *   (stats:getAgentToday) mais étendu aux 4 périodes. Palette or du portail conservée
 *   (#ffd700 / #eccc68), cohérente visuellement avec les portails Vérification/Apurement pour
 *   la structure (grille de 4 cartes) mais pas la couleur.
 * - Liste paginée "Travail du jour" : endpoint stats:getAgentCardsTodayPaginated (LIMIT/OFFSET
 *   borné, politique Low-Memory RAM 8 Go), remplace l'ancienne section "Activité Récente"
 *   (non bornée, non paginée, toutes dates confondues) par une liste bornée à aujourd'hui.
 *   Ne touche pas à getAgentRecentSaisies / stats:getAgentRecentSaisies, toujours utilisée
 *   telle quelle par HistoriqueView.tsx pour l'historique complet.
 */
export default function Overview() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<AgentStats>(EMPTY_STATS);

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Récapitulatif de synchro du "Travail du jour" (badge par ligne + compteurs agrégés) — voir
  // getAgentCardsTodayPaginated (stats.queries.ts) pour la logique de calcul du statut.
  const [syncSummary, setSyncSummary] = useState({ synced: 0, pending: 0, error: 0 });

  const loadStats = useCallback(async () => {
    if (!user?.id_user) { setStats(EMPTY_STATS); return; }
    try {
      const res = await window.api.stats.getAgentStats(user.id_user);
      if (res) setStats(res);
    } catch (err) {
      console.error("Erreur lors du chargement des statistiques de saisie :", err);
    }
  }, [user?.id_user]);

  // `silent` évite de repasser par isLoading (donc par l'écran "Chargement en cours...") lors d'un
  // rappel en arrière-plan sans flash visuel. Non utilisé par les rappels périodiques actuels de ce
  // portail (60s / app:data-updated, tous deux non-silencieux, inchangés) : paramètre conservé tel
  // quel car partagé avec la signature de loadCardsToday d'AgentVerification/views/Overview.tsx.
  const loadCardsToday = useCallback(async (silent = false) => {
    if (!user?.id_user) { setRows([]); setTotal(0); setIsLoading(false); return; }
    try {
      if (!silent) setIsLoading(true);
      const res = await window.api.stats.getAgentCardsTodayPaginated(user.id_user, page, PAGE_SIZE);
      setRows(res?.rows || []);
      setTotal(res?.total || 0);
      setSyncSummary(res?.syncSummary || { synced: 0, pending: 0, error: 0 });
    } catch (err) {
      console.error("Erreur lors du chargement des saisies du jour :", err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [user?.id_user, page]);

  useEffect(() => {
    loadStats();
    loadCardsToday();

    // Auto-refresh toutes les minutes, comportement conservé de l'ancien widget.
    const interval = setInterval(() => {
      loadStats();
      loadCardsToday();
    }, 60000);

    const onDataUpdated = () => {
      loadStats();
      loadCardsToday();
    };
    window.addEventListener('app:data-updated', onDataUpdated);

    return () => {
      clearInterval(interval);
      window.removeEventListener('app:data-updated', onDataUpdated);
    };
  }, [loadStats, loadCardsToday]);

  // Pas de polling dédié 30s ici (à la différence de AgentVerification/views/Overview.tsx) :
  // ce portail fonctionne en workflow de synchro 100% manuel (createCarte()/updateCarte()
  // n'appellent jamais enqueueOutbox(), push en masse déclenché plus tard par un admin) — un
  // timer court n'aurait rien de nouveau à refléter dans l'intervalle. Le rafraîchissement
  // général ~60s ci-dessus (préexistant) suffit à tenir le badge et le récapitulatif à jour.
  const handleRefreshClick = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([loadStats(), loadCardsToday()]);
    } finally {
      setIsRefreshing(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100, margin: '0 auto' }}>

      {/* KPI: 4 cartes Aujourd'hui / Semaine / Mois / Année (palette or du portail) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>

        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px', background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.08) 0%, rgba(255, 215, 0, 0.01) 100%)', border: '1px solid rgba(255, 215, 0, 0.2)', borderRadius: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #eccc68 0%, #ffd700 100%)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(255, 215, 0, 0.3)' }}>
            <Activity size={28} />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{stats.today}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#ffd700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Aujourd'hui</div>
          </div>
        </div>

        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px', background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(59, 130, 246, 0.01) 100%)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(59, 130, 246, 0.3)' }}>
            <Calendar size={28} />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{stats.week}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Cette semaine</div>
          </div>
        </div>

        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px', background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(139, 92, 246, 0.01) 100%)', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(139, 92, 246, 0.3)' }}>
            <CalendarDays size={28} />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{stats.month}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Ce mois</div>
          </div>
        </div>

        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px', background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.05) 0%, rgba(245, 158, 11, 0.01) 100%)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(245, 158, 11, 0.3)' }}>
            <Target size={28} />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{stats.year}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Cette année</div>
          </div>
        </div>

      </div>

      {/* Travail du jour : fiches saisies aujourd'hui par l'agent connecté */}
      <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '20px 24px', color: 'white', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ClipboardList size={20} color="#ffd700" />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Travail du jour</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            {total > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <SyncStatusBadge status="SYNCED" />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>{syncSummary.synced}</span>
                <SyncStatusBadge status="PENDING" />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>{syncSummary.pending}</span>
                <SyncStatusBadge status="ERROR" />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{syncSummary.error}</span>
              </div>
            )}
            <button
              onClick={handleRefreshClick}
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
          </div>
        </div>

        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement en cours...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <ClipboardList size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            Aucune saisie enregistrée aujourd'hui pour le moment.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Identité</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>N° Sécu</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Rangement</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Contact</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Heure de saisie</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Synchro</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id_carte} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ fontWeight: 600, color: 'white' }}>{r.noms} {r.prenoms}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {r.date_de_naissance || '—'}{r.lieu_de_naissance ? ` · ${r.lieu_de_naissance}` : ''}
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px', fontFamily: 'monospace', color: '#eccc68' }}>{r.num_secu || '—'}</td>
                    <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>{r.rangement || '—'}</td>
                    <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>{r.contact || '—'}</td>
                    <td style={{ padding: '16px 24px', color: 'var(--text-muted)', fontSize: 13 }}>
                      {r.created_at ? new Date(r.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <SyncStatusBadge status={r.sync_status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, padding: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: page === 0 ? 'transparent' : 'rgba(255,255,255,0.05)', color: page === 0 ? 'var(--text-muted)' : 'white', cursor: page === 0 ? 'not-allowed' : 'pointer' }}
            >
              <ChevronLeft size={16} /> Précédent
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Page {page + 1} sur {totalPages}
            </span>
            <button
              onClick={() => setPage(p => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages}
              className="btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: page + 1 >= totalPages ? 'transparent' : 'rgba(255,255,255,0.05)', color: page + 1 >= totalPages ? 'var(--text-muted)' : 'white', cursor: page + 1 >= totalPages ? 'not-allowed' : 'pointer' }}
            >
              Suivant <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
