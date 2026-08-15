import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAuthStore } from '../../../stores/authStore';
import { AlertTriangle } from 'lucide-react';

import { useVerificationSearch } from '../../VerificationSearchPage/hooks/useVerificationSearch';
import { useDeliveryFlow } from '../../VerificationSearchPage/hooks/useDeliveryFlow';

import { SearchForm } from '../../VerificationSearchPage/components/SearchForm';
import { SearchResults } from '../../VerificationSearchPage/components/SearchResults';
import { DeliveryModal } from '../../VerificationSearchPage/components/DeliveryModal';
import { DeliveryProofModal } from '../../VerificationSearchPage/components/DeliveryProofModal';
import CentreContextSwitcher from '../../../components/layout/CentreContextSwitcher';

export default function RechercheView() {
  const { user, selectedCentreId, activeSiteId } = useAuthStore();
  const [adminSiteFilter, setAdminSiteFilter] = useState<number | null>(null);
  const [selectedCarte, setSelectedCarte] = useState<any | null>(null);
  const [showProofModal, setShowProofModal] = useState<boolean>(false);
  const [userCentre, setUserCentre] = useState<any>(null);
  // Marque la fin du PREMIER chargement asynchrone de userCentre (loadUserCentre ci-dessous).
  // Sert de garde pour fetchTotal : evite de calculer totalCards pendant la fenetre ou
  // userCentre vaut encore sa valeur initiale (null) le temps que loadUserCentre resolve,
  // ce qui produisait un isPrincipal errone (false) et donc un totalCards transitoirement
  // sous-estime (parfois 0 -> ecran "Base de donnees locale vide" affiche a tort).
  const [userCentreReady, setUserCentreReady] = useState(false);
  const [totalCards, setTotalCards] = useState<number | null>(null);
  const nomInputRef = useRef<HTMLInputElement>(null);

  // Pour la vue Agent, on ne recharge pas ici le panneau de stats local (StatsPanel de
  // VerificationSearchPage, non affiché dans ce module) : loadCardsTodayMock reste un no-op.
  // En revanche, `refreshStats` (fourni par AgentVerificationLayout via le contexte de l'Outlet,
  // cf. AgentVerificationLayout.tsx) DOIT être appelé après une délivrance : c'est lui qui
  // recalcule `detailedSyncStats` et donc l'état actif/inactif du bouton "Synchroniser mes
  // actions" du layout parent. Avant ce correctif, un `loadStats` factice était utilisé ici,
  // ce qui laissait ce bouton bloqué (grisé) après chaque délivrance de carte tant que l'écran
  // n'était pas remonté manuellement.
  const { refreshStats } = useOutletContext<{ refreshStats: () => Promise<void> }>();
  const loadCardsTodayMock = async () => {};

  const isCentrePrincipal = (c: any): boolean => {
    if (!c) return false;
    return Number(c.numero) === 1 ||
           (typeof c.nom === 'string' && (c.nom.toUpperCase().includes('PRINCIPAL') || c.nom.toUpperCase().includes('MAIRIE')));
  };

  useEffect(() => {
    // Garde anti-race : ignore un setState issu d'un run precedent de cet effet
    // si un nouveau run a demarre entre-temps (deps changees) ou si le composant
    // a ete demonte pendant l'appel IPC asynchrone.
    let cancelled = false;
    const loadUserCentre = async () => {
      const targetCentreId = selectedCentreId || user?.centre_id;
      if (targetCentreId) {
        try {
          const siteIdToUse = user?.site_id || activeSiteId;
          const centres = await window.api.hierarchy.getCentres(siteIdToUse || undefined);
          const centreObj = centres.find((c: any) => c.id === targetCentreId);
          if (!cancelled) setUserCentre(centreObj);
        } catch (err) {
          console.error('Failed to load user centre prefix:', err);
        }
      }
      // Le "premier chargement" est termine que targetCentreId ait existe ou non,
      // sinon fetchTotal resterait bloque indefiniment pour un utilisateur sans centre.
      if (!cancelled) setUserCentreReady(true);
    };
    loadUserCentre();
    return () => { cancelled = true; };
  }, [user, selectedCentreId, activeSiteId]);

  useEffect(() => {
    // Ne calcule totalCards qu'une fois le premier chargement de userCentre termine
    // (userCentreReady). Avant ce correctif, cet effet se re-declenchait des que
    // userCentre changeait, y compris lors de sa toute premiere valeur (null, pendant
    // que loadUserCentre est encore en vol). Dans cette fenetre, isCentrePrincipal(null)
    // vaut false, donc la requete stats.get partait avec un filtre centre errone et
    // pouvait renvoyer un total transitoirement sous-estime (parfois 0), declenchant
    // a tort l'ecran bloquant "Base de donnees locale vide" juste apres une creation
    // de carte. userCentreReady ne repasse jamais a false apres son premier passage a
    // true, donc les recalculs legitimes suivants (changement de centre, etc.) ne sont
    // pas impactes par cette garde.
    if (!userCentreReady) return;
    // activeSiteId n'est initialise au login que pour ADMINISTRATEUR_SITE/ADMIN_CENTRE
    // (voir authStore.ts) : il reste null pour OPERATEUR_VERIFICATION, ce qui bloquait
    // cet effet en permanence. Meme pattern que useVerificationSearch.ts (site_id direct
    // sur l'utilisateur sauf pour SUPER ADMIN, qui utilise le site actif selectionne).
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    let cancelled = false;
    const fetchTotal = async () => {
      if (siteIdToUse) {
        try {
          // totalCards ne sert qu'a decider si l'ecran bloquant "Base de donnees
          // locale vide" doit s'afficher (voir totalCards === 0 plus bas). La
          // recherche elle-meme (useVerificationSearch.ts) n'est JAMAIS filtree
          // par centre pour ce role : seule la delivrance l'est (cloisonnement
          // centre applique ailleurs, au moment de delivrer). Ce total doit donc
          // suivre la meme regle que la recherche : filtre SITE uniquement, sans
          // jamais transmettre selectedCentreId/isPrincipal ici. Avant ce correctif,
          // un agent d'un centre non-principal a faible/0 stock local voyait ce
          // total limite a tort a son propre centre, provoquant l'affichage de cet
          // ecran bloquant alors que le site avait bien des cartes disponibles
          // (bug P0 reproduit par e2e/specs/verification/centrefilter-total-badge.e2e.spec.ts).
          const stats = await window.api.stats.get(siteIdToUse);
          if (!cancelled) setTotalCards(stats?.total || 0);
        } catch (e) {
          if (!cancelled) setTotalCards(0);
        }
      }
    };
    fetchTotal();
    return () => { cancelled = true; };
  }, [activeSiteId, selectedCentreId, userCentre, user, userCentreReady]);

  const {
    nomRetirant, setNomRetirant, telRetirant, setTelRetirant,
    retirantType, setRetirantType, emergencyRangement, setEmergencyRangement,
    showReportModal, setShowReportModal, modalStep, setModalStep,
    isFinalizing, resetModal, handleDeliver, isUnclassifiedCard
  } = useDeliveryFlow(
    user, selectedCentreId, activeSiteId, selectedCarte, setSelectedCarte,
    () => resetSearchFields(), refreshStats, loadCardsTodayMock, nomInputRef
  );

  const {
    nomComplet, setNomComplet, ddn, setDdn, lieuNaissance, setLieuNaissance,
    contact, setContact, results, hasSearched, isSearching, searchMode, setSearchMode,
    searchContactQuery, setSearchContactQuery, showInversionModal, handleConfirmInversion,
    handleRejectInversion, nomSaisiInfo, prenomSaisiInfo, handleClear, handleSearch,
    handleContactSearch, handleSignalerAbsence, resetSearchFields, formatPhoneString,
    cloudResults, setCloudResults, isCloudSearching, cloudSearchDone
  } = useVerificationSearch(
    user, activeSiteId, false, adminSiteFilter, setAdminSiteFilter,
    setSelectedCarte, setShowReportModal, setModalStep, setShowProofModal
  );

  const isAgentAuthorisedForCard = (carteToCheck: any): boolean => {
    if (user?.role === 'SUPER ADMIN') return true;
    if (user?.site_id !== carteToCheck?.site_id) return false;
    if (user?.role === 'ADMINISTRATEUR_SITE') return true;

    if (isCentrePrincipal(userCentre)) {
      return true;
    }

    if (!userCentre || !userCentre.prefixe_rangement || !carteToCheck?.rangement) {
      return user?.centre_id === carteToCheck?.centre_id;
    }

    const agentPrefixes = userCentre.prefixe_rangement.split(',').map((p: string) => p.trim().toUpperCase());
    const cardRangementUpper = carteToCheck.rangement.trim().toUpperCase();

    return agentPrefixes.some((prefix: string) => cardRangementUpper.startsWith(prefix));
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200, margin: '0 auto' }}>
      <CentreContextSwitcher />
      
      {totalCards === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '60px 20px', textAlign: 'center', background: 'rgba(255,255,255,0.02)', borderRadius: 16, border: '1px dashed rgba(255,255,255,0.1)' }}>
          <div style={{ width: 64, height: 64, borderRadius: 32, background: 'rgba(243, 156, 18, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
            <AlertTriangle size={32} color="var(--accent-orange, #f39c12)" />
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'white', marginBottom: 12 }}>Base de données locale vide</h2>
          <p style={{ color: 'var(--text-muted)', maxWidth: 400, lineHeight: 1.6 }}>
            Il n'y a actuellement aucune carte CMU dans la base de données locale pour votre site ou centre. La recherche est désactivée.
          </p>
        </div>
      ) : (
        <>
          <SearchForm
            searchMode={searchMode}
            setSearchMode={setSearchMode}
            nomComplet={nomComplet}
            setNomComplet={setNomComplet}
            ddn={ddn}
            setDdn={setDdn}
            lieuNaissance={lieuNaissance}
            setLieuNaissance={setLieuNaissance}
            contact={contact}
            setContact={setContact}
            searchContactQuery={searchContactQuery}
            setSearchContactQuery={setSearchContactQuery}
            isSearching={isSearching}
            handleSearch={handleSearch}
            handleContactSearch={handleContactSearch}
            handleClear={handleClear}
            formatPhoneString={formatPhoneString}
            nomInputRef={nomInputRef}
            resultsCount={results.length}
          />

          <SearchResults
            results={results}
            hasSearched={hasSearched}
            selectedCentreId={selectedCentreId}
            user={user}
            userCentre={userCentre}
            setSelectedCarte={setSelectedCarte}
            setShowReportModal={setShowReportModal}
            setModalStep={setModalStep}
            setShowProofModal={setShowProofModal}
            isAgentAuthorisedForCard={isAgentAuthorisedForCard}
            cloudResults={cloudResults}
            isCloudSearching={isCloudSearching}
            cloudSearchDone={cloudSearchDone}
            setCloudResults={setCloudResults}
            onCloseNotFound={resetSearchFields}
          />
        </>
      )}

      {showInversionModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="card" style={{ maxWidth: 500, width: '100%', padding: 32, textAlign: 'center', border: '1px solid rgba(251, 191, 36, 0.3)' }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, background: 'rgba(251,191,36,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <AlertTriangle size={28} color="#fbbf24" />
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 900, color: 'white', margin: '0 0 12px 0' }}>
              Inversion Nom/Prénom Détectée ?
            </h3>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 24 }}>
              Vous avez saisi "<span style={{ color: 'white', fontWeight: 700 }}>{nomSaisiInfo} {prenomSaisiInfo}</span>".<br/>
              Le système a trouvé une carte correspondant à l'inversion :<br/>
              "<span style={{ color: '#fbbf24', fontWeight: 800 }}>{prenomSaisiInfo} {nomSaisiInfo}</span>".
              <br/><br/>
              Est-ce la carte recherchée ?
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handleConfirmInversion} className="btn btn-primary" style={{ flex: 1 }}>
                Oui, c'est celle-ci
              </button>
              <button onClick={handleRejectInversion} className="btn btn-secondary" style={{ flex: 1 }}>
                Non
              </button>
            </div>
          </div>
        </div>
      )}

      <DeliveryModal
        showReportModal={showReportModal}
        modalStep={modalStep}
        setModalStep={setModalStep}
        selectedCarte={selectedCarte}
        nomRetirant={nomRetirant}
        setNomRetirant={setNomRetirant}
        telRetirant={telRetirant}
        setTelRetirant={setTelRetirant}
        retirantType={retirantType}
        setRetirantType={setRetirantType}
        emergencyRangement={emergencyRangement}
        setEmergencyRangement={setEmergencyRangement}
        isFinalizing={isFinalizing}
        resetModal={resetModal}
        handleDeliver={handleDeliver}
        handleSignalerAbsence={handleSignalerAbsence}
        isUnclassifiedCard={isUnclassifiedCard}
      />

      <DeliveryProofModal
        isOpen={showProofModal}
        onClose={() => setShowProofModal(false)}
        carte={selectedCarte}
      />
    </div>
  );
}
