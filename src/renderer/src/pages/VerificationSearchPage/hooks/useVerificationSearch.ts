import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

const convertToISODate = (dateStr: string): string => {
  if (!dateStr || dateStr.length !== 10) return dateStr;
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return `${year}-${month}-${day}`;
  }
  return dateStr;
};

export function useVerificationSearch(
  user: any,
  activeSiteId: number | null,
  isAdmin: boolean,
  adminSiteFilter: number | null,
  setAdminSiteFilter: (id: number | null) => void,
  setSelectedCarte: (c: any) => void,
  setShowReportModal: (b: boolean) => void,
  setModalStep: (s: number) => void
) {
  const [nomComplet, setNomComplet] = useState('');
  const [ddn, setDdn] = useState('');
  const [lieuNaissance, setLieuNaissance] = useState('');
  const [contact, setContact] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<'name' | 'contact'>('name');
  const [searchContactQuery, setSearchContactQuery] = useState('+225 ');

  // Modal inversion states
  const [showInversionModal, setShowInversionModal] = useState(false);
  const [carteTrouveeParInversion, setCarteTrouveeParInversion] = useState<any | null>(null);
  const [nomSaisiInfo, setNomSaisiInfo] = useState('');
  const [prenomSaisiInfo, setPrenomSaisiInfo] = useState('');

  // Absences lists
  const [myAbsences, setMyAbsences] = useState<any[]>([]);

  const loadMyReportedAbsences = async () => {
    if (user?.login && user?.site_id) {
      try {
        const res = await window.api.cartes.getAgentAbsences(user.login, user.site_id);
        setMyAbsences(res || []);
      } catch (err) {
        console.error('Failed to load my reported absences:', err);
      }
    }
  };

  useEffect(() => {
    if (user) {
      loadMyReportedAbsences();
    }
  }, [user]);

  const handleClear = () => {
    setNomComplet('');
    setDdn('');
    setLieuNaissance('');
    setContact('');
    setResults([]);
    setHasSearched(false);
    toast.success('Champs réinitialisés');
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchMode !== 'name') return;
    if (!nomComplet.trim() || ddn.length !== 10) {
      toast.error('Veuillez remplir le Nom & Prénoms et une Date de Naissance valide (JJ/MM/AAAA).');
      return;
    }

    setIsSearching(true);
    try {
      const query = nomComplet.trim();
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const isoDdn = convertToISODate(ddn);
      const filters: any = { 
        date_de_naissance: isoDdn,
        exclude_delivered: 'false'
      };
      if (user?.role === 'ADMINISTRATEUR_SITE') {
        filters.site_id = (user.site_id || 0).toString();
      } else if (user?.role === 'SUPER ADMIN') {
        if (adminSiteFilter !== null) {
          filters.site_id = adminSiteFilter.toString();
        }
      } else {
        if (siteIdToUse) filters.site_id = siteIdToUse.toString();
      }
      if (lieuNaissance.trim()) filters.lieu_de_naissance = lieuNaissance.trim();
      if (contact.trim()) {
        const cleanDigits = contact.replace(/\D/g, '');
        const localDigits = cleanDigits.startsWith('225') ? cleanDigits.slice(3) : cleanDigits;
        filters.contact = `%${localDigits.split('').join('%')}%`;
      }

      const res = await window.api.cartes.search(query, 50, filters);
      const searchResults = res || [];

      const tokens = nomComplet.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
      const nomSaisi = tokens[0] || '';
      const prenomSaisi = tokens.slice(1).join(' ');

      const directMatches = prenomSaisi
        ? searchResults.filter((r: any) =>
            r.noms?.toUpperCase() === nomSaisi.toUpperCase() &&
            r.prenoms?.toUpperCase().includes(prenomSaisi.toUpperCase())
          )
        : searchResults.filter((r: any) =>
            r.noms?.toUpperCase() === nomSaisi.toUpperCase()
          );

      if (directMatches.length > 0) {
        setResults(directMatches);
        setHasSearched(true);
        if (directMatches.length === 1 && directMatches[0].statut_physique !== 'ABSENT') {
          setSelectedCarte(directMatches[0]);
          setShowReportModal(true);
          setModalStep(1);
        } else {
          setSelectedCarte(null);
        }
      } else if (prenomSaisi) {
        const invertedMatches = searchResults.filter((r: any) =>
          r.noms?.toUpperCase() === prenomSaisi.toUpperCase() &&
          r.prenoms?.toUpperCase().includes(nomSaisi.toUpperCase())
        );

        if (invertedMatches.length > 0) {
          setNomSaisiInfo(nomSaisi);
          setPrenomSaisiInfo(prenomSaisi);
          setCarteTrouveeParInversion(invertedMatches[0]);
          setShowInversionModal(true);
        } else {
          setResults(searchResults);
          setHasSearched(true);
          setSelectedCarte(null);
        }
      } else {
        setResults(searchResults);
        setHasSearched(true);
        setSelectedCarte(null);
      }
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de la recherche.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleConfirmInversion = () => {
    setShowInversionModal(false);
    const carte = carteTrouveeParInversion!;
    setResults([carte]);
    setHasSearched(true);
    if (carte.statut_physique !== 'ABSENT') {
      setSelectedCarte(carte);
      setShowReportModal(true);
      setModalStep(1);
    } else {
      setSelectedCarte(null);
    }
    setCarteTrouveeParInversion(null);
  };

  const handleRejectInversion = () => {
    setShowInversionModal(false);
    setCarteTrouveeParInversion(null);
    setNomComplet('');
    setDdn('');
    setResults([]);
    setHasSearched(false);
  };

  const formatPhoneString = (value: string): string => {
    let input = value;
    if (!input.startsWith('+225 ')) {
      input = '+225 ';
    }
    const localPart = input.slice(5);
    const digitsOnly = localPart.replace(/\D/g, '');
    const truncatedDigits = digitsOnly.slice(0, 10);
    const formattedParts = truncatedDigits.match(/.{1,2}/g);
    const formattedLocal = formattedParts ? formattedParts.join(' ') : '';
    return `+225 ${formattedLocal}`;
  };

  const handleContactSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchContactQuery.trim()) {
      toast.error('Veuillez saisir un numéro de téléphone.');
      return;
    }
    setIsSearching(true);
    try {
      const cleanDigits = searchContactQuery.replace(/\D/g, '');
      const localDigits = cleanDigits.startsWith('225') ? cleanDigits.slice(3) : cleanDigits;
      if (localDigits.length !== 10) {
        toast.error('Veuillez saisir un numéro ivoirien valide à 10 chiffres.');
        setIsSearching(false);
        return;
      }
      
      const contactPattern = `%${localDigits.split('').join('%')}%`;
      const filters: any = {
        contact: contactPattern,
        exclude_delivered: 'false'
      };
      if (user?.role === 'ADMINISTRATEUR_SITE') {
        filters.site_id = (user.site_id || 0).toString();
      } else if (user?.role === 'SUPER ADMIN') {
        if (adminSiteFilter !== null) {
          filters.site_id = adminSiteFilter.toString();
        }
      } else {
        const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
        if (siteIdToUse) filters.site_id = siteIdToUse.toString();
      }
      
      const res = await window.api.cartes.search('', 100, filters);
      const searchResults = res || [];
      
      setResults(searchResults);
      setHasSearched(true);
      
      if (searchResults.length === 1 && searchResults[0].statut_physique !== 'ABSENT') {
        setSelectedCarte(searchResults[0]);
        setShowReportModal(true);
        setModalStep(1);
      } else {
        setSelectedCarte(null);
      }
    } catch (e) {
      console.error(e);
      toast.error('Échec de la recherche par contact.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSignalerAbsence = async (selectedCarte: any) => {
    if (!selectedCarte) return;
    try {
      const consultantName = user 
        ? `${user.prenom_user || ''} ${user.nom_user || ''}`.trim() || user.login 
        : 'OPERATEUR_VERIFICATION';
      const roleText = user ? user.role.toLowerCase() : 'operateur_verification';
      const agentInfo = `${consultantName} (${roleText})`;
      
      await window.api.cartes.signalerAbsence(selectedCarte.id_carte, agentInfo);
      toast.success('Absence physique signalée. Traitement admin en cours.');
      
      setShowReportModal(false);
      setSelectedCarte(null);
      setModalStep(1);
      
      setNomComplet('');
      setDdn('');
      setSearchContactQuery('+225 ');
      setResults([]);
      setHasSearched(false);
      setLieuNaissance('');
      setContact('');
      
      loadMyReportedAbsences();
    } catch (err) {
      console.error('Failed to report absence:', err);
      toast.error('Erreur lors du signalement.');
    }
  };

  const resetSearchFields = () => {
    setNomComplet('');
    setDdn('');
    setSearchContactQuery('+225 ');
    setResults([]);
    setHasSearched(false);
    setLieuNaissance('');
    setContact('');
  };

  return {
    nomComplet,
    setNomComplet,
    ddn,
    setDdn,
    lieuNaissance,
    setLieuNaissance,
    contact,
    setContact,
    results,
    setResults,
    hasSearched,
    setHasSearched,
    isSearching,
    searchMode,
    setSearchMode,
    searchContactQuery,
    setSearchContactQuery,
    showInversionModal,
    handleConfirmInversion,
    handleRejectInversion,
    nomSaisiInfo,
    prenomSaisiInfo,
    myAbsences,
    loadMyReportedAbsences,
    handleClear,
    handleSearch,
    handleContactSearch,
    handleSignalerAbsence,
    resetSearchFields,
    formatPhoneString
  };
}
