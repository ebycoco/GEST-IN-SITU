import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, AlertTriangle, Fingerprint, Calendar, Activity, RefreshCw, ClipboardList, ChevronLeft, ChevronRight, Wrench, GitMerge } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { useQualityUIStore } from '../../../stores/qualityUIStore';

// Pagination "Travail du jour" : même taille de page (20 lignes) que les autres portails
// (AgentVerification/views/Overview.tsx, ApurementOverview.tsx), pour rester cohérent.
const QUALITE_WORK_PAGE_SIZE = 20;

// Présentation par type d'action d'audit Qualité (QUALITE_CORRECTION/QUALITE_FUSION — voir
// getQualiteActionsTodayPaginated, stats.queries.ts). QUALITE_NETTOYAGE a été retiré (correctif
// P1 agent-13-qa-terrain-tester, 2026-09-05) : aucune UI n'appelle qualite:supprimerIncoherences,
// ce badge ne pouvait donc jamais s'afficher en usage réel — voir le commentaire de
// getQualiteActionsTodayPaginated pour le détail. QUALITE_MASSE n'apparaît jamais ici non plus :
// exclue côté requête (alerte méta dupliquée, pas une action physique).
const QUALITE_ACTION_META: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  QUALITE_CORRECTION: { label: 'Correction', color: '#3742fa', Icon: Wrench },
  QUALITE_FUSION: { label: 'Fusion', color: '#ff4757', Icon: GitMerge }
};

// `details` (t_audit_log) est toujours un JSON valide écrit par logAudit() (handlers.ts) —
// JSON.parse protégé quand même par précaution défensive (jamais de crash d'affichage sur une
// ligne d'audit historique/inattendue).
function parseQualiteAuditDetails(raw: string): any {
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

// Rendu du détail par type d'action. `noms`/`prenoms` proviennent de la jointure best-effort
// t_cartes faite côté requête (getQualiteActionsTodayPaginated) — jamais garantie (cf.
// commentaire de cette fonction pour le cas légitime où la jointure ne retrouve rien).
function renderQualiteActionDetail(action: string, details: any, noms?: string | null, prenoms?: string | null): React.ReactNode {
  const ficheLabel = (idCarte: number | string | undefined) => {
    const identite = `${noms || ''} ${prenoms || ''}`.trim();
    if (identite) return identite;
    return idCarte !== undefined && idCarte !== null ? `Fiche #${idCarte}` : 'Fiche inconnue';
  };

  if (action === 'QUALITE_CORRECTION') {
    return (
      <>
        <div style={{ color: 'white', fontWeight: 600 }}>{ficheLabel(details.id_carte)}</div>
        <div style={{ marginTop: 2 }}>
          <span style={{ color: 'var(--text-muted)' }}>{details.champ_corrige || '—'} : </span>
          {details.valeur_avant || '—'} → <span style={{ color: '#3742fa', fontWeight: 600 }}>{details.valeur_apres || '—'}</span>
        </div>
      </>
    );
  }
  if (action === 'QUALITE_FUSION') {
    return (
      <>
        <div style={{ color: 'white', fontWeight: 600 }}>
          Fusion vers {ficheLabel(details.id_carte_cible)} (source #{details.id_carte_source ?? '—'})
        </div>
        <div style={{ marginTop: 2, color: 'var(--text-muted)' }}>
          Champs fusionnés : {Array.isArray(details.champs_fusionnes) && details.champs_fusionnes.length > 0 ? details.champs_fusionnes.join(', ') : 'aucun'}
        </div>
      </>
    );
  }
  return <span style={{ color: 'var(--text-muted)' }}>—</span>;
}

interface QualityStats {
  doublons: number;
  doublonsProbables: number;
  datesInvalides: number;
  sansSecu: number;
  sansRangement: number;
  sansNom: number;
  sansPrenom: number;
  datesVides: number;
  autresAnomalies: number;
}

function QualityCounter({
  label, value, icon: Icon, accent, sublabel, onClick
}: {
  label: string; value: number; icon: React.ElementType; accent: string; sublabel: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, minWidth: 240,
        background: 'rgba(255,255,255,0.01)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 20, padding: '24px 28px',
        cursor: 'pointer', textAlign: 'left',
        transition: 'all 0.2s ease', position: 'relative', overflow: 'hidden'
      }}
      className="hover-premium"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 14,
          background: `${accent}18`, border: `1px solid ${accent}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: accent
        }}>
          <Icon size={20} />
        </div>
        {value > 0 ? (
          <span style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1,
            color: accent, background: `${accent}15`, border: `1px solid ${accent}25`,
            padding: '3px 8px', borderRadius: 20
          }}>À traiter</span>
        ) : (
          <span style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1,
            color: '#2ed573', background: 'rgba(46,213,115,0.1)', border: '1px solid rgba(46,213,115,0.2)',
            padding: '3px 8px', borderRadius: 20
          }}>✓ OK</span>
        )}
      </div>

      <div style={{
        fontSize: 42, fontWeight: 900, color: value > 0 ? accent : '#2ed573',
        lineHeight: 1, marginBottom: 6, letterSpacing: '-2px', fontVariantNumeric: 'tabular-nums'
      }}>
        {value.toLocaleString('fr')}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'white', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.3 }}>{sublabel}</div>
    </button>
  );
}

export default function Overview() {
  const navigate = useNavigate();
  const { user, activeSiteId } = useAuthStore();
  const siteIdToUse = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? 1;
  const { refreshTrigger, setIsFetchingQuery } = useQualityUIStore();

  const [stats, setStats] = useState<QualityStats>({
    doublons: 0, doublonsProbables: 0, datesInvalides: 0,
    sansSecu: 0, sansRangement: 0, sansNom: 0, sansPrenom: 0,
    datesVides: 0, autresAnomalies: 0
  });
  const [statsLoading, setStatsLoading] = useState(true);

  // Récapitulatif agrégé de synchro (site-wide, pas de "travail du jour" par agent possible ici
  // — voir commentaire de getSiteSyncSummary dans stats.queries.ts). Pas de nouveau timer/polling :
  // branché sur le même écouteur 'app:data-updated' que dirtyCartesCount dans
  // AgentQualiteLayout.tsx (ligne ~42-46), dispatché après chaque correction/fusion/suppression
  // qualité (CorrectionSidePanel.onSave, DoublonsView, MissingDataView, InvalidFormatView).
  const [syncSummary, setSyncSummary] = useState({ pending: 0, error: 0 });

  // "Travail du jour" (nouveau) : actions QUALITE_CORRECTION/QUALITE_FUSION de
  // l'agent connecté aujourd'hui (t_audit_log via getQualiteActionsTodayPaginated). Pagination
  // 20/page, même style que AgentVerification/views/Overview.tsx. Pas de badge de synchro : ces
  // entrées d'audit ne passent jamais par l'outbox (t_audit_log n'est pas synchronisée).
  const [workRows, setWorkRows] = useState<any[]>([]);
  const [workTotal, setWorkTotal] = useState(0);
  const [workPage, setWorkPage] = useState(0);
  const [workLoading, setWorkLoading] = useState(true);

  // Libère la sidebar et l'interface globale (agent-14 : cette page ne levait jamais l'overlay
  // "Chargement sécurisé en cours..." — MainLayout.tsx — laissant tout compte OPERATEUR_QUALITE
  // figé (opacité réduite, interactions bloquées) jusqu'au filet de sécurité de secours à 10s).
  useEffect(() => {
    useAuthStore.getState().setInitialDataLoading(false);
  }, []);

  const loadSyncSummary = useCallback(async () => {
    try {
      const res = await window.api.stats.getSiteSyncSummary(siteIdToUse);
      setSyncSummary(res || { pending: 0, error: 0 });
    } catch (error) {
      console.error('Erreur lors du chargement du récapitulatif de synchro qualité :', error);
    }
  }, [siteIdToUse]);

  useEffect(() => {
    loadSyncSummary();
  }, [loadSyncSummary]);

  // `silent` évite de repasser par workLoading (donc par l'état "Chargement en cours...") lors
  // des rappels déclenchés par handleDataUpdated ci-dessous : seul le premier chargement / le
  // changement de page doit afficher l'état de chargement.
  const loadQualiteActionsToday = useCallback(async (silent = false) => {
    try {
      if (!silent) setWorkLoading(true);
      const res = await window.api.stats.getQualiteActionsTodayPaginated(workPage, QUALITE_WORK_PAGE_SIZE);
      setWorkRows(res?.rows || []);
      setWorkTotal(res?.total || 0);
    } catch (error) {
      console.error('Erreur lors du chargement du travail qualité du jour :', error);
    } finally {
      if (!silent) setWorkLoading(false);
    }
  }, [workPage]);

  useEffect(() => {
    loadQualiteActionsToday();
  }, [loadQualiteActionsToday]);

  useEffect(() => {
    // Ajout de loadQualiteActionsToday() dans ce handler EXISTANT (pas de nouveau listener
    // 'app:data-updated', §CLAUDE.md Low-Memory) : dispatché après chaque correction/fusion/
    // suppression qualité (CorrectionSidePanel.onSave, DoublonsView, MissingDataView,
    // InvalidFormatView), donc le bon moment pour rafraîchir aussi "Travail du jour". Rappel
    // silencieux (pas de flash de "Chargement en cours...") : cohérent avec loadSyncSummary
    // ci-dessus, qui ne bascule pas non plus d'indicateur de chargement dédié sur cet événement.
    const handleDataUpdated = () => { loadSyncSummary(); loadQualiteActionsToday(true); };
    window.addEventListener('app:data-updated', handleDataUpdated);
    return () => window.removeEventListener('app:data-updated', handleDataUpdated);
  }, [loadSyncSummary, loadQualiteActionsToday]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setIsFetchingQuery(true);
    try {
      const rawStats = await window.api.stats.get(siteIdToUse);
      setStats({
        datesInvalides: rawStats.dates_invalides || 0,
        doublons: rawStats.doublons_stricts || 0,
        doublonsProbables: rawStats.doublons_probables || 0,
        sansSecu: rawStats.sans_num_secu || 0,
        sansRangement: rawStats.sans_rangement || 0,
        sansNom: rawStats.sans_nom || 0,
        sansPrenom: rawStats.sans_prenom || 0,
        datesVides: rawStats.dates_naissance_vide || 0,
        autresAnomalies: rawStats.autres_anomalies || 0
      });
    } catch (error) {
      console.error('Erreur lors du chargement des statistiques de qualité:', error);
    } finally {
      setStatsLoading(false);
      setIsFetchingQuery(false);
    }
  }, [siteIdToUse, refreshTrigger, setIsFetchingQuery]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  if (statsLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16 }}>
        <Activity className="animate-spin" size={48} color="#FFE600" />
        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Analyse des anomalies en cours...</span>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: 'white', margin: 0 }}>Statistiques Globales des Anomalies</h2>

      {(syncSummary.pending > 0 || syncSummary.error > 0) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', borderRadius: 10,
          background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)',
          color: '#93c5fd', fontSize: 13, fontWeight: 600
        }}>
          <RefreshCw size={16} style={{ flexShrink: 0 }} />
          {syncSummary.pending.toLocaleString('fr')} carte{syncSummary.pending > 1 ? 's' : ''} en attente de synchro
          {syncSummary.error > 0 && (
            <span style={{ color: '#f87171', fontWeight: 800 }}>
              , dont {syncSummary.error.toLocaleString('fr')} en échec
            </span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <QualityCounter
          label="Doublons Stricts"
          value={stats.doublons}
          icon={Users}
          accent="#ff4757"
          sublabel="Même Nom, Prénom et Date de Naissance"
          onClick={() => navigate('/agent-qualite/doublons')}
        />
        <QualityCounter
          label="Doublons Probables"
          value={stats.doublonsProbables}
          icon={AlertTriangle}
          accent="#ffa502"
          sublabel="Même N° de Sécu ou similarité de nom"
          onClick={() => navigate('/agent-qualite/doublons')}
        />
        <QualityCounter
          label="Sans N° Sécu"
          value={stats.sansSecu}
          icon={Fingerprint}
          accent="#3742fa"
          sublabel="Numéro de Sécurité Sociale manquant"
          onClick={() => navigate('/agent-qualite/manquants')}
        />
        <QualityCounter
          label="Sans Rangement"
          value={stats.sansRangement}
          icon={AlertTriangle}
          accent="#5352ed"
          sublabel="Information de rangement manquante"
          onClick={() => navigate('/agent-qualite/manquants')}
        />
        <QualityCounter
          label="Sans Nom / Prénom"
          value={stats.sansNom + stats.sansPrenom}
          icon={AlertTriangle}
          accent="#eccc68"
          sublabel="Identité incomplète"
          onClick={() => navigate('/agent-qualite/manquants')}
        />
        <QualityCounter
          label="Dates Invalides ou Absentes"
          value={stats.datesInvalides}
          icon={Calendar}
          accent="#ff6348"
          sublabel="Format 1900-01-01 à corriger"
          onClick={() => navigate('/agent-qualite/invalides')}
        />
        <QualityCounter
          label="Date de Naissance Vide"
          value={stats.datesVides || 0}
          icon={Calendar}
          accent="#f43f5e"
          sublabel="Champs date de naissance non renseignés"
          onClick={() => navigate('/agent-qualite/manquants')}
        />
        <QualityCounter
          label="Autres Anomalies"
          value={stats.autresAnomalies || 0}
          icon={AlertTriangle}
          accent="#6366f1"
          sublabel="Anomalies résiduelles à corriger"
          onClick={() => navigate('/agent-qualite/anomalies-brutes')}
        />
      </div>

      {/* Travail du jour : actions de correction/fusion effectuées aujourd'hui par
          l'agent connecté (t_audit_log, cf. getQualiteActionsTodayPaginated). */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <ClipboardList size={20} color="#6366f1" />
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'white' }}>Travail du jour</h2>
        </div>

        <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
          {workLoading ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement en cours...</div>
          ) : workRows.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
              <ClipboardList size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
              Aucune action qualité effectuée aujourd'hui pour le moment.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Action</th>
                    <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Détail</th>
                    <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Heure</th>
                  </tr>
                </thead>
                <tbody>
                  {workRows.map((r) => {
                    // Fallback générique (correctif P1, 2026-09-05) : QUALITE_NETTOYAGE n'étant
                    // plus une clé de QUALITE_ACTION_META ni renvoyé par la requête (filtrée sur
                    // QUALITE_CORRECTION/QUALITE_FUSION uniquement), ce cas ne devrait jamais se
                    // présenter — conservé par défensivité si une action inattendue apparaissait.
                    const meta = QUALITE_ACTION_META[r.action] || { label: r.action, color: '#6366f1', Icon: ClipboardList };
                    const details = parseQualiteAuditDetails(r.details);
                    const Icon = meta.Icon;
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                        <td style={{ padding: '16px 24px' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}30`,
                            padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 800,
                            textTransform: 'uppercase', letterSpacing: 0.5
                          }}>
                            <Icon size={13} /> {meta.label}
                          </span>
                        </td>
                        <td style={{ padding: '16px 24px', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.5 }}>
                          {renderQualiteActionDetail(r.action, details, r.noms, r.prenoms)}
                        </td>
                        <td style={{ padding: '16px 24px', color: 'var(--text-muted)', fontSize: 13 }}>
                          {r.date_creation ? new Date(r.date_creation).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {workTotal > QUALITE_WORK_PAGE_SIZE && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, padding: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
              <button
                onClick={() => setWorkPage(p => Math.max(0, p - 1))}
                disabled={workPage === 0}
                className="btn-outline"
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: workPage === 0 ? 'transparent' : 'rgba(255,255,255,0.05)', color: workPage === 0 ? 'var(--text-muted)' : 'white', cursor: workPage === 0 ? 'not-allowed' : 'pointer' }}
              >
                <ChevronLeft size={16} /> Précédent
              </button>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Page {workPage + 1} sur {Math.max(1, Math.ceil(workTotal / QUALITE_WORK_PAGE_SIZE))}
              </span>
              <button
                onClick={() => setWorkPage(p => (p + 1 < Math.ceil(workTotal / QUALITE_WORK_PAGE_SIZE) ? p + 1 : p))}
                disabled={workPage + 1 >= Math.ceil(workTotal / QUALITE_WORK_PAGE_SIZE)}
                className="btn-outline"
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: workPage + 1 >= Math.ceil(workTotal / QUALITE_WORK_PAGE_SIZE) ? 'transparent' : 'rgba(255,255,255,0.05)', color: workPage + 1 >= Math.ceil(workTotal / QUALITE_WORK_PAGE_SIZE) ? 'var(--text-muted)' : 'white', cursor: workPage + 1 >= Math.ceil(workTotal / QUALITE_WORK_PAGE_SIZE) ? 'not-allowed' : 'pointer' }}
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
