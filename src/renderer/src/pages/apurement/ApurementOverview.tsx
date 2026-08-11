import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Calendar, CalendarDays, Target, ClipboardList, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

const PAGE_SIZE = 20;

interface ApurementStats {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  year: number;
  last7Days?: { dayName: string; count: number }[];
}

const EMPTY_STATS: ApurementStats = { today: 0, yesterday: 0, week: 0, month: 0, year: 0, last7Days: [] };

/**
 * Vue d'ensemble du Portail d'Apurement (rôle OPERATEUR_APUREMENT) :
 * - 4 KPI (Aujourd'hui/Semaine/Mois/Année) : endpoint dédié stats:getApurementStats →
 *   getApurementStats (stats.queries.ts), filtré sur statut='DELIVRE' AND
 *   agent_distributeur=agent connecté AND site_id, comme useVerificationStats, mais indexé sur
 *   `updated_at` (horodatage réel de l'action serveur) et non `date_delivrance` (date du cahier
 *   historique, saisie librement par l'agent — ne reflète pas le moment réel du traitement).
 *   Ne PAS réutiliser useVerificationStats/stats:getVerification ici : ce hook reste correct
 *   pour le portail Vérification (délivrance normale, date_delivrance auto-timestampée), mais
 *   donnerait un KPI "Aujourd'hui" proche de 0 pour l'Apurement.
 * - Liste paginée "Travail du jour" : endpoint stats:getApurementCardsTodayPaginated
 *   (LIMIT/OFFSET borné, politique Low-Memory RAM 8 Go — jamais de chargement complet),
 *   également recalé sur `updated_at`.
 */
export default function ApurementOverview() {
  const { user, activeSiteId } = useAuthStore();
  const [stats, setStats] = useState<ApurementStats>(EMPTY_STATS);

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;

  const loadStats = useCallback(async () => {
    if (!user?.login || !siteIdToUse) { setStats(EMPTY_STATS); return; }
    try {
      const res = await window.api.stats.getApurementStats(user.login, Number(siteIdToUse));
      if (res) setStats(res);
    } catch (err) {
      console.error("Erreur lors du chargement des statistiques d'apurement :", err);
    }
  }, [user?.login, siteIdToUse]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const loadCardsToday = useCallback(async () => {
    if (!user?.login || !siteIdToUse) { setRows([]); setTotal(0); setIsLoading(false); return; }
    try {
      setIsLoading(true);
      const res = await window.api.stats.getApurementCardsTodayPaginated(user.login, Number(siteIdToUse), page, PAGE_SIZE);
      setRows(res?.rows || []);
      setTotal(res?.total || 0);
    } catch (err) {
      console.error("Erreur lors du chargement du travail d'apurement du jour :", err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.login, siteIdToUse, page]);

  useEffect(() => {
    loadCardsToday();
  }, [loadCardsToday]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>

      {/* KPI: 4 cartes Aujourd'hui / Semaine / Mois / Année */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>

        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px', background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.08) 0%, rgba(236, 72, 153, 0.01) 100%)', border: '1px solid rgba(236, 72, 153, 0.2)', borderRadius: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(236, 72, 153, 0.3)' }}>
            <Activity size={28} />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{stats.today}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#ec4899', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Aujourd'hui</div>
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

      {/* Travail du jour : fiches d'émargement historique traitées aujourd'hui par l'agent connecté */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <ClipboardList size={20} color="#ec4899" />
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'white' }}>Travail du jour</h2>
        </div>

        <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
          {isLoading ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement en cours...</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              <ClipboardList size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
              Aucune fiche apurée aujourd'hui pour le moment.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Identité</th>
                    <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>N° Sécu</th>
                    <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Rangement</th>
                    <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Retirant</th>
                    <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Heure d'apurement</th>
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
                      <td style={{ padding: '16px 24px', fontFamily: 'monospace', color: '#f9a8d4' }}>{r.num_secu || '—'}</td>
                      <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>{r.rangement || '—'}</td>
                      <td style={{ padding: '16px 24px' }}>
                        <div style={{ color: 'white', fontSize: 13 }}>{r.nom_retirant || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {r.relation_retirant || ''}{r.num_retirant ? ` · ${r.num_retirant}` : ''}
                        </div>
                      </td>
                      <td style={{ padding: '16px 24px', color: 'var(--text-muted)', fontSize: 13 }}>
                        {r.updated_at ? new Date(r.updated_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}
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

    </div>
  );
}
