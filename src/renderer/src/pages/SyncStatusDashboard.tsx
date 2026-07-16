import React, { useState, useEffect } from 'react';
import { 
  RefreshCw, Database, AlertCircle, CheckCircle2, 
  Wifi, WifiOff, ShieldAlert, Lock, Terminal, Heart, Clock
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { confirmService } from '../components/confirmService';

interface SyncError {
  id: number;
  action: string;
  details: string;
  timestamp: string;
}

export default function SyncStatusDashboard() {
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [downstreamProgress, setDownstreamProgress] = useState<number>(-1);
  const [status, setStatus] = useState<{
    state: 'ONLINE' | 'OFFLINE';
    lastSync: string;
    queueCount: number;
    outboxCount: number;
    errors: SyncError[];
  }>({
    state: 'OFFLINE',
    lastSync: 'Jamais',
    queueCount: 0,
    outboxCount: 0,
    errors: []
  });

  const loadStatus = async (showToast = false, silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (window.api?.sync?.getStatus) {
        const res = await window.api.sync.getStatus();
        setStatus({
          state: (res.state as 'ONLINE' | 'OFFLINE') || 'OFFLINE',
          lastSync: res.lastSync || 'Jamais',
          queueCount: res.queueCount !== undefined ? res.queueCount : 0,
          outboxCount: res.outboxCount !== undefined ? res.outboxCount : 0,
          errors: res.errors || []
        });
        if (showToast) {
          toast.success("Indicateurs mis à jour en temps réel.");
        }
      }
    } catch (err) {
      console.error("Impossible de récupérer le statut de synchronisation:", err);
      if (showToast) {
        toast.error("Échec de la mise à jour des indicateurs.");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();

    const interval = setInterval(() => {
      loadStatus(false, true); // Actualisation silencieuse toutes les 5 secondes
    }, 5000);

    // S'inscrire aux notifications temps réel envoyées par le Main Process
    let unsubscribe: (() => void) | undefined;
    if (window.api?.sync?.onStatusChanged) {
      unsubscribe = window.api.sync.onStatusChanged((newStatus: any) => {
        setStatus((prev) => ({
          ...prev,
          state: (newStatus.state as 'ONLINE' | 'OFFLINE') || prev.state,
          lastSync: newStatus.lastSync || prev.lastSync,
          queueCount: newStatus.queueCount !== undefined ? newStatus.queueCount : prev.queueCount,
          outboxCount: newStatus.outboxCount !== undefined ? newStatus.outboxCount : prev.outboxCount,
          errors: newStatus.errors || prev.errors
        }));
      });
    }

    let unsubscribeProgress: (() => void) | undefined;
    if (window.api?.sync?.onDownstreamProgress) {
      unsubscribeProgress = window.api.sync.onDownstreamProgress((payload) => {
        const progress = payload.progress;
        setDownstreamProgress(progress);
        if (progress >= 100) {
          setTimeout(() => {
            setDownstreamProgress(-1);
          }, 2000);
        }
      });
    }

    return () => {
      clearInterval(interval);
      if (unsubscribe) unsubscribe();
      if (unsubscribeProgress) unsubscribeProgress();
    };
  }, []);

  const handleForceSync = async () => {
    if (isSyncing) return;

    const isConfirmed = await confirmService.confirm({
      title: "Synchronisation Globale Forcée",
      message: "Voulez-vous forcer un cycle complet de synchronisation (montante & descendante) avec Supabase Cloud ?",
      isDanger: false,
      requirePassword: true,
      actionName: "Forcer la synchronisation manuelle"
    });

    if (!isConfirmed) return;

    setIsSyncing(true);
    const toastId = toast.loading("Synchronisation bidirectionnelle en cours...");
    try {
      if (window.api?.sync?.force) {
        const res = await window.api.sync.force();
        if (res && res.success) {
          toast.success("✅ Synchronisation effectuée avec succès !", { id: toastId });
        } else {
          toast.error("⚠️ Synchronisation terminée avec des avertissements.", { id: toastId });
        }
      }
      await loadStatus();
    } catch (err: any) {
      toast.error(`❌ Échec de la synchronisation : ${err.message || err}`, { id: toastId });
    } finally {
      setIsSyncing(false);
    }
  };

  const isOnline = status.state === 'ONLINE';

  // Calculer la santé de la synchronisation basée sur le réseau et la latence
  const getHealthStatus = () => {
    if (!isOnline) {
      return { 
        label: 'HORS-LIGNE', 
        desc: 'Aucune connexion avec le serveur cloud', 
        color: '#f87171', 
        bg: 'rgba(248, 113, 113, 0.1)', 
        border: 'rgba(248, 113, 113, 0.3)',
        pulse: false 
      };
    }
    if (status.lastSync === 'Jamais') {
      return { 
        label: 'EN ATTENTE', 
        desc: 'Première synchronisation en attente', 
        color: '#fbbf24', 
        bg: 'rgba(251, 191, 36, 0.1)', 
        border: 'rgba(251, 191, 36, 0.3)',
        pulse: true 
      };
    }

    try {
      const lastSyncDate = new Date(status.lastSync);
      if (isNaN(lastSyncDate.getTime())) {
        return { 
          label: 'INCONNU', 
          desc: 'Statut de latence indéterminé', 
          color: '#a78bfa', 
          bg: 'rgba(167, 139, 250, 0.1)', 
          border: 'rgba(167, 139, 250, 0.3)',
          pulse: false 
        };
      }

      const diffMs = new Date().getTime() - lastSyncDate.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 10) {
        return { 
          label: 'OPTIMALE', 
          desc: `Dernière synchro il y a ${diffMins} min`, 
          color: '#34d399', 
          bg: 'rgba(52, 211, 153, 0.1)', 
          border: 'rgba(52, 211, 153, 0.3)',
          pulse: false 
        };
      } else if (diffMins < 30) {
        return { 
          label: 'CORRECTE', 
          desc: `Dernière synchro il y a ${diffMins} min`, 
          color: '#fbbf24', 
          bg: 'rgba(251, 191, 36, 0.1)', 
          border: 'rgba(251, 191, 36, 0.3)',
          pulse: false 
        };
      } else {
        return { 
          label: 'DÉGRADÉE', 
          desc: `Latence élevée (${diffMins} min depuis la dernière synchro)`, 
          color: '#f87171', 
          bg: 'rgba(248, 113, 113, 0.1)', 
          border: 'rgba(248, 113, 113, 0.3)',
          pulse: true 
        };
      }
    } catch {
      return { 
        label: 'ERREUR', 
        desc: 'Calcul de latence impossible', 
        color: '#ef4444', 
        bg: 'rgba(239, 68, 68, 0.1)', 
        border: 'rgba(239, 68, 68, 0.3)',
        pulse: true 
      };
    }
  };

  const health = getHealthStatus();

  const formatLastSync = (dateStr: string) => {
    if (!dateStr || dateStr === 'Jamais') return 'Jamais';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString('fr-FR');
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: '100vh', overflowY: 'auto', padding: '24px 32px 80px' }}>
      
      {/* Styles injectés localement pour les effets Plein Soleil et animations */}
      <style dangerouslySetInnerHTML={{ __html: `
        .glass-card-soleil {
          background: rgba(26, 31, 74, 0.45);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 24px;
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), 
                      box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), 
                      border-color 0.25s ease;
        }
        .glass-card-soleil:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3), 0 0 15px rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.15);
        }
        .btn-refresh-soleil {
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
        .btn-refresh-soleil:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.15);
          border-color: rgba(255, 255, 255, 0.25);
        }
        .btn-refresh-soleil:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn-sync-soleil {
          background: linear-gradient(135deg, #ffd700 0%, #d4af37 100%);
          border: none;
          color: #080b20;
          padding: 10px 20px;
          border-radius: 10px;
          font-weight: 800;
          font-size: 13px;
          letter-spacing: 0.03em;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 14px rgba(255, 215, 0, 0.25);
        }
        .btn-sync-soleil:hover:not(:disabled) {
          background: linear-gradient(135deg, #ffe033 0%, #e6c242 100%);
          box-shadow: 0 6px 20px rgba(255, 215, 0, 0.4);
          transform: translateY(-1px);
        }
        .btn-sync-soleil:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          box-shadow: none;
        }
        .spin-animation {
          animation: spin-smooth 1s linear infinite;
        }
        .pulse-animation {
          animation: pulse-glow-sync 2.5s infinite ease-in-out;
        }
        .badge-pulse {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-right: 6px;
        }
        .badge-pulse-active {
          animation: pulse-dot 1.5s infinite;
        }
        .table-soleil {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
        }
        .table-soleil th {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        }
        .table-soleil td {
          font-size: 13px;
          padding: 14px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          color: var(--text-secondary);
          vertical-align: middle;
        }
        .table-soleil tr {
          transition: background-color 0.15s ease;
        }
        .table-soleil tr:hover {
          background: rgba(255, 255, 255, 0.02);
        }
        @keyframes spin-smooth {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse-glow-sync {
          0% { box-shadow: 0 0 4px rgba(108, 99, 255, 0.1), 0 4px 16px rgba(0,0,0,0.3); border-color: rgba(108, 99, 255, 0.08); }
          50% { box-shadow: 0 0 16px rgba(108, 99, 255, 0.3), 0 4px 16px rgba(0,0,0,0.3); border-color: rgba(108, 99, 255, 0.3); }
          100% { box-shadow: 0 0 4px rgba(108, 99, 255, 0.1), 0 4px 16px rgba(0,0,0,0.3); border-color: rgba(108, 99, 255, 0.08); }
        }
        @keyframes pulse-dot {
          0% { transform: scale(0.9); opacity: 0.6; }
          50% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(0.9); opacity: 0.6; }
        }
      `}} />
      
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'linear-gradient(135deg, #ffd700 0%, #b8860b 100%)', width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(255, 215, 0, 0.2)' }}>
              <RefreshCw size={18} color="black" className={isSyncing ? 'spin-animation' : ''} />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>Monitoring Synchronisation</h2>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 48, margin: 0 }}>Suivi en temps réel de l'Outbox locale et de l'état de connexion Supabase Cloud.</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Bouton de rafraîchissement local */}
          <button 
            className="btn-refresh-soleil"
            disabled={loading || isSyncing}
            onClick={() => loadStatus(true)}
          >
            <RefreshCw size={16} className={loading ? 'spin-animation' : ''} />
            <span>RAFRAÎCHIR</span>
          </button>

          {/* Bouton de synchronisation globale */}
          <button 
            className="btn-sync-soleil"
            disabled={isSyncing || !isOnline}
            onClick={handleForceSync}
          >
            <RefreshCw size={16} className={isSyncing ? 'spin-animation' : ''} />
            <span>{isSyncing ? 'SYNCHRONISATION...' : 'SYNCHRONISER MAINTENANT'}</span>
          </button>
        </div>
      </div>

      {/* Widgets Principaux (3 colonnes) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
        
        {/* État de Connexion & Santé */}
        <div className={`glass-card-soleil ${health.pulse ? 'pulse-animation' : ''}`} style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ 
            background: isOnline ? 'rgba(52, 211, 153, 0.1)' : 'rgba(248, 113, 113, 0.1)', 
            border: isOnline ? '1px solid rgba(52, 211, 153, 0.2)' : '1px solid rgba(248, 113, 113, 0.2)',
            width: 46, height: 46, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' 
          }}>
            {isOnline ? <Wifi size={22} color="#34d399" /> : <WifiOff size={22} color="#f87171" />}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Statut Connexion</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: isOnline ? '#34d399' : '#f87171' }}>
                {isOnline ? 'CONNECTÉ' : 'HORS-LIGNE'}
              </span>
              <span style={{ 
                background: health.bg, 
                color: health.color, 
                border: `1px solid ${health.border}`,
                padding: '2px 8px', 
                borderRadius: 20, 
                fontSize: 10, 
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center'
              }}>
                <span className={`badge-pulse ${health.pulse ? 'badge-pulse-active' : ''}`} style={{ backgroundColor: health.color }}></span>
                {health.label}
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{health.desc}</span>
          </div>
        </div>

        {/* Compteur Outbox (t_outbox) */}
        <div className="glass-card-soleil" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ 
            background: 'rgba(255, 215, 0, 0.1)', 
            border: '1px solid rgba(255, 215, 0, 0.2)',
            width: 46, height: 46, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' 
          }}>
            <Database size={22} color="#ffd700" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Outbox Locale (File Montante)</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
              {status.outboxCount} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>opérations</span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Mises à jour prêtes à l'envoi cloud</span>
          </div>
        </div>

        {/* Compteur File d'attente (t_sync_queue) */}
        <div className="glass-card-soleil" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ 
            background: 'rgba(108, 99, 255, 0.1)', 
            border: '1px solid rgba(108, 99, 255, 0.2)',
            width: 46, height: 46, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' 
          }}>
            <RefreshCw size={22} color="var(--accent-primary)" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>File d'attente (Downstream)</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
              {status.queueCount} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>cartes</span>
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Cartes restantes à synchroniser</span>
          </div>
        </div>

      </div>

      {/* Détails complémentaires */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 20, flex: 1, minHeight: 0 }}>
        
        {/* Informations de synchronisation */}
        <div className="glass-card-soleil" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: 12 }}>
            <Clock size={16} color="#ffd700" />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Paramètres Moteur</h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Dernière Synchro :</span>
              <span style={{ fontWeight: 600, color: 'white' }}>{formatLastSync(status.lastSync)}</span>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Réseau local :</span>
              <span style={{ fontWeight: 600, color: isOnline ? '#34d399' : '#f87171' }}>
                {isOnline ? 'Actif' : 'Indisponible'}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 8 }}>
              <span style={{ color: 'var(--text-muted)' }}>Intervalle automatique :</span>
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>5 min à 30 min (Backoff)</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 4 }}>
              <span style={{ color: 'var(--text-muted)' }}>Base locale :</span>
              <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>SQLite WAL + FTS5</span>
            </div>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.02)', padding: 14, borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginTop: 'auto' }}>
            <Terminal size={14} style={{ marginBottom: 6, display: 'block', color: '#ffd700' }} />
            Le moteur applique un Backoff Exponentiel allant de 5 à 30 minutes. Chaque modification locale est immédiatement enfilée en Outbox et transmise dès que le réseau redevient disponible.
          </div>
        </div>

        {/* Historique des Erreurs / Anomalies */}
        <div className="glass-card-soleil" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '24px 24px 16px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <ShieldAlert size={18} color="#f87171" />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Dernières anomalies détectées (t_logs)</h3>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {status.errors.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, height: '100%', minHeight: 200, color: 'var(--text-muted)', fontSize: 13 }}>
                <CheckCircle2 size={32} color="#34d399" />
                <span>Aucune anomalie détectée dans les journaux système.</span>
              </div>
            ) : (
              <table className="table-soleil">
                <thead>
                  <tr>
                    <th style={{ width: '20%' }}>Action</th>
                    <th style={{ width: '25%' }}>Date / Heure</th>
                    <th style={{ width: '40%' }}>Détails</th>
                    <th style={{ width: '15%' }}>Gravité</th>
                  </tr>
                </thead>
                <tbody>
                  {status.errors.map((err) => {
                    const isWarning = err.action.toUpperCase().includes('WARN') || err.action.toUpperCase().includes('WARNING') || err.action.toUpperCase().includes('LIMIT');
                    const badgeText = isWarning ? 'WARN' : 'ERROR';
                    const badgeColor = isWarning ? '#fbbf24' : '#f87171';
                    const badgeBg = isWarning ? 'rgba(251, 191, 36, 0.1)' : 'rgba(248, 113, 113, 0.1)';
                    const badgeBorder = isWarning ? 'rgba(251, 191, 36, 0.2)' : 'rgba(248, 113, 113, 0.2)';

                    return (
                      <tr key={err.id}>
                        <td style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 12 }}>
                          {err.action}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {new Date(err.timestamp).toLocaleString('fr-FR')}
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                          {err.details}
                        </td>
                        <td>
                          <span style={{
                            background: badgeBg,
                            color: badgeColor,
                            border: `1px solid ${badgeBorder}`,
                            padding: '3px 8px',
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: '0.05em'
                          }}>
                            {badgeText}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>

      {/* Bouclier global anti-clics et curseur de chargement */}
      {(isSyncing) && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 99999,
          backgroundColor: 'rgba(5, 7, 12, 0.65)',
          backdropFilter: 'blur(4px)',
          cursor: 'wait',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 16,
          pointerEvents: 'auto'
        }}>
          <div style={{ position: 'relative', width: 64, height: 64 }}>
            <div style={{ 
              border: '4px solid rgba(255,255,255,0.1)', 
              borderTop: '4px solid #FFE600', 
              borderRadius: '50%', 
              width: '100%', 
              height: '100%', 
              animation: 'spin 1s linear infinite' 
            }} />
            {isSyncing && downstreamProgress >= 0 && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 800,
                color: '#60a5fa'
              }}>
                {downstreamProgress}%
              </div>
            )}
          </div>
          <span style={{ color: 'white', fontWeight: 700, fontSize: 14, letterSpacing: '0.5px' }}>
            {isSyncing && downstreamProgress >= 0 
              ? `Récupération des cartes... (${downstreamProgress}%)`
              : 'Synchronisation globale en cours...'}
          </span>
        </div>
      )}

    </div>
  );
}
