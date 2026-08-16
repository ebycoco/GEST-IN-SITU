import React, { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { RefreshCw, Users } from 'lucide-react';
import { toast } from 'react-hot-toast';

/**
 * "Mon Équipe" — Pilotage en lecture seule de l'activité du jour des agents du centre
 * de l'ADMIN_CENTRE connecté (saisie / contrôles & délivrances / distribution & logistique).
 *
 * Duplication volontaire (et non extraction) du pattern de rendu déjà utilisé dans
 * SiteAdminView.tsx (onglet "Pilotage des Activités de Terrain") : ce composant est
 * autonome, verrouillé sur le centre unique de l'ADMIN_CENTRE (pas de sélecteur de
 * centre), et n'expose aucune action destructive (pas de purge, pas de sync globale,
 * pas de bulk upload) — consultation uniquement.
 */

type TeamTabKey = 'saisie' | 'qualite' | 'logistique';

interface TeamRoleTab {
  key: TeamTabKey;
  label: string;
  data: any[];
  description: string;
  colHeader: string;
  noDataText: string;
  colorAccent: string;
  suffix: string;
  countKey: string;
}

export default function TeamActivityView() {
  const { user } = useAuthStore();
  const siteId = user?.site_id;
  const centreId = user?.centre_id;

  const [activeTab, setActiveTab] = useState<TeamTabKey>('saisie');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );

  const [saisieData, setSaisieData] = useState<any[]>([]);
  const [qualiteData, setQualiteData] = useState<any[]>([]);
  const [logistiqueData, setLogistiqueData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [isPullingCards, setIsPullingCards] = useState(false);

  // Indicateur de fraîcheur (même pattern que SiteAdminView.tsx, Point 3) : horodatage
  // local du dernier pull cloud réussi, distinct du watermark serveur
  // t_config['last_downstream_sync_true'] qui reflète la position des données rapatriées,
  // pas l'heure d'exécution du pull.
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [freshnessTick, setFreshnessTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setFreshnessTick(t => t + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const syncFreshnessLabel = useMemo(() => {
    if (!lastSyncAt) return null;
    const diffMin = Math.floor((Date.now() - lastSyncAt.getTime()) / 60000);
    if (diffMin < 1) return "Dernière synchro : à l'instant";
    if (diffMin === 1) return 'Dernière synchro : il y a 1 min';
    return `Dernière synchro : il y a ${diffMin} min`;
    // freshnessTick force le recalcul périodique du libellé relatif ; sa valeur n'est
    // pas utilisée directement, seul son incrément (toutes les 60s) importe.
  }, [lastSyncAt, freshnessTick]);

  // Chargement des 3 statistiques d'équipe, scopées serveur (scopeSiteCentreToSession
  // dans handlers.ts) sur le site + centre réels de la session ADMIN_CENTRE — le
  // centreId envoyé ici n'est qu'indicatif, le serveur l'impose de toute façon.
  const loadTeamStats = async (dateStr?: string) => {
    if (!siteId || !centreId) return;
    setLoading(true);
    try {
      const [saisie, qualite, logistique] = await Promise.all([
        window.api.stats.getSiteSaisieToday(siteId, centreId, undefined, dateStr),
        window.api.stats.getSiteQualiteToday(siteId, centreId, undefined, dateStr),
        window.api.stats.getSiteLogistiqueToday(siteId, centreId, undefined, dateStr)
      ]);
      setSaisieData(saisie || []);
      setQualiteData(qualite || []);
      setLogistiqueData(logistique || []);
    } catch (err) {
      console.error('[TeamActivityView] Erreur de chargement des statistiques équipe:', err);
      toast.error("Erreur lors du chargement de l'activité de l'équipe.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTeamStats(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, centreId, selectedDate]);

  // Pull cloud dupliqué du pattern AdminCentreLayout.tsx (handlePullSiteCards local, non
  // partagé via contexte de route) : ce composant n'a pas accès au handlePullSiteCards
  // interne d'AdminCentreLayout (Outlet sans contexte), d'où la duplication volontaire
  // plutôt qu'une extraction de composant partagé (hors périmètre de cette tâche).
  const handlePullCentreCards = async () => {
    if (!siteId) return;
    setIsPullingCards(true);
    const toastId = toast.loading('☁️ Récupération des cartes depuis le cloud...');
    try {
      const res = await window.api.sync.pullSiteCards(Number(siteId), user);
      if (res.success) {
        toast.success(
          res.count > 0
            ? `✅ Récupération réussie ! ${res.count} carte(s) mise(s) à jour.`
            : '✅ Vos données locales sont déjà à jour.',
          { id: toastId, duration: 4000 }
        );
      } else {
        toast.error(`Échec de récupération : ${res.message || 'Erreur inconnue'}`, { id: toastId, duration: 6000 });
      }
    } catch (err: any) {
      toast.error(`Échec de récupération : ${err.message || err}`, { id: toastId });
    } finally {
      setIsPullingCards(false);
    }
  };

  const handleRefresh = async () => {
    await handlePullCentreCards();
    setLastSyncAt(new Date());
    await loadTeamStats(selectedDate);
  };

  const roleMapping = useMemo<TeamRoleTab[]>(() => [
    {
      key: 'saisie',
      label: '✏️ Performance Saisie',
      data: saisieData,
      description: "Nombre de fiches saisies aujourd'hui par chaque opérateur de saisie de ce centre.",
      colHeader: 'SAISIES DU JOUR',
      noDataText: 'Aucun opérateur de saisie pour ce centre.',
      colorAccent: '#ffd700',
      suffix: 'fiche(s)',
      countKey: 'total_saisies'
    },
    {
      key: 'qualite',
      label: '🛡️ Contrôles & Délivrances',
      data: qualiteData,
      description: "Nombre d'actions enregistrées aujourd'hui par les opérateurs de contrôle qualité et de vérification (délivrances) de ce centre.",
      colHeader: 'ACTIONS DU JOUR',
      noDataText: 'Aucun opérateur de contrôle & conformité pour ce centre.',
      colorAccent: '#a78bfa',
      suffix: 'action(s)',
      countKey: 'total_actions'
    },
    {
      key: 'logistique',
      label: '🚚 Distribution & Logistique',
      data: logistiqueData,
      description: "Nombre de cartes distribuées aujourd'hui par chaque opérateur de distribution & logistique de ce centre.",
      colHeader: 'DISTRIBUTIONS DU JOUR',
      noDataText: 'Aucun opérateur de distribution & logistique pour ce centre.',
      colorAccent: '#34d399',
      suffix: 'carte(s)',
      countKey: 'total_distributions'
    }
  ], [saisieData, qualiteData, logistiqueData]);

  const activeRole = roleMapping.find(r => r.key === activeTab) || roleMapping[0];
  const isBusy = loading || isPullingCards;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: 'white', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users color="#3b82f6" size={24} />
          Mon Équipe
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>
          Activité du jour des agents de votre centre (lecture seule).
        </p>
      </div>

      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {roleMapping.map(item => (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                style={{
                  padding: '7px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'all 0.2s',
                  borderBottom: activeTab === item.key ? '2px solid #ffd700' : '2px solid transparent',
                  color: activeTab === item.key ? 'white' : 'var(--text-muted)',
                }}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Date :</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  color: 'white',
                  padding: '5px 12px',
                  fontSize: 12,
                  outline: 'none',
                  cursor: 'pointer'
                }}
              />
            </div>

            {syncFreshnessLabel && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{syncFreshnessLabel}</span>
            )}

            <button
              onClick={handleRefresh}
              disabled={isBusy}
              className="btn"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, fontSize: 13,
                background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', color: 'white',
                cursor: isBusy ? 'not-allowed' : 'pointer', opacity: isBusy ? 0.6 : 1, transition: 'all 0.2s'
              }}
              onMouseOver={(e) => { if (!isBusy) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
              onMouseOut={(e) => { if (!isBusy) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
            >
              <RefreshCw size={16} style={{ animation: isBusy ? 'spin 1.5s linear infinite' : 'none' }} />
              {isBusy ? 'Actualisation...' : 'Actualiser'}
            </button>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <p style={{ margin: '0 0 12px 0', fontSize: 12, color: 'var(--text-muted)' }}>{activeRole.description}</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>IDENTIFIANT</th>
                <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>NOM COMPLET</th>
                <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>{activeRole.colHeader}</th>
              </tr>
            </thead>
            <tbody>
              {activeRole.data.map((agent: any) => {
                const countValue = agent[activeRole.countKey] || 0;
                return (
                  <tr key={agent.id_user} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '14px 16px', fontWeight: 700, color: 'white' }}>{agent.login}</td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{agent.nom_user} {agent.prenom_user}</td>
                    <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 900, color: countValue > 0 ? activeRole.colorAccent : 'var(--text-muted)', fontSize: 15 }}>
                      {countValue} {activeRole.suffix}
                    </td>
                  </tr>
                );
              })}
              {activeRole.data.length === 0 && (
                <tr><td colSpan={3} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>{activeRole.noDataText}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
