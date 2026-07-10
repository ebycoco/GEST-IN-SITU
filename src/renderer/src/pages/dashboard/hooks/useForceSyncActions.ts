import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useVisibilityBufferedCallback } from '../../../hooks/useVisibilityBufferedCallback';

export function useForceSyncActions(user: any, activeSiteId: number | null, loadStats: () => Promise<void>) {
  const [isForceSyncing, setIsForceSyncing] = useState<boolean>(false);
  const [forceSyncResult, setForceSyncResult] = useState<any | null>(null);
  const [isSiteSyncing, setIsSiteSyncing] = useState<boolean>(false);
  const [isSyncingAgents, setIsSyncingAgents] = useState<boolean>(false);
  const [isPullingCards, setIsPullingCards] = useState<boolean>(false);

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

  const handleStartBulkUpload = async (forceProbable = false, forceInvalid = false) => {
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
  };

  const handleForceGlobalSync = async () => {
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
  };

  const handleForceAgentsSync = async () => {
    if (!navigator.onLine) {
      toast.error("⚠️ Connexion Internet requise : Veuillez vous connecter pour envoyer les comptes des agents sur Supabase.");
      return;
    }

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
  };

  const handleForceSiteSync = async () => {
    if (!navigator.onLine) {
      toast.error("⚠️ Connexion Internet requise : Veuillez vous connecter pour envoyer les comptes des agents sur Supabase.");
      return;
    }

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
  };

  const handlePullSiteCards = async (isAutomatic = false) => {
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      if (!isAutomatic) toast.error("Aucun site actif sélectionné pour la récupération.");
      return;
    }

    if (isAutomatic && !window.navigator.onLine) {
      return;
    }

    if (!isAutomatic && !window.navigator.onLine) {
      toast.error("⚠️ Connexion Internet requise : Veuillez vous connecter pour récupérer les cartes depuis le cloud.");
      return;
    }

    if (isPullingCards) {
      if (!isAutomatic) toast.error("Une récupération de cartes est déjà en cours.");
      return;
    }

    setIsPullingCards(true);
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
      setIsPullingCards(false);
    }
  };

  const [isClearingCloud, setIsClearingCloud] = useState<boolean>(false);

  const handleClearCloudDatabase = async () => {
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      toast.error("Veuillez d'abord sélectionner un site actif.");
      return;
    }

    setIsClearingCloud(true);
    const toastId = toast.loading("Purge des cartes sur Supabase Cloud en cours...");
    try {
      const res = await window.api.maintenance.clearCloudCartes(Number(siteIdToUse), user);
      if (res.success) {
        toast.success("✅ Toutes les cartes de ce site ont été purgées de Supabase Cloud.", { id: toastId });
        await loadStats();
      }
    } catch (err: any) {
      toast.error(`Échec de la purge Cloud : ${err.message || err}`, { id: toastId });
    } finally {
      setIsClearingCloud(false);
    }
  };

  return {
    isForceSyncing,
    forceSyncResult,
    isSiteSyncing,
    isSyncingAgents,
    isPullingCards,
    allowProbable,
    allowInvalid,
    isBulkUploading,
    bulkProgress,
    isClearingCloud,
    handleForceGlobalSync,
    handleForceSiteSync,
    handleForceAgentsSync,
    handlePullSiteCards,
    handleStartBulkUpload,
    handleClearCloudDatabase
  };
}
