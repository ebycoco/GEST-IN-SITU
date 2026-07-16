import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, AlertTriangle, Loader, X, Database, Globe, CheckCircle } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';

// Hooks
import { useVerificationStats } from './hooks/useVerificationStats';
import { useVerificationSearch } from './hooks/useVerificationSearch';
import { useDeliveryFlow } from './hooks/useDeliveryFlow';

// Components
import { SearchForm } from './components/SearchForm';
import { SearchResults } from './components/SearchResults';
import { DeliveryModal } from './components/DeliveryModal';
import { StatsPanel } from './components/StatsPanel';
import { ResolusTab } from './components/ResolusTab';
import { NonResolusTab } from './components/NonResolusTab';

export default function VerificationSearchPage() {
  const user = useAuthStore((s) => s.user);
  const selectedCentreId = useAuthStore((s) => s.selectedCentreId);
  const activeSiteId = useAuthStore((s) => s.activeSiteId);
  const isAdmin = user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'SUPER ADMIN';
  const isSyncAdmin = isAdmin || user?.role === 'ADMIN_CENTRE';

  const [cardsCount, setCardsCount] = useState<number | null>(null);
  const [isCountLoading, setIsCountLoading] = useState(true);
  const [adminSiteFilter, setAdminSiteFilter] = useState<number | null>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [centres, setCentres] = useState<any[]>([]);
  const [userCentre, setUserCentre] = useState<any>(null);
  const [selectedCarte, setSelectedCarte] = useState<any | null>(null);
  const setSelectedCentreId = useAuthStore((s) => s.setSelectedCentreId);

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<'RECHERCHE' | 'RESOLUS' | 'NON_RESOLUS'>(
    tabFromUrl === 'resolus' ? 'RESOLUS' : tabFromUrl === 'non_resolus' ? 'NON_RESOLUS' : 'RECHERCHE'
  );
  
  const [cloudCartesCount, setCloudCartesCount] = useState<number>(0);

  useEffect(() => {
    if (tabFromUrl === 'resolus') {
      setActiveTab('RESOLUS');
    } else if (tabFromUrl === 'non_resolus') {
      setActiveTab('NON_RESOLUS');
    } else {
      setActiveTab('RECHERCHE');
    }
  }, [tabFromUrl]);

  // Sync state variables
  const [isPullingCards, setIsPullingCards] = useState<boolean>(false);
  const [isBulkUploading, setIsBulkUploading] = useState<boolean>(false);
  const [dirtyCartesCount, setDirtyCartesCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

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

  const fetchSyncStats = async () => {
    if (user?.site_id) {
      try {
        const unsyncedRes = await window.api.stats.getUnsyncedCardsCount(user.site_id);
        if (typeof unsyncedRes === 'number') {
          setDirtyCartesCount(unsyncedRes);
        }
        const cloudCount = await window.api.sync.getCloudCartesCount(user.site_id);
        if (typeof cloudCount === 'number') {
          setCloudCartesCount(cloudCount);
        }
      } catch (e) {
        console.error('Failed to fetch stats', e);
      }
    }
  };

  useEffect(() => {
    fetchSyncStats();
    const interval = setInterval(fetchSyncStats, 30000);
    return () => clearInterval(interval);
  }, [user?.site_id]);

  const handleStartBulkUpload = async () => {
    if (!user?.site_id) return;
    setIsBulkUploading(true);
    const toastId = toast.loading("Initialisation de l'envoi des modifications...");
    try {
      const res = await window.api.sync.startBulk(Number(user.site_id), false, false);
      if (res.success) {
        toast.success(res.message, { id: toastId });
      } else {
        toast.error(res.message || "Erreur lors de l'envoi", { id: toastId });
      }
      await fetchSyncStats();
    } catch (err: any) {
      toast.error(`Échec de l'envoi : ${err.message || err}`, { id: toastId });
    } finally {
      setIsBulkUploading(false);
    }
  };

  const handlePullSiteCards = async () => {
    if (!user?.site_id) return;
    setIsPullingCards(true);
    const toastId = toast.loading('☁️ Récupération des cartes depuis le cloud...');
    try {
      const res = await window.api.sync.pullSiteCards(Number(user.site_id), user);
      if (res.success) {
        if (res.count > 0) {
          toast.success(`✅ Récupération réussie ! ${res.count} carte(s) mise(s) à jour.`, { id: toastId, duration: 6000 });
        } else {
          toast.success("✅ Vos données locales sont déjà à jour.", { id: toastId, duration: 4000 });
        }
      } else {
        toast.error(`Échec de récupération : ${res.message || 'Erreur inconnue'}`, { id: toastId, duration: 8000 });
      }
    } catch (err: any) {
      toast.error(`Échec de récupération des cartes : ${err.message || err}`, { id: toastId });
    } finally {
      setIsPullingCards(false);
      await fetchSyncStats();
    }
  };

  const nomInputRef = useRef<HTMLInputElement>(null);

  // Étape A : Compteur de cartes
  useEffect(() => {
    window.api.database.getCardsCount()
      .then((count) => {
        setCardsCount(count);
        setIsCountLoading(false);
      })
      .catch((err) => {
        console.error('Failed to get cards count:', err);
        setIsCountLoading(false);
      });
  }, []);

  // Étape B : Chargement des sites et centres
  useEffect(() => {
    if (isAdmin) {
      if (user?.role === 'ADMINISTRATEUR_SITE' && user?.site_id) {
        setAdminSiteFilter(user.site_id);
      }
      window.api.hierarchy.getSites().then((allSites) => {
        if (user?.role === 'ADMINISTRATEUR_SITE') {
          setSites(allSites.filter((s: any) => s.id === user.site_id));
        } else {
          setSites(allSites);
        }
      }).catch(console.error);
    }
  }, [isAdmin, user]);

  useEffect(() => {
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? adminSiteFilter : user?.site_id;
    if (siteIdToUse) {
      window.api.hierarchy.getCentres(siteIdToUse).then((data) => {
        setCentres(data);
        if (data && data.length > 0) {
          const exists = data.some(c => c.id === useAuthStore.getState().selectedCentreId);
          if (!exists) {
            setSelectedCentreId(data[0].id);
          }
        }
      }).catch(console.error);
    } else {
      setCentres([]);
    }
  }, [user, adminSiteFilter]);

  // Étape C : Chargement du préfixe centre
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
      useAuthStore.getState().setInitialDataLoading(false);
    };
    loadUserCentre();
  }, [user]);

  // Hook 1 : Statistiques
  const { stats, cardsToday, loadStats, loadCardsToday } = useVerificationStats(user);

  // Hook 2 : Delivery & Validation Flow
  const {
    nomRetirant, setNomRetirant, telRetirant, setTelRetirant,
    retirantType, setRetirantType, emergencyRangement, setEmergencyRangement,
    showReportModal, setShowReportModal, modalStep, setModalStep,
    isFinalizing, resetModal, handleDeliver, isUnclassifiedCard
  } = useDeliveryFlow(
    user, selectedCentreId, activeSiteId, selectedCarte, setSelectedCarte,
    () => resetSearchFields(), loadStats, loadCardsToday, nomInputRef
  );

  // Hook 3 : Recherche
  const {
    nomComplet, setNomComplet, ddn, setDdn, lieuNaissance, setLieuNaissance,
    contact, setContact, results, hasSearched, isSearching, searchMode, setSearchMode,
    searchContactQuery, setSearchContactQuery, showInversionModal, handleConfirmInversion,
    handleRejectInversion, nomSaisiInfo, prenomSaisiInfo, handleClear, handleSearch,
    handleContactSearch, handleSignalerAbsence, resetSearchFields, formatPhoneString
  } = useVerificationSearch(
    user, activeSiteId, isAdmin, adminSiteFilter, setAdminSiteFilter,
    setSelectedCarte, setShowReportModal, setModalStep
  );

  // Sécurité Box / Prefixes
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

  if (isCountLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 }}>
        <Loader className="animate-spin" size={32} color="var(--accent-primary)" />
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Chargement des données de vérification...</p>
      </div>
    );
  }

  if (cardsCount === 0) {
    return (
      <div style={{ padding: '40px 24px', maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh' }}>
        <div className="card" style={{ 
          background: 'linear-gradient(145deg, rgba(45, 50, 85, 0.95) 0%, rgba(20, 22, 40, 0.98) 100%)',
          border: '1px solid rgba(251, 191, 36, 0.25)', 
          borderRadius: 24, 
          padding: '48px 32px', 
          maxWidth: 600,
          textAlign: 'center',
          boxShadow: '0 40px 80px rgba(0, 0, 0, 0.8), 0 0 40px rgba(251, 191, 36, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20
        }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: 'rgba(251, 191, 36, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={36} color="#fbbf24" />
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: 'white' }}>Aucune donnée disponible</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, lineHeight: 1.6 }}>
            Veuillez contacter votre Administrateur de Site pour effectuer la synchronisation initiale.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ padding: '40px 24px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header Section */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{ 
          display: 'inline-flex', 
          padding: 16, 
          background: 'var(--gradient-button)', 
          borderRadius: 20, 
          color: 'white',
          marginBottom: 20,
          boxShadow: '0 8px 24px rgba(79, 70, 229, 0.3)'
        }}>
          <Search size={32} />
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8, letterSpacing: '-0.02em' }}>
          Recherche de Carte <span style={{ color: 'var(--accent-primary)' }}>CMU</span>
        </h1>
        <p style={{ fontSize: 16, color: 'var(--text-muted)', maxWidth: 600, margin: '0 auto', marginBottom: 24 }}>
          Système de vérification de disponibilité et d'emplacement physique pour les opérateurs de vérification.
        </p>
        {!isSyncAdmin && (
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button 
              onClick={handlePullSiteCards} 
              disabled={isPullingCards || cloudCartesCount === 0}
              className="btn-outline" 
              style={{ 
                padding: '12px 24px', 
                borderRadius: 12, 
                fontWeight: 700,
                cursor: (isPullingCards || cloudCartesCount === 0) ? 'not-allowed' : 'pointer',
                opacity: (isPullingCards || cloudCartesCount === 0) ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(255, 255, 255, 0.03)',
                color: 'white',
                whiteSpace: 'nowrap'
              }}
            >
              <Database size={18} style={{ animation: isPullingCards ? 'spin 1.5s linear infinite' : 'none' }} />
              {isPullingCards ? 'RÉCUPÉRATION EN COURS...' : `RÉCUPÉRER LES CARTES DEPUIS LE CLOUD${cloudCartesCount > 0 ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
            </button>

            <button 
              onClick={handleStartBulkUpload} 
              disabled={isBulkUploading || dirtyCartesCount === 0}
              className="btn-plein-soleil" 
              style={{ 
                padding: '12px 24px', 
                borderRadius: 12, 
                fontWeight: 700,
                backgroundColor: (isBulkUploading || dirtyCartesCount === 0) ? '#555555' : '#FFE600',
                color: (isBulkUploading || dirtyCartesCount === 0) ? '#ffffff' : '#000000',
                border: '1px solid #FFE600',
                cursor: (isBulkUploading || dirtyCartesCount === 0) ? 'not-allowed' : 'pointer',
                opacity: (isBulkUploading || dirtyCartesCount === 0) ? 0.5 : 1,
                boxShadow: '0 4px 15px rgba(255, 230, 0, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s ease-in-out',
                whiteSpace: 'nowrap'
              }}
            >
              <Globe size={18} style={{ animation: isBulkUploading ? 'spin 1.5s linear infinite' : 'none' }} />
              {isBulkUploading ? 'ENVOI EN COURS...' : `ENVOYER LES CARTES VERS LE CLOUD${dirtyCartesCount > 0 ? ` (${dirtyCartesCount})` : ''}`}
            </button>
          </div>
        )}
      </div>

      {/* Sélecteur de centre de travail interne pour la recherche Admin */}
      {isAdmin && (
        <div style={{ maxWidth: 800, margin: '0 auto 32px auto', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(23, 23, 37, 0.45)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 14, padding: '16px 20px' }}>
          <MapPin size={16} style={{ color: '#FFD700', flexShrink: 0 }} />
          <label style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Centre de travail actuel :
          </label>
          <select
            value={selectedCentreId || ''}
            onChange={(e) => setSelectedCentreId(e.target.value === '' ? null : Number(e.target.value))}
            style={{
              flex: 1,
              padding: '10px 14px',
              background: '#000',
              border: '1px solid #FFD700',
              borderRadius: 10,
              color: '#FFD700',
              fontSize: 14,
              fontWeight: 700,
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            <option value="">🌍 Tous les centres (Recherche Globale)</option>
            {centres
              .filter((c: any) => {
                const adminSiteId = user?.role === 'SUPER ADMIN' ? adminSiteFilter : user?.site_id;
                return Number(c.site_id) === Number(adminSiteId);
              })
              .map((c: any) => (
                <option key={c.id} value={c.id}>{c.nom} (N°{c.numero})</option>
              ))
            }
          </select>
        </div>
      )}

      {/* TABS */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 32, borderBottom: '1px solid var(--border-color)', paddingBottom: 16 }}>
        <button
          onClick={() => setActiveTab('RECHERCHE')}
          style={{
            padding: '12px 24px',
            borderRadius: 12,
            background: activeTab === 'RECHERCHE' ? 'rgba(79, 70, 229, 0.1)' : 'transparent',
            color: activeTab === 'RECHERCHE' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            border: `1px solid ${activeTab === 'RECHERCHE' ? 'rgba(79, 70, 229, 0.3)' : 'transparent'}`,
            fontWeight: activeTab === 'RECHERCHE' ? 800 : 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: 8
          }}
        >
          <Search size={18} />
          Recherche Manuelle
        </button>
        <button
          onClick={() => setActiveTab('NON_RESOLUS')}
          style={{
            padding: '12px 24px',
            borderRadius: 12,
            background: activeTab === 'NON_RESOLUS' ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
            color: activeTab === 'NON_RESOLUS' ? '#ef4444' : 'var(--text-secondary)',
            border: `1px solid ${activeTab === 'NON_RESOLUS' ? 'rgba(239, 68, 68, 0.3)' : 'transparent'}`,
            fontWeight: activeTab === 'NON_RESOLUS' ? 800 : 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: 8
          }}
        >
          <AlertTriangle size={18} />
          Signalements Non Résolus
        </button>
        <button
          onClick={() => setActiveTab('RESOLUS')}
          style={{
            padding: '12px 24px',
            borderRadius: 12,
            background: activeTab === 'RESOLUS' ? 'rgba(39, 174, 96, 0.1)' : 'transparent',
            color: activeTab === 'RESOLUS' ? '#27ae60' : 'var(--text-secondary)',
            border: `1px solid ${activeTab === 'RESOLUS' ? 'rgba(39, 174, 96, 0.3)' : 'transparent'}`,
            fontWeight: activeTab === 'RESOLUS' ? 800 : 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: 8
          }}
        >
          <CheckCircle size={18} />
          Historique Résolus
        </button>
      </div>

      {activeTab === 'RECHERCHE' && (
        <>
          {/* Formulaire de recherche */}
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

          {/* Tableau des résultats */}
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

      {activeTab === 'NON_RESOLUS' && <NonResolusTab />}
      {activeTab === 'RESOLUS' && <ResolusTab />}

      {/* Bandeau Stats */}
      <StatsPanel stats={stats} cardsToday={cardsToday} />

      {/* Modale de confirmation d'inversion Nom/Prénom */}
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

      {/* Modale de validation de retrait / livraison */}
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
