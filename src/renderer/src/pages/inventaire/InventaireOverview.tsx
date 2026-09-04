import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Calendar, CalendarDays, Target, PackageSearch, ClipboardList, ChevronLeft, ChevronRight, CheckCircle2, Clock3, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

interface InventaireOverviewStats {
  today: number;
  week: number;
  month: number;
  year: number;
}

const EMPTY_STATS: InventaireOverviewStats = { today: 0, week: 0, month: 0, year: 0 };
const PAGE_SIZE = 20;

// Présentation du badge de statut de synchro par ligne (Travail du jour) — dupliqué à
// l'identique depuis ApurementOverview.tsx (même choix qu'y est déjà documenté : pas
// d'emplacement partagé raisonnable pour un si petit composant).
const SYNC_STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; Icon: typeof CheckCircle2 }> = {
  SYNCED: { label: 'Synchronisé', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.25)', Icon: CheckCircle2 },
  PENDING: { label: 'En attente', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.25)', Icon: Clock3 },
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
 * Vue d'ensemble du portail "Inventaire & Logistique" (route index `/inventaire`, montée via
 * <Outlet/> UNIQUEMENT pour OPERATEUR_LOGISTIQUE — voir InventaireLayout.tsx). Décision produit
 * validée (plan d'impact, Option Overview-A) : 4 KPI site-wide, lecture seule, SANS attribution
 * "par agent" dans la liste "Travail du jour" ci-dessous — contrairement à ApurementOverview.tsx,
 * aucune attribution fiable par agent n'existe pour ce flux (ni updateCarteRangementAndStatusRapid
 * ni updateRangementEtFiche ne renseignent de colonne "traité par", voir commentaire de
 * getInventaireLogistiqueOverviewStats côté main).
 * Endpoint KPI : stats:getInventaireOverview → getInventaireLogistiqueOverviewStats
 * (stats.queries.ts), site-scopé via resolveScopedSiteId côté handler (§3 CLAUDE.md) — le
 * siteId envoyé ici n'est qu'indicatif pour SUPER ADMIN (site actuellement sélectionné dans la
 * sidebar), tout autre rôle est de toute façon recadré serveur sur son propre site_id.
 * Endpoint liste paginée "Travail du jour" : stats:getInventaireCardsTodayPaginated →
 * getInventaireLogistiqueCardsTodayPaginated (stats.queries.ts), même cantonnement, même
 * définition du "volume traité" que le KPI "Aujourd'hui" ci-dessus, mais site-wide (tous agents
 * confondus, pas de filtre par agent) — voir le commentaire de cette fonction pour le détail.
 */
export default function InventaireOverview() {
  const { user, activeSiteId } = useAuthStore();
  const [stats, setStats] = useState<InventaireOverviewStats>(EMPTY_STATS);
  const [isLoading, setIsLoading] = useState(true);

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isListLoading, setIsListLoading] = useState(true);
  // Récapitulatif de synchro du "Travail du jour" (badge par ligne + compteurs agrégés) — voir
  // getInventaireLogistiqueCardsTodayPaginated (stats.queries.ts) pour la logique de calcul du
  // statut, portée à l'identique depuis ApurementOverview.tsx.
  const [syncSummary, setSyncSummary] = useState({ synced: 0, pending: 0, error: 0 });

  const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;

  const loadStats = useCallback(async (silent = false) => {
    if (!siteIdToUse) { setStats(EMPTY_STATS); setIsLoading(false); return; }
    try {
      if (!silent) setIsLoading(true);
      const res = await window.api.stats.getInventaireOverview(Number(siteIdToUse));
      if (res) setStats(res);
    } catch (err) {
      console.error("Erreur lors du chargement des statistiques d'inventaire :", err);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [siteIdToUse]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Rafraîchissement discret au retour d'une correction effectuée depuis les onglets SCAN/
  // LOGISTIQUE (mêmes événements 'app:data-updated' déjà écoutés par InventaireLayout.tsx pour
  // ses propres compteurs) : cette page recalcule alors ses KPI en silence (silent=true, pas de
  // flash "Chargement en cours..."), même pattern que ApurementOverview.tsx/AgentQualiteLayout.tsx.
  useEffect(() => {
    const handleDataUpdated = () => { loadStats(true); };
    window.addEventListener('app:data-updated', handleDataUpdated);
    return () => window.removeEventListener('app:data-updated', handleDataUpdated);
  }, [loadStats]);

  // `silent` évite de repasser par isListLoading (donc par l'écran "Chargement en cours...") lors
  // des rappels automatiques en arrière-plan (polling de synchro ci-dessous) : seul le premier
  // chargement / changement de page doit afficher l'état de chargement. Même pattern que
  // ApurementOverview.tsx.
  const loadCardsToday = useCallback(async (silent = false) => {
    if (!siteIdToUse) { setRows([]); setTotal(0); setIsListLoading(false); return; }
    try {
      if (!silent) setIsListLoading(true);
      const res = await window.api.stats.getInventaireCardsTodayPaginated(Number(siteIdToUse), page, PAGE_SIZE);
      setRows(res?.rows || []);
      setTotal(res?.total || 0);
      setSyncSummary(res?.syncSummary || { synced: 0, pending: 0, error: 0 });
    } catch (err) {
      console.error("Erreur lors du chargement du travail d'inventaire du jour :", err);
    } finally {
      if (!silent) setIsListLoading(false);
    }
  }, [siteIdToUse, page]);

  useEffect(() => {
    loadCardsToday();
  }, [loadCardsToday]);

  // Même rafraîchissement discret que ci-dessus (événement 'app:data-updated'), appliqué à la
  // liste "Travail du jour" cette fois.
  useEffect(() => {
    const handleDataUpdated = () => { loadCardsToday(true); };
    window.addEventListener('app:data-updated', handleDataUpdated);
    return () => window.removeEventListener('app:data-updated', handleDataUpdated);
  }, [loadCardsToday]);

  // Rafraîchissement automatique discret du badge de synchro : tant qu'il reste au moins une
  // carte PENDING/ERROR dans les données déjà chargées, on rappelle loadCardsToday (en mode
  // silencieux) toutes les 30s. Dès que tout est synchronisé (pending === 0 && error === 0), le
  // timer s'arrête de lui-même — pas de polling permanent inutile (politique Low-Memory RAM 8 Go,
  // §2 CLAUDE.md). Même pattern que ApurementOverview.tsx.
  useEffect(() => {
    const hasPendingSync = syncSummary.pending > 0 || syncSummary.error > 0;
    if (!hasPendingSync) return;
    const intervalId = setInterval(() => {
      loadCardsToday(true);
    }, 30000);
    return () => clearInterval(intervalId);
  }, [syncSummary.pending, syncSummary.error, loadCardsToday]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <PackageSearch size={20} color="#10b981" />
        <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'white' }}>Vue d'ensemble</h2>
      </div>

      {isLoading ? (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement en cours...</div>
      ) : (
        <>
          {/* KPI: 4 cartes Aujourd'hui / Semaine / Mois / Année — volume de cartes scannées
              et/ou classées, site-wide (voir commentaire de getInventaireLogistiqueOverviewStats
              pour la définition exacte retenue). */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>

            <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(16, 185, 129, 0.01) 100%)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: 16 }}>
              <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)' }}>
                <Activity size={28} />
              </div>
              <div>
                <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{stats.today}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Aujourd'hui</div>
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

          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            Volume de cartes scannées et/ou classées sur le site, tous agents confondus. Ce
            compteur ne distingue pas l'agent à l'origine de chaque action.
          </p>

          {/* Travail du jour : cartes scannées et/ou classées aujourd'hui sur le site, tous
              agents confondus (voir commentaire de tête de fichier — aucune attribution par
              agent n'est disponible pour ce flux, contrairement à ApurementOverview.tsx). */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ClipboardList size={20} color="#10b981" />
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'white' }}>Travail du jour</h2>
              </div>
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
            </div>

            <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
              {isListLoading ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement en cours...</div>
              ) : rows.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <ClipboardList size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
                  Aucune carte scannée ou classée aujourd'hui pour le moment.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Identité</th>
                        <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>N° Sécu</th>
                        <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Rangement</th>
                        <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Statut</th>
                        <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Heure de traitement</th>
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
                          <td style={{ padding: '16px 24px', fontFamily: 'monospace', color: '#6ee7b7' }}>{r.num_secu || '—'}</td>
                          <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>{r.rangement || '—'}</td>
                          <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>{r.statut || '—'}</td>
                          <td style={{ padding: '16px 24px', color: 'var(--text-muted)', fontSize: 13 }}>
                            {r.updated_at ? new Date(r.updated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}
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
        </>
      )}
    </div>
  );
}
