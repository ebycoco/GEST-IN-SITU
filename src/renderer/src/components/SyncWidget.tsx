import { useState, useEffect } from 'react';
import { RefreshCw, Cloud, CloudOff, CloudLightning } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCloudActionGuard } from '../hooks/useCloudActionGuard';

export default function SyncWidget() {
  const [syncStatus, setSyncStatus] = useState<{
    state: string;
    lastSync: string;
    queueCount: number;
  }>({
    state: 'OFFLINE',
    lastSync: 'Jamais',
    queueCount: 0
  });

  const [isSyncing, setIsSyncing] = useState(false);
  const cloudGuard = useCloudActionGuard();

  // Charger le statut initial
  useEffect(() => {
    const fetchInitialStatus = async () => {
      try {
        const status = await window.api.sync.getStatus();
        setSyncStatus(status);
      } catch (err) {
        console.error('Failed to get initial sync status:', err);
      }
    };

    fetchInitialStatus();

    // Écouter les changements notifiés par le Main Process
    const unsubscribe = window.api.sync.onStatusChanged((newStatus: any) => {
      setSyncStatus(newStatus);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleForceSync = async () => {
    return cloudGuard(async () => {
      if (isSyncing) return;
      if (syncStatus.state !== 'ONLINE') {
      toast.error("Impossible de forcer la synchronisation : l'appareil est hors-ligne.");
      return;
    }

    setIsSyncing(true);
    const toastId = toast.loading('Synchronisation des données en cours...');

    try {
      const res = await window.api.sync.force();
      if (res.success) {
        toast.success(res.message, { id: toastId });
        // Rafraîchir le statut après la sync
        const updatedStatus = await window.api.sync.getStatus();
        setSyncStatus(updatedStatus);
      } else {
        toast.error(res.message, { id: toastId });
      }
    } catch (err: any) {
      toast.error(`Erreur de synchronisation: ${err.message || err}`, { id: toastId });
    } finally {
      setIsSyncing(false);
    }
    });
  };

  const getStatusColor = () => {
    switch (syncStatus.state) {
      case 'ONLINE':
        return 'var(--success)';
      case 'PROBING':
      case 'DEGRADED':
        return 'var(--warning)';
      case 'OFFLINE':
      default:
        return 'var(--text-muted)';
    }
  };

  const getStatusText = () => {
    switch (syncStatus.state) {
      case 'ONLINE':
        return syncStatus.queueCount > 0 
          ? `${syncStatus.queueCount} modif. en attente`
          : 'Données synchronisées';
      case 'PROBING':
        return 'Vérification connexion...';
      case 'DEGRADED':
        return 'Connexion instable';
      case 'OFFLINE':
      default:
        return 'Mode local autonome';
    }
  };

  const formatLastSync = (dateStr: string) => {
    if (!dateStr || dateStr === 'Jamais') return 'Jamais';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return dateStr;
    }
  };

  return (
    <div className="sync-widget" style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '4px 8px',
      borderRadius: '6px',
      backgroundColor: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      fontSize: '12px',
      color: 'var(--text-primary)',
      marginRight: '8px'
    }}>
      {/* Icône de statut Cloud */}
      <div style={{ display: 'flex', alignItems: 'center', color: getStatusColor() }}>
        {syncStatus.state === 'ONLINE' && <Cloud size={16} />}
        {syncStatus.state === 'OFFLINE' && <CloudOff size={16} />}
        {(syncStatus.state === 'PROBING' || syncStatus.state === 'DEGRADED') && (
          <CloudLightning size={16} style={{ animation: 'pulse 1.5s infinite' }} />
        )}
      </div>

      {/* Libellés de statut */}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
        <span style={{ fontWeight: '500' }}>{getStatusText()}</span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
          Dernière sync: {formatLastSync(syncStatus.lastSync)}
        </span>
      </div>

      {/* Bouton de synchronisation manuelle */}
      {syncStatus.state === 'ONLINE' && (
        <button
          onClick={handleForceSync}
          disabled={isSyncing}
          style={{
            background: 'none',
            border: 'none',
            padding: '2px',
            cursor: isSyncing ? 'not-allowed' : 'pointer',
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px',
            transition: 'background-color 0.2s',
          }}
          className="sync-button"
          title="Forcer la synchronisation"
        >
          <RefreshCw 
            size={14} 
            style={{ 
              animation: isSyncing ? 'spin 1s linear infinite' : 'none'
            }} 
          />
        </button>
      )}
    </div>
  );
}
