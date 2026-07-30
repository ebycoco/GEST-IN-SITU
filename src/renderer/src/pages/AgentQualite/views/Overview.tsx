import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, AlertTriangle, Fingerprint, Calendar, Activity } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { useQualityUIStore } from '../../../stores/qualityUIStore';

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
    </div>
  );
}
