import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  CreditCard, 
  CheckCircle, 
  AlertTriangle, 
  TrendingUp, 
  RefreshCw, 
  Clock, 
  UserCheck,
  Database,
  Globe
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useCacheStore } from '../stores/cacheStore';

interface CentreStats {
  total: number;
  en_stock: number;
  distribuees: number;
  absentes: number;
}

interface OperatorCadence {
  id_user: number;
  login: string;
  nom_user: string;
  prenom_user: string;
  role: string;
  verifications_today: number;
  derniere_activite: string | null;
}

import { toast } from 'react-hot-toast';

export default function AdminCentreDashboardPage() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<CentreStats>({ total: 0, en_stock: 0, distribuees: 0, absentes: 0 });
  const [cadence, setCadence] = useState<OperatorCadence[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [centreName, setCentreName] = useState<string>('');

  // Sync state variables
  const [isPullingCards, setIsPullingCards] = useState<boolean>(false);
  const [downstreamProgress, setDownstreamProgress] = useState<number>(-1);
  const [isSyncingUsers, setIsSyncingUsers] = useState<boolean>(false);
  const [isBulkUploading, setIsBulkUploading] = useState<boolean>(false);
  const [bulkProgress, setBulkProgress] = useState<number>(-1);
  const [dirtyCartesCount, setDirtyCartesCount] = useState<number>(0);
  const [cloudCartesCount, setCloudCartesCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  // Anomaly stats state
  const [strictCount, setStrictCount] = useState<number>(0);
  const [probableCount, setProbableCount] = useState<number>(0);
  const [invalidCount, setInvalidCount] = useState<number>(0);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.api?.sync?.onBulkProgress) {
      const unsubscribe = window.api.sync.onBulkProgress((progress: number) => {
        setBulkProgress(progress);
        if (progress >= 100) {
          setIsBulkUploading(false);
          setBulkProgress(-1);
        }
      });
      return () => {
        unsubscribe();
      };
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.api?.sync?.onDownstreamProgress) {
      const unsubscribe = window.api.sync.onDownstreamProgress((payload) => {
        const progress = payload.progress;
        setDownstreamProgress(progress);
        if (progress >= 100) {
          setTimeout(() => {
            setDownstreamProgress(-1);
          }, 2000);
        }
      });
      return () => {
        unsubscribe();
      };
    }
    return undefined;
  }, []);

  const fetchDashboardData = async (silent?: boolean) => {
    const isSilent = !!silent;
    try {
      if (!isSilent) setLoading(true);
      
      let activeUser = user;
      if (user?.login) {
        const freshUser = await window.api.users.getProfile(user.login);
        if (freshUser) {
          activeUser = { ...user, ...freshUser };
          useAuthStore.setState({ user: activeUser });
        }
      }

      const siteIdToUse = activeUser?.site_id;
      const centreIdToUse = activeUser?.centre_id;

      if (siteIdToUse && centreIdToUse) {
        if (window.api.hierarchy.getCentreById) {
          const currentCentre = await window.api.hierarchy.getCentreById(Number(centreIdToUse));
          if (currentCentre) {
            setCentreName(currentCentre.nom);
          }
        } else {
          // Fallback if not available
          const centres = await window.api.hierarchy.getCentres(siteIdToUse);
          const currentCentre = centres.find((c: any) => Number(c.id) === Number(centreIdToUse));
          if (currentCentre) {
            setCentreName(currentCentre.nom);
          }
        }
      }
      if (siteIdToUse) {
        // Fetch unsynced cards count for the push button badge
        const unsyncedRes = await window.api.stats.getUnsyncedCardsCount(siteIdToUse);
        if (typeof unsyncedRes === 'number') {
          setDirtyCartesCount(unsyncedRes);
        }
        window.api.sync.getCloudCartesCount(siteIdToUse).then(count => {
          setCloudCartesCount(count);
        }).catch(err => {
          console.error('Failed to fetch cloud count:', err);
        });
      }

      if (centreIdToUse && siteIdToUse) {
        const statsRes = await window.api.stats.getCentre(centreIdToUse, siteIdToUse);
        const cadenceRes = await window.api.stats.getCentreOperateurs(centreIdToUse);
        if (statsRes) setStats(statsRes);
        if (cadenceRes) setCadence(cadenceRes);
        useCacheStore.getState().setCentreDashboardCache({
          stats: statsRes,
          cadence: cadenceRes
        });
      }
      setLastRefreshed(new Date());
    } catch (error) {
      console.error("Erreur lors du chargement des données superviseur:", error);
    } finally {
      if (!isSilent) setLoading(false);
      useAuthStore.getState().setInitialDataLoading(false);
    }
  };

  const handleStartBulkUpload = async () => {
    if (!user?.site_id) return;
    setIsBulkUploading(true);
    setBulkProgress(0);
    const toastId = toast.loading("Initialisation du transfert de masse...");
    
    // Donner une chance à React de re-rendre l'IHM et d'afficher le loader/spinner à 0%
    await new Promise(resolve => setTimeout(resolve, 50));
    
    try {
      const res = await window.api.sync.startBulk(Number(user.site_id), false, false);
      if (res.success) {
        toast.success(res.message, { id: toastId });
      } else {
        toast.error(res.message || "Erreur de synchronisation", { id: toastId });
      }
      
      // Mettre à jour les anomalies issues du bilan de retour
      if (res.strictCount !== undefined) setStrictCount(res.strictCount);
      if (res.probableCount !== undefined) setProbableCount(res.probableCount);
      if (res.invalidCount !== undefined) setInvalidCount(res.invalidCount);

      await fetchDashboardData();
    } catch (err: any) {
      toast.error(`Échec du transfert : ${err.message || err}`, { id: toastId });
    } finally {
      setIsBulkUploading(false);
      setBulkProgress(-1);
    }
  };

  const handlePullSiteCards = async () => {
    if (!user?.site_id) return;
    setIsPullingCards(true);
    const toastId = toast.loading('☁️ Récupération des cartes depuis le cloud en cours...');
    try {
      const res = await window.api.sync.pullSiteCards(Number(user.site_id), user);
      if (res.success) {
        if (res.count > 0) {
          toast.success(`✅ Récupération réussie ! ${res.count} carte(s) mise(s) à jour ou ajoutée(s).`, { id: toastId, duration: 6000 });
        } else {
          toast.success("✅ Vos données locales sont déjà à jour.", { id: toastId, duration: 4000 });
        }
        await fetchDashboardData(); 
      } else {
        toast.error(`Échec de récupération : ${res.message || 'Erreur inconnue'}`, { id: toastId, duration: 8000 });
      }
    } catch (err: any) {
      toast.error(`Échec de récupération des cartes : ${err.message || err}`, { id: toastId });
    } finally {
      setIsPullingCards(false);
    }
  };

  const handleSyncUsers = async () => {
    if (!user?.site_id) return;
    setIsSyncingUsers(true);
    const toastId = toast.loading('☁️ Synchronisation des utilisateurs depuis le cloud...');
    try {
      const res = await window.api.sync.syncUsersFromSupabase(Number(user.site_id), user);
      if (res.success) {
        if (res.count && res.count > 0) {
          toast.success(`✅ Synchronisation terminée avec succès : ${res.count} utilisateur(s) synchronisé(s).`, { id: toastId, duration: 5000 });
        } else {
          toast.success("✅ Synchronisation terminée avec succès.", { id: toastId, duration: 4000 });
        }
        await fetchDashboardData();
      } else {
        toast.error(`Échec de la synchronisation : ${res.message || 'Erreur inconnue'}`, { id: toastId, duration: 6000 });
      }
    } catch (err: any) {
      toast.error(`Échec de la synchronisation : ${err.message || err}`, { id: toastId });
    } finally {
      setIsSyncingUsers(false);
    }
  };

  useEffect(() => {
    const cache = useCacheStore.getState().centreDashboardCache;
    let hasCache = false;
    if (cache.cachedAt) {
      if (cache.stats) setStats(cache.stats);
      if (cache.cadence) setCadence(cache.cadence);
      setLoading(false);
      hasCache = true;
    }
    fetchDashboardData(hasCache);
    // Auto-refresh toutes les 30 secondes (silencieusement)
    const interval = setInterval(() => fetchDashboardData(true), 30000);
    return () => clearInterval(interval);
  }, [user, user?.site_id, user?.centre_id]);

  // Synchronisation automatique et silencieuse des utilisateurs au chargement
  useEffect(() => {
    if (user?.site_id && isOnline && user.role === 'ADMIN_CENTRE') {
      // Synchronisation sans bloquer l'interface ni afficher de toast
      window.api.sync.syncUsersFromSupabase(Number(user.site_id), user)
        .then((res) => {
          if (res.success && res.count && res.count > 0) {
             // Rafraîchir les données locales silencieusement après avoir récupéré de nouveaux agents
             fetchDashboardData(true);
          }
        })
        .catch((err) => console.error("Erreur sync silencieuse utilisateurs:", err));
    }
  }, [user?.site_id, isOnline]);

  const formatLastActivity = (isoString: string | null) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      const diffMs = new Date().getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'À l\'instant';
      if (diffMins < 60) return `Il y a ${diffMins} min`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `Il y a ${diffHours} h`;
      return date.toLocaleDateString();
    } catch {
      return '—';
    }
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', minHeight: '100%', overflowY: 'auto', color: 'var(--text-primary)' }}>
      {/* En-tête */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
        width: '100%'
      }}>
        <div style={{ flex: '1 1 300px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--accent-primary)', marginBottom: 4 }}>
            <Building2 size={24} />
            <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Supervision Locale</span>
          </div>
          <h1 style={{ fontSize: 'calc(1.3rem + 0.6vw)', fontWeight: 800, margin: 0, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            Centre de {centreName || '...'}
          </h1>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
            Suivi opérationnel en temps réel de votre centre d'enrôlement
          </p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button 
            onClick={() => fetchDashboardData(false)} 
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              color: 'var(--text-primary)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap',
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Mettre à jour
          </button>
        </div>
      </div>

      {/* ZONE DE SYNCHRONISATION PREMIUM ISOLÉE POUR L'ADMIN_CENTRE ET LE SUPER ADMIN */}
      {['ADMIN_CENTRE', 'SUPER ADMIN'].includes(user?.role || '') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              padding: '16px 24px', 
              background: 'rgba(15, 23, 42, 0.4)', 
              border: '1px solid rgba(52, 211, 153, 0.15)', 
              borderRadius: '16px',
              gap: 16
            }}
          >
            <div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#34d399', display: 'flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={16} /> Mode Supervision : Actions de Synchronisation
              </span>
              <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginTop: 2 }}>
                Synchronisez les cartes CMU locales et la liste des utilisateurs de votre centre avec le Cloud.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button 
                onClick={handlePullSiteCards} 
                disabled={isPullingCards || !isOnline || cloudCartesCount === 0}
                className="btn-outline" 
                style={{ 
                  padding: '12px 24px', 
                  borderRadius: 12, 
                  fontWeight: 700,
                  cursor: (isPullingCards || !isOnline || cloudCartesCount === 0) ? 'not-allowed' : 'pointer',
                  opacity: (isPullingCards || !isOnline || cloudCartesCount === 0) ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'rgba(255, 255, 255, 0.03)',
                  color: 'white',
                  flex: '1 1 auto',
                  whiteSpace: 'nowrap'
                }}
              >
                <Database size={18} style={{ animation: isPullingCards ? 'spin 1.5s linear infinite' : 'none' }} />
                {isPullingCards ? 'RÉCUPÉRATION EN COURS...' : `RÉCUPÉRER LES CARTES DEPUIS LE CLOUD${cloudCartesCount > 0 ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
              </button>

              <button 
                onClick={handleStartBulkUpload} 
                disabled={isBulkUploading || !isOnline || dirtyCartesCount === 0}
                className="btn-plein-soleil" 
                style={{ 
                  padding: '12px 24px', 
                  borderRadius: 12, 
                  fontWeight: 700,
                  backgroundColor: (isBulkUploading || !isOnline || dirtyCartesCount === 0) ? '#555555' : '#FFE600',
                  color: (isBulkUploading || !isOnline || dirtyCartesCount === 0) ? '#ffffff' : '#000000',
                  border: '1px solid #FFE600',
                  cursor: (isBulkUploading || !isOnline || dirtyCartesCount === 0) ? 'not-allowed' : 'pointer',
                  opacity: (isBulkUploading || !isOnline || dirtyCartesCount === 0) ? 0.5 : 1,
                  boxShadow: '0 4px 15px rgba(255, 230, 0, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'all 0.2s ease-in-out',
                  flex: '1 1 auto',
                  whiteSpace: 'nowrap'
                }}
              >
                <Globe size={18} style={{ animation: isBulkUploading ? 'spin 1.5s linear infinite' : 'none' }} />
                {isBulkUploading ? 'ENVOI EN COURS...' : `ENVOYER LES CARTES VERS LE CLOUD${dirtyCartesCount > 0 ? ` (${dirtyCartesCount.toLocaleString('fr')})` : ''}`}
              </button>
            </div>
          </div>

          {/* BANNIÈRE DE RAPPORT D'ANOMALIES EN CAS DE RESTE DIRTY */}
          {(strictCount > 0 || probableCount > 0 || invalidCount > 0) && (
            <div 
              style={{
                padding: '12px 20px',
                borderRadius: '12px',
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px dashed rgba(239, 68, 68, 0.3)',
                color: '#fca5a5',
                fontSize: '12px',
                lineHeight: '1.5'
              }}
            >
              ⚠️ <strong>Mise à jour partielle réussie</strong> : Les cartes conformes ont été synchronisées. Cependant, les anomalies locales suivantes bloquent le reste du téléversement :
              <ul style={{ margin: '6px 0 0 0', paddingLeft: '20px', listStyleType: 'disc' }}>
                {strictCount > 0 && <li><strong>{strictCount} doublon(s) strict(s)</strong> : Clés uniques identiques déjà enregistrées.</li>}
                {probableCount > 0 && <li><strong>{probableCount} doublon(s) probable(s)</strong> : Même Identité (Noms, Prénoms, Date de naissance).</li>}
                {invalidCount > 0 && <li><strong>{invalidCount} date(s) de naissance invalide(s)</strong> : Format différent de AAAA-MM-JJ ou champ vide.</li>}
              </ul>
              <span style={{ display: 'block', marginTop: '6px', fontSize: '11px', color: '#fca5a5', opacity: 0.8 }}>
                💡 Veuillez éditer ces cartes dans l'onglet "Cartes CMU" pour corriger les doublons ou anomalies d'identité avant de relancer l'envoi.
              </span>
            </div>
          )}
        </div>
      )}

      {/* COMPTEURS STYLE PLEIN SOLEIL */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
        
        {/* Tuile 1 : TOTAL EN STOCK */}
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-subtle)', 
          borderRadius: 16, 
          padding: '20px', 
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>En Stock</div>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#eab308' }}>
              <CreditCard size={18} />
            </div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)' }}>
            {stats.en_stock.toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Cartes prêtes à la distribution</div>
        </div>

        {/* Tuile 2 : DISTRIBUÉES */}
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-subtle)', 
          borderRadius: 16, 
          padding: '20px', 
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Délivrées</div>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e' }}>
              <CheckCircle size={18} />
            </div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)' }}>
            {stats.distribuees.toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Cartes remises aux assurés</div>
        </div>

        {/* Tuile 3 : ABSENTES */}
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-subtle)', 
          borderRadius: 16, 
          padding: '20px', 
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Absentes</div>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)' }}>
            {stats.absentes.toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Signalements d'anomalies en cours</div>
        </div>

        {/* Tuile 4 : TOTAL EN BASE */}
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-subtle)', 
          borderRadius: 16, 
          padding: '20px', 
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Total</div>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6' }}>
              <TrendingUp size={18} />
            </div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)' }}>
            {stats.total.toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Total des cartes rattachées au centre</div>
        </div>

      </div>



      {/* CADENCE ET PERFORMANCES DES OPERATEURS */}
      <div style={{ 
        background: 'var(--bg-secondary)', 
        border: '1px solid var(--border-subtle)', 
        borderRadius: 20, 
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserCheck size={20} style={{ color: 'var(--accent-primary)' }} />
              Cadence de l'équipe locale
            </h2>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Vérifications et remises de cartes CMU enregistrées aujourd'hui
            </p>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={12} />
            Mis à jour le {lastRefreshed.toLocaleTimeString()} (Rafraîchissement 30s)
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Nom complet</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Identifiant</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Rôle</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'center' }}>Cadence / Jour</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Dernière activité</th>
              </tr>
            </thead>
            <tbody>
              {cadence.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                    Aucun Opérateur de Vérification actif aujourd'hui dans ce centre.
                  </td>
                </tr>
              ) : (
                cadence.map((op) => (
                  <tr key={op.id_user} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 14, transition: 'background 0.2s' }} className="hover-row">
                    <td style={{ padding: '16px', fontWeight: 600 }}>{op.nom_user} {op.prenom_user}</td>
                    <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>@{op.login}</td>
                    <td style={{ padding: '16px' }}>
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '4px 8px',
                        borderRadius: '6px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.02em',
                        background: op.role.startsWith('OPERATEUR_VERIF') ? 'rgba(245,158,11,0.1)' : 
                                    op.role.startsWith('OPERATEUR_SAISIE') ? 'rgba(34,197,94,0.1)' :
                                    op.role.startsWith('OPERATEUR_QUALITE') ? 'rgba(139,92,246,0.1)' :
                                    op.role.startsWith('OPERATEUR_LOGISTIQUE') ? 'rgba(59,130,246,0.1)' :
                                    op.role.startsWith('OPERATEUR_INVENTAIRE') ? 'rgba(236,72,153,0.1)' : 'rgba(255,255,255,0.05)',
                        color: op.role.startsWith('OPERATEUR_VERIF') ? '#f59e0b' : 
                               op.role.startsWith('OPERATEUR_SAISIE') ? '#22c55e' :
                               op.role.startsWith('OPERATEUR_QUALITE') ? '#8b5cf6' :
                               op.role.startsWith('OPERATEUR_LOGISTIQUE') ? '#3b82f6' :
                               op.role.startsWith('OPERATEUR_INVENTAIRE') ? '#ec4899' : 'var(--text-secondary)',
                        border: op.role.startsWith('OPERATEUR_VERIF') ? '1px solid rgba(245,158,11,0.2)' : 
                                op.role.startsWith('OPERATEUR_SAISIE') ? '1px solid rgba(34,197,94,0.2)' :
                                op.role.startsWith('OPERATEUR_QUALITE') ? '1px solid rgba(139,92,246,0.2)' :
                                op.role.startsWith('OPERATEUR_LOGISTIQUE') ? '1px solid rgba(59,130,246,0.2)' :
                                op.role.startsWith('OPERATEUR_INVENTAIRE') ? '1px solid rgba(236,72,153,0.2)' : '1px solid rgba(255,255,255,0.1)'
                      }}>
                        {op.role.replace('OPERATEUR_', '').replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <span style={{ 
                        background: op.verifications_today > 0 ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.02)',
                        color: op.verifications_today > 0 ? '#22c55e' : 'var(--text-secondary)',
                        padding: '6px 12px',
                        borderRadius: 20,
                        fontWeight: 700,
                        fontSize: 13,
                        border: op.verifications_today > 0 ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(255,255,255,0.05)',
                      }}>
                        {op.verifications_today} {op.verifications_today > 1 ? 'cartes' : 'carte'}
                      </span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 500 }}>
                      {formatLastActivity(op.derniere_activite)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bouclier global anti-clics et curseur de chargement pour AdminCentreDashboardPage */}
      {(isBulkUploading || isPullingCards || isSyncingUsers) && (
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
            {isBulkUploading && bulkProgress >= 0 && (
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
                color: '#eab308'
              }}>
                {bulkProgress}%
              </div>
            )}
            {isPullingCards && downstreamProgress >= 0 && (
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
            {isBulkUploading 
              ? `Transfert de masse vers le Cloud... (${bulkProgress >= 0 ? bulkProgress : 0}%)` 
              : isSyncingUsers 
                ? 'Synchronisation des utilisateurs...' 
                : isPullingCards && downstreamProgress >= 0 
                  ? `Récupération des cartes... (${downstreamProgress}%)`
                  : 'Récupération des cartes...'}
          </span>
        </div>
      )}
    </div>
  );
}
