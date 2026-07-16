import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { AlertTriangle } from 'lucide-react';

import { useVerificationSearch } from '../../VerificationSearchPage/hooks/useVerificationSearch';
import { useDeliveryFlow } from '../../VerificationSearchPage/hooks/useDeliveryFlow';

import { SearchForm } from '../../VerificationSearchPage/components/SearchForm';
import { SearchResults } from '../../VerificationSearchPage/components/SearchResults';
import { DeliveryModal } from '../../VerificationSearchPage/components/DeliveryModal';

export default function RechercheView() {
  const { user, selectedCentreId, activeSiteId } = useAuthStore();
  const [adminSiteFilter, setAdminSiteFilter] = useState<number | null>(null);
  const [selectedCarte, setSelectedCarte] = useState<any | null>(null);
  const [userCentre, setUserCentre] = useState<any>(null);
  const [totalCards, setTotalCards] = useState<number | null>(null);
  const nomInputRef = useRef<HTMLInputElement>(null);

  // Pour la vue Agent, on ne charge pas les stats ici
  const loadStatsMock = async () => {};
  const loadCardsTodayMock = async () => {};

  useEffect(() => {
    const loadUserCentre = async () => {
      if (user?.centre_id) {
        try {
          const siteIdToUse = user.site_id;
          const centres = await window.api.hierarchy.getCentres(siteIdToUse || undefined);
          const centreObj = centres.find((c: any) => c.id === user.centre_id);
          setUserCentre(centreObj);
        } catch (err) {
          console.error('Failed to load user centre prefix:', err);
        }
      }
    };
    loadUserCentre();
  }, [user]);

  useEffect(() => {
    const fetchTotal = async () => {
      if (activeSiteId) {
        try {
          const stats = await window.api.stats.get(activeSiteId, selectedCentreId || undefined);
          setTotalCards(stats?.total || 0);
        } catch (e) {
          setTotalCards(0);
        }
      }
    };
    fetchTotal();
  }, [activeSiteId, selectedCentreId]);

  const {
    nomRetirant, setNomRetirant, telRetirant, setTelRetirant,
    retirantType, setRetirantType, emergencyRangement, setEmergencyRangement,
    showReportModal, setShowReportModal, modalStep, setModalStep,
    isFinalizing, resetModal, handleDeliver, isUnclassifiedCard
  } = useDeliveryFlow(
    user, selectedCentreId, activeSiteId, selectedCarte, setSelectedCarte,
    () => resetSearchFields(), loadStatsMock, loadCardsTodayMock, nomInputRef
  );

  const {
    nomComplet, setNomComplet, ddn, setDdn, lieuNaissance, setLieuNaissance,
    contact, setContact, results, hasSearched, isSearching, searchMode, setSearchMode,
    searchContactQuery, setSearchContactQuery, showInversionModal, handleConfirmInversion,
    handleRejectInversion, nomSaisiInfo, prenomSaisiInfo, handleClear, handleSearch,
    handleContactSearch, handleSignalerAbsence, resetSearchFields, formatPhoneString
  } = useVerificationSearch(
    user, activeSiteId, false, adminSiteFilter, setAdminSiteFilter,
    setSelectedCarte, setShowReportModal, setModalStep
  );

  const isAgentAuthorisedForCard = (carteToCheck: any): boolean => {
    if (user?.role === 'SUPER ADMIN') return true;
    if (user?.site_id !== carteToCheck?.site_id) return false;
    if (user?.role === 'ADMINISTRATEUR_SITE') return true;

    if (!userCentre || !userCentre.prefixe_rangement || !carteToCheck?.rangement) {
      return user?.centre_id === carteToCheck?.centre_id;
    }

    const agentPrefixes = userCentre.prefixe_rangement.split(',').map((p: string) => p.trim().toUpperCase());
    const cardRangementUpper = carteToCheck.rangement.trim().toUpperCase();

    return agentPrefixes.some((prefix: string) => cardRangementUpper.startsWith(prefix));
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200, margin: '0 auto' }}>
      
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
            isAgentAuthorisedForCard={isAgentAuthorisedForCard}
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
    </div>
  );
}
