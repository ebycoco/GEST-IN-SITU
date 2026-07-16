import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { useVisibilityBufferedCallback } from '../../../hooks/useVisibilityBufferedCallback';
import { useSyncDownstreamStore } from '../../../stores/syncDownstreamStore';
import { useCloudActionGuard } from '../../../hooks/useCloudActionGuard';

export function useForceSyncActions(user: any, activeSiteId: number | null, loadStats: () => Promise<void>) {
  const [isForceSyncing, setIsForceSyncing] = useState<boolean>(false);
  const [forceSyncResult, setForceSyncResult] = useState<any | null>(null);
  const [isSiteSyncing, setIsSiteSyncing] = useState<boolean>(false);
  const [isSyncingAgents, setIsSyncingAgents] = useState<boolean>(false);
  const [isPullingCardsLocalState, setIsPullingCardsLocal] = useState<boolean>(false);

  const cloudGuard = useCloudActionGuard();

  // ── Store global du téléchargement — visible sur toutes les pages ──────────
  const {
    isBackgroundPulling,
    downstreamInfo,
    setIsPullingCards: setStorePulling,
    setDownstreamProgress,
    clearDownstream,
  } = useSyncDownstreamStore();
  // Compat: isPullingCards = vrai seulement si pas encore en arrière-plan
  const isPullingCards = isPullingCardsLocalState && !isBackgroundPulling;
  const downstreamProgress = downstreamInfo?.progress ?? -1;

  const [allowProbable, setAllowProbable] = useState<boolean>(false);
  const [allowInvalid, setAllowInvalid] = useState<boolean>(false);
  const [isBulkUploading, setIsBulkUploading] = useState<boolean>(false);
  const [bulkProgress, setBulkProgress] = useState<number>(-1);

  // Reset local state on unmount
  useEffect(() => {
    return () => {
      setAllowProbable(false);
      setAllowInvalid(false);
    };
  }, []);

  const handleBulkProgress = useVisibilityBufferedCallback((progress: number) => {
    setBulkProgress(progress);
    if (progress >= 100) {
      setIsBulkUploading(false);
      setBulkProgress(-1);
    }
  });

  // Listen to bulk progress
  useEffect(() => {
    if (typeof window !== 'undefined' && window.api?.sync?.onBulkProgress) {
      const unsubscribe = window.api.sync.onBulkProgress(handleBulkProgress);
      return () => {
        unsubscribe();
      };
    }
    return undefined;
  }, [handleBulkProgress]);

  // ⚠️ NE PAS utiliser useVisibilityBufferedCallback ici :
  // Le downstream automatique dure ~20 minutes. Si la fenêtre est minimisée
  // (même 1 seconde), le filtre de visibilité gèle la barre à sa dernière valeur.
  // Le store Zustand global doit recevoir les mises à jour en temps réel.
  const handleDownstreamProgress = useCallback((payload: { progress: number; merged: number; total: number }) => {
    // Écriture dans le store GLOBAL — persiste même si le Dashboard est démonté
    setDownstreamProgress(payload);
    if (payload.progress >= 100) {
      // Téléchargement réellement terminé : on efface tout après 3 secondes
      setTimeout(() => {
        clearDownstream();
        setIsPullingCardsLocal(false);
      }, 3000);
    }
  }, [setDownstreamProgress, clearDownstream]);

  // Listen to downstream progress (sans filtre de visibilité — progression toujours à jour)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.api?.sync?.onDownstreamProgress) {
      const unsubscribe = window.api.sync.onDownstreamProgress(handleDownstreamProgress);
      return () => {
        unsubscribe();
      };
    }
    return undefined;
  }, [handleDownstreamProgress]);

  const handleStartBulkUpload = async (forceProbable = false, forceInvalid = false) => {
    return cloudGuard(async () => {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      toast.error("Veuillez d'abord sélectionner un site actif.");
      return { success: false, message: "Aucun site actif." };
    }

    setIsBulkUploading(true);
    setBulkProgress(0);
    const toastId = toast.loading("Initialisation du transfert de masse...");

    try {
      const res = await window.api.sync.startBulk(Number(siteIdToUse), forceProbable, forceInvalid);
      if (res.success) {
        toast.success(res.message, { id: toastId });
        setAllowProbable(false);
        setAllowInvalid(false);
        await loadStats();
      } else if ((res as any).cancelled) {
        toast('⚠️ Transfert annulé par l\'agent.', { id: toastId, icon: '🛑' });
      } else {
        toast.dismiss(toastId);
      }
      return res;
    } catch (err: any) {
      toast.error(`Échec du transfert : ${err.message || err}`, { id: toastId });
      return { success: false, message: err.message || String(err) };
    } finally {
      setIsBulkUploading(false);
      setBulkProgress(-1);
    }
    });
  };

  /**
   * Envoie le signal d'annulation au Main Process pour stopper proprement
   * le transfert en cours entre deux blocs de 1 000 cartes.
   * L'interface reste réactive pendant toute la durée de l'annulation.
   */
  const handleCancelBulkUpload = async () => {
    if (!isBulkUploading) return;
    toast.loading('🛑 Annulation du transfert en cours...', { id: 'cancel-bulk' });
    try {
      await window.api.sync.cancelBulk(user);
      toast.success('Transfert annulé. Les cartes déjà envoyées sont conservées.', { id: 'cancel-bulk', duration: 5000 });
    } catch (err: any) {
      toast.error(`Échec de l'annulation : ${err.message || err}`, { id: 'cancel-bulk' });
    }
  };

  const handleForceGlobalSync = async () => {
    return cloudGuard(async () => {
      setIsForceSyncing(true);
    const toastId = toast.loading('☁️ Synchronisation globale cloud de tous les sites en cours...');
    try {
      const res = await window.api.sync.forceGlobal();
      if (res.success) {
        setForceSyncResult(res);
        toast.success(
          `✅ Synchronisation globale réussie ! ${res.counts.sites} site(s), ${res.counts.centres} centre(s) et ${res.counts.users} agent(s) mis à jour.`,
          { id: toastId, duration: 6000 }
        );
      } else {
        toast.error("Échec partiel de la synchronisation globale.", { id: toastId });
      }
    } catch (err: any) {
      toast.error(`Erreur de synchronisation globale : ${err.message || err}`, { id: toastId });
    } finally {
      setIsForceSyncing(false);
    }
    });
  };

  const handleForceAgentsSync = async () => {
    return cloudGuard(async () => {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      toast.error("Aucun site actif sélectionné pour la synchronisation.");
      return;
    }

    setIsSyncingAgents(true);
    const toastId = toast.loading('☁️ Synchronisation forcée des comptes agents...');

    try {
      await window.api.sync.forceAgents(Number(siteIdToUse));
      await loadStats(); 
      toast.success(
        `✅ Synchronisation des agents réussie !`,
        { id: toastId, duration: 6000 }
      );
    } catch (err: any) {
      toast.error(`Échec synchronisation agents : ${err.message || err}`, { id: toastId });
    } finally {
      setIsSyncingAgents(false);
    }
    });
  };

  const handleForceSiteSync = async () => {
    return cloudGuard(async () => {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      toast.error("Aucun site actif sélectionné pour la synchronisation.");
      return;
    }

    setIsSiteSyncing(true);
    const toastId = toast.loading('☁️ Synchronisation forcée des données du site...');

    try {
      const res = await window.api.sync.forceSite(Number(siteIdToUse));
      if (res.success) {
        toast.success(
          `✅ Synchronisation du site réussie ! ${res.counts.users} agent(s) et ${res.counts.cards} carte(s) traités.`,
          { id: toastId, duration: 6000 }
        );
        loadStats(); 
      } else {
        toast.error(`Sync partielle : ${res.errors.join(', ')}`, { id: toastId, duration: 8000 });
      }
    } catch (err: any) {
      toast.error(`Échec synchronisation site : ${err.message || err}`, { id: toastId });
    } finally {
      setIsSiteSyncing(false);
    }
    });
  };

  const handlePullSiteCards = async (isAutomatic = false) => {
    return cloudGuard(async () => {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      if (!isAutomatic) toast.error("Aucun site actif sélectionné pour la récupération.");
      return;
    }

    if (isAutomatic && !window.navigator.onLine) {
      return;
    }

    if (isPullingCards) {
      if (!isAutomatic) toast.error("Une récupération de cartes est déjà en cours.");
      return;
    }

    setIsPullingCardsLocal(true);
    setStorePulling(true);
    let toastId: string | undefined;
    if (!isAutomatic) {
      toastId = toast.loading('☁️ Récupération des cartes depuis le cloud en cours...');
    }

    try {
      const res = await window.api.sync.pullSiteCards(Number(siteIdToUse), user);
      if (res.success) {
        if (res.count > 0) {
          if (toastId) {
            toast.success(
              `✅ Récupération réussie ! ${res.count} carte(s) mise(s) à jour ou ajoutée(s).`,
              { id: toastId, duration: 6000 }
            );
          } else {
            toast.success(`✨ Synchronisation initiale : ${res.count} carte(s) synchronisée(s).`);
          }
        } else if (toastId) {
          toast.success("✅ Vos données locales sont déjà à jour.", { id: toastId, duration: 4000 });
        }
        await loadStats(); 
      } else if (toastId) {
        toast.error(`Échec de récupération : ${res.message || 'Erreur inconnue'}`, { id: toastId, duration: 8000 });
      }
    } catch (err: any) {
      if (toastId) {
        toast.error(`Échec de récupération des cartes : ${err.message || err}`, { id: toastId });
      }
    } finally {
      setIsPullingCardsLocal(false);
      // Le store se nettoie lui-même via clearDownstream() à la fin du téléchargement
      // mais en cas d'erreur, on force le nettoyage
      if (!isBackgroundPulling) {
        clearDownstream();
      }
    }
    });
  };

  const [isClearingCloud, setIsClearingCloud] = useState<boolean>(false);
  const [purgeCloudProgress, setPurgeCloudProgress] = useState<number>(-1);

  const handlePurgeCloudProgress = useVisibilityBufferedCallback((progress: number) => {
    setPurgeCloudProgress(progress);
    if (progress >= 100) {
      setPurgeCloudProgress(-1);
    }
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && window.api?.maintenance?.onPurgeCloudProgress) {
      const unsubscribe = window.api.maintenance.onPurgeCloudProgress(handlePurgeCloudProgress);
      return () => {
        unsubscribe();
      };
    }
    return undefined;
  }, [handlePurgeCloudProgress]);

  const handleClearCloudDatabase = async () => {
    return cloudGuard(async () => {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      toast.error("Veuillez d'abord sélectionner un site actif.");
      return;
    }

    // ─── PROTECTION UI : Vérification du statut de synchro avant purge ─────
    // Interroge le Main Process pour s'assurer qu'aucun cycle n'est actif.
    // Le verrou IPC côté backend est la protection principale (atomique),
    // mais ce contrôle préalable évite de lancer une promesse vouée à l'échec
    // et améliore l'expérience utilisateur.
    try {
      const syncStatus = await window.api.sync.getStatus();
      if (syncStatus?.isSyncing) {
        toast.error(
          '⛔ Action impossible : une synchronisation est en cours. Veuillez patienter avant de purger le cloud.',
          { duration: 6000 }
        );
        return;
      }
    } catch {
      // Si le statut est indisponible, on laisse le backend refuser si nécessaire.
    }
    // ──────────────────────────────────────────────────────────────────────────

    setIsClearingCloud(true);
    setPurgeCloudProgress(0);
    const toastId = toast.loading("Purge des cartes sur Supabase Cloud en cours...");
    try {
      const res = await window.api.maintenance.clearCloudCartes(Number(siteIdToUse), user);
      if (res.success) {
        toast.success("✅ Toutes les cartes de ce site ont été purgées de Supabase Cloud.", { id: toastId });
        await loadStats();
      } else {
        toast.error(
          `Purge refusée : ${(res as any).error || 'Erreur inconnue'}`,
          { id: toastId, duration: 8000 }
        );
      }
    } catch (err: any) {
      toast.error(`Échec de la purge Cloud : ${err.message || err}`, { id: toastId });
    } finally {
      setIsClearingCloud(false);
      setPurgeCloudProgress(-1);
    }
    });
  };

  return {
    isForceSyncing,
    forceSyncResult,
    isSiteSyncing,
    isSyncingAgents,
    isPullingCards,
    isBackgroundPulling,
    allowProbable,
    allowInvalid,
    isBulkUploading,
    bulkProgress,
    downstreamProgress,
    downstreamInfo,
    isClearingCloud,
    purgeCloudProgress,
    handleForceGlobalSync,
    handleForceSiteSync,
    handleForceAgentsSync,
    handlePullSiteCards,
    handleStartBulkUpload,
    handleCancelBulkUpload,
    handleClearCloudDatabase
  };
}
