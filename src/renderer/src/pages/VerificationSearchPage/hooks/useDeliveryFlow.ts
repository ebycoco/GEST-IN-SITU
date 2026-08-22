import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

export function useDeliveryFlow(
  user: any,
  selectedCentreId: number | null,
  activeSiteId: number | null,
  selectedCarte: any,
  setSelectedCarte: (c: any) => void,
  resetSearchFields: () => void,
  loadStats: () => Promise<void>,
  loadCardsToday: () => Promise<void>,
  nomInputRef: any
) {
  const [nomRetirant, setNomRetirant] = useState('');
  const [telRetirant, setTelRetirant] = useState('');
  const [retirantType, setRetirantType] = useState('lui-meme');
  const [emergencyRangement, setEmergencyRangement] = useState('');
  const [showReportModal, setShowReportModal] = useState(false);
  const [modalStep, setModalStep] = useState(1);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const isUnclassifiedCard = (carte: any): boolean => {
    if (!carte) return false;
    const r = carte.rangement;
    return !r || r.trim() === '' || r.toUpperCase() === 'NON CLASSE';
  };

  useEffect(() => {
    if (retirantType === 'lui-meme' && selectedCarte) {
      setNomRetirant(`${selectedCarte.noms} ${selectedCarte.prenoms}`.trim().toUpperCase());
      if (selectedCarte.contact) {
        const clean = selectedCarte.contact.replace(/\D/g, '');
        const local = clean.startsWith('225') ? clean.slice(3) : clean;
        const formattedParts = local.match(/.{1,2}/g);
        const formatted = formattedParts ? formattedParts.join(' ') : '';
        setTelRetirant(formatted ? `+225 ${formatted}` : '');
      } else {
        setTelRetirant('');
      }
    } else if (retirantType === 'tiers') {
      setNomRetirant('');
      setTelRetirant('');
    }
  }, [retirantType, selectedCarte]);

  const resetModal = () => {
    setShowReportModal(false);
    setSelectedCarte(null);
    setModalStep(1);
    setNomRetirant('');
    setTelRetirant('');
    setRetirantType('lui-meme');
    setEmergencyRangement('');
  };

  const handleDeliver = async () => {
    if (!nomRetirant.trim() || !telRetirant.trim()) {
      toast.error('Veuillez remplir les informations du retirant.');
      return;
    }

    setIsFinalizing(true);
    try {
      if (user?.role === 'ADMINISTRATEUR_SITE' && !selectedCentreId) {
        toast.error('Veuillez sélectionner un centre de travail en haut de la page.');
        setIsFinalizing(false);
        return;
      }

      const agent = user?.login || 'OPERATEUR_VERIFICATION';
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const centres = await window.api.hierarchy.getCentres(siteIdToUse || undefined);
      const centreName = centres.find((c: any) => c.id === selectedCentreId)?.nom || '';

      if (isUnclassifiedCard(selectedCarte) && !emergencyRangement.trim()) {
        toast.error("Le rangement d'urgence est obligatoire pour cette carte.");
        setIsFinalizing(false);
        return;
      }

      await window.api.cartes.delivrer(selectedCarte.id_carte, {
        nom_retirant: nomRetirant.trim().toUpperCase(),
        num_retirant: telRetirant.trim(), 
        contact_retirant: telRetirant.trim(),
        type_retirant: retirantType === 'lui-meme' ? 'ASSURE' : 'TIERS',
        agent_distributeur: agent,
        centre_retrait: centreName,
        rangement: isUnclassifiedCard(selectedCarte) ? emergencyRangement.trim().toUpperCase() : undefined
      }, {
        id_user: user?.id_user,
        login: user?.login,
        role: user?.role,
        site_id: user?.site_id,
        centre_id: user?.centre_id
      });

      toast.success('Carte délivrée avec succès !');
      // Signal global de mise à jour de données (même convention que AgentSaisieLayout.tsx /
      // CorrectionSidePanel.onSave / DoublonsView.tsx etc.) : ce hook est partagé par
      // RechercheView.tsx (portail AgentVerification, qui reçoit déjà son propre callback de
      // rafraîchissement `refreshStats` via useOutletContext dans `loadStats` ci-dessus — ce
      // portail n'écoute pas 'app:data-updated', ce dispatch y est donc un no-op inoffensif) et
      // VerificationSearchPage/index.tsx (route /admin-centre/recherche, autonome, sans props ni
      // useOutletContext). C'est ce second usage qui manquait de notifier AdminCentreLayout.tsx :
      // son compteur cloudCartesCount/detailedSyncStats (qui pilote le bouton "Synchroniser mes
      // saisies") restait figé jusqu'à 30s après une délivrance faute d'écouteur. Voir le nouveau
      // listener ajouté dans AdminCentreLayout.tsx.
      window.dispatchEvent(new CustomEvent('app:data-updated'));
      resetModal();
      await loadStats();
      await loadCardsToday();
      resetSearchFields();
      setTimeout(() => {
        nomInputRef.current?.focus();
      }, 50);
    } catch (err) {
      console.error('Failed to deliver card:', err);
      toast.error(err instanceof Error && err.message ? err.message : 'Erreur lors de la validation du retrait.');
    } finally {
      setIsFinalizing(false);
    }
  };

  return {
    nomRetirant,
    setNomRetirant,
    telRetirant,
    setTelRetirant,
    retirantType,
    setRetirantType,
    emergencyRangement,
    setEmergencyRangement,
    showReportModal,
    setShowReportModal,
    modalStep,
    setModalStep,
    isFinalizing,
    resetModal,
    handleDeliver,
    isUnclassifiedCard
  };
}
