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
        agent_distributeur: agent,
        centre_retrait: centreName,
        rangement: isUnclassifiedCard(selectedCarte) ? emergencyRangement.trim().toUpperCase() : undefined
      }, {
        role: user?.role,
        site_id: user?.site_id
      });

      toast.success('Carte délivrée avec succès !');
      resetModal();
      await loadStats();
      await loadCardsToday();
      resetSearchFields();
      setTimeout(() => {
        nomInputRef.current?.focus();
      }, 50);
    } catch (err) {
      console.error('Failed to deliver card:', err);
      toast.error('Erreur lors de la validation du retrait.');
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
