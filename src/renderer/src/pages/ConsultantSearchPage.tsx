import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, Phone, AlertTriangle, CheckCircle, Package, Calendar, Clock, User, X, ShieldCheck, ArrowRight, XCircle, RotateCcw, Loader } from 'lucide-react';
import toast from 'react-hot-toast';
import DateInput from '../components/DateInput';
import CentreContextSwitcher from '../components/layout/CentreContextSwitcher';
import { useAuthStore } from '../stores/authStore';

const convertToISODate = (dateStr: string): string => {
  if (!dateStr || dateStr.length !== 10) return dateStr;
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return `${year}-${month}-${day}`;
  }
  return dateStr;
};

export default function ConsultantSearchPage() {
  const user = useAuthStore((s) => s.user);
  const selectedCentreId = useAuthStore((s) => s.selectedCentreId);
  const activeSiteId = useAuthStore((s) => s.activeSiteId);
  
  const [noms, setNoms] = useState('');
  const [prenoms, setPrenoms] = useState('');
  const [ddn, setDdn] = useState('');
  
  // Extra fields when there are homonyms
  const [lieuNaissance, setLieuNaissance] = useState('');
  const [contact, setContact] = useState('');
  
  const [results, setResults] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  
  const [selectedCarte, setSelectedCarte] = useState<any | null>(null);
  const [searchMode, setSearchMode] = useState<'name' | 'contact'>('name');
  const [searchContactQuery, setSearchContactQuery] = useState('+225 ');
  const isRefinementRequired = searchMode === 'name' && results.length > 2 && !lieuNaissance.trim() && !contact.trim();
  const [showReportModal, setShowReportModal] = useState(false);
  const [modalStep, setModalStep] = useState(1); // 1: Verification, 2: Finalize
  const [nomRetirant, setNomRetirant] = useState('');
  const [telRetirant, setTelRetirant] = useState('');
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [stats, setStats] = useState<{ today: number; yesterday: number; week: number; month: number; year: number; last7Days?: { dayName: string; count: number }[] }>({ today: 0, yesterday: 0, week: 0, month: 0, year: 0 });
  const [cardsToday, setCardsToday] = useState<any[]>([]);
  const [retirantType, setRetirantType] = useState('lui-meme');
  const [myAbsences, setMyAbsences] = useState<any[]>([]);
  const nomInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (retirantType === 'lui-meme' && selectedCarte) {
      setNomRetirant(`${selectedCarte.noms} ${selectedCarte.prenoms}`.trim().toUpperCase());
      if (selectedCarte.contact) {
        // Formater le contact existant
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

  const loadStats = async () => {
    if (user?.login && user?.site_id) {
      try {
        const res = await window.api.stats.getConsultant(user.login, user.site_id);
        if (res) setStats(res);
      } catch (err) {
        console.error('Failed to load consultant stats:', err);
      }
    }
  };

  const loadCardsToday = async () => {
    if (user?.login && user?.site_id) {
      try {
        const res = await window.api.stats.getCardsToday(user.login, user.site_id);
        if (res) setCardsToday(res);
      } catch (err) {
        console.error('Failed to load consultant cards today:', err);
      }
    }
  };

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
    loadStats();
    loadCardsToday();
    loadMyReportedAbsences();
  }, [user]);

  useEffect(() => {
    if (window.api && window.api.onDatabaseUpdated) {
      const unsubscribe = window.api.onDatabaseUpdated(() => {
        loadMyReportedAbsences();
      });
      return () => unsubscribe();
    }
  }, [user]);

  const resetModal = () => {
    setShowReportModal(false);
    setSelectedCarte(null);
    setModalStep(1);
    setNomRetirant('');
    setTelRetirant('');
    setRetirantType('lui-meme');
  };

  const handleClear = () => {
    setNoms('');
    setPrenoms('');
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
    if (!noms.trim() || !prenoms.trim() || ddn.length !== 10) {
      toast.error('Veuillez remplir Nom, Prénom et une Date de Naissance valide (JJ/MM/AAAA).');
      return;
    }

    setIsSearching(true);
    try {
      const query = `${noms.trim()} ${prenoms.trim()}`;
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const isoDdn = convertToISODate(ddn);
      const filters: any = { 
        date_de_naissance: isoDdn,
        exclude_delivered: 'false'
      };
      if (siteIdToUse) filters.site_id = siteIdToUse.toString();
      if (lieuNaissance.trim()) filters.lieu_de_naissance = lieuNaissance.trim();
      if (contact.trim()) {
        const cleanDigits = contact.replace(/\D/g, '');
        const localDigits = cleanDigits.startsWith('225') ? cleanDigits.slice(3) : cleanDigits;
        filters.contact = `%${localDigits.split('').join('%')}%`;
      }

      console.log("🔍 [RENDERER] Paramètres envoyés à l'API :", { 
        noms, 
        prenoms, 
        ddnOriginal: ddn, 
        ddnConverted: isoDdn, 
        siteIdToUse, 
        filters, 
        userRole: user?.role 
      });

      const res = await window.api.cartes.search(query, 50, filters);
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
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de la recherche.');
    } finally {
      setIsSearching(false);
    }
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

  const handleContactChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchContactQuery(formatPhoneString(e.target.value));
  };

  const handleRefinementContactChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || val === '+225' || val === '+225 ') {
      setContact('');
    } else {
      setContact(formatPhoneString(val));
    }
  };

  const handleTelRetirantChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (val === '' || val === '+225' || val === '+225 ') {
      setTelRetirant('');
    } else {
      setTelRetirant(formatPhoneString(val));
    }
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
      
      // Build a flexible SQL LIKE pattern from the 10 digits
      const contactPattern = `%${localDigits.split('').join('%')}%`;
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const filters: any = {
        contact: contactPattern,
        exclude_delivered: 'false'
      };
      if (siteIdToUse) filters.site_id = siteIdToUse.toString();
      
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

  const handleSignalerAbsence = async () => {
    if (!selectedCarte) return;
    try {
      const auth = localStorage.getItem('gest-in-situ-auth');
      const agent = auth ? JSON.parse(auth).state?.user?.login : 'CONSULTANT';
      
      await window.api.cartes.signalerAbsence(selectedCarte.id_carte, agent);
      toast.success('Absence physique signalée. Traitement admin en cours.');
      
      // Explicitly close modal and reset selected card state
      setShowReportModal(false);
      setSelectedCarte(null);
      setModalStep(1);
      
      if (searchMode === 'name') {
        handleSearch({ preventDefault: () => {} } as any);
      } else {
        handleContactSearch({ preventDefault: () => {} } as any);
      }
      loadMyReportedAbsences();
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du signalement.');
    }
  };

  const handleDeliver = async () => {
    if (!nomRetirant.trim() || !telRetirant.trim()) {
      toast.error('Veuillez remplir les informations du retirant.');
      return;
    }

    setIsFinalizing(true);
    try {
      if (user?.role === 'ADMINISTRATEUR' && !selectedCentreId) {
        toast.error('Veuillez sélectionner un centre de travail en haut de la page.');
        setIsFinalizing(false);
        return;
      }

      const agent = user?.login || 'CONSULTANT';

      // Get the name of the selected centre
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const centres = await window.api.hierarchy.getCentres(siteIdToUse || undefined);
      const centreName = centres.find((c: any) => c.id === selectedCentreId)?.nom || '';

      await window.api.cartes.delivrer(selectedCarte.id_carte, {
        nom_retirant: nomRetirant.trim().toUpperCase(),
        num_retirant: telRetirant.trim(),
        agent_distributeur: agent,
        centre_retrait: centreName
      }, {
        role: user?.role,
        site_id: user?.site_id
      });

      toast.success('Carte délivrée avec succès !');
      resetModal();
      await loadStats();
      await loadCardsToday();
      setNoms('');
      setPrenoms('');
      setDdn('');
      setResults([]);
      setHasSearched(false);
      setTimeout(() => {
        nomInputRef.current?.focus();
      }, 50);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de la délivrance.');
    } finally {
      setIsFinalizing(false);
    }
  };

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
        <p style={{ fontSize: 16, color: 'var(--text-muted)', maxWidth: 600, margin: '0 auto' }}>
          Système de vérification de disponibilité et d'emplacement physique pour les agents consultants.
        </p>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto 32px auto' }}>
        <CentreContextSwitcher />
      </div>

      {/* KPI Section */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 16,
        maxWidth: 800,
        margin: '0 auto 32px auto',
        animation: 'fadeIn 0.5s ease-out'
      }}>
        {[
          { label: "Aujourd'hui", value: stats.today, icon: Clock, color: 'var(--accent-primary)' },
          { label: "Hier", value: stats.yesterday, icon: Calendar, color: 'var(--text-muted)' },
          { label: "Cette Semaine", value: stats.week, icon: Calendar, color: 'var(--accent-secondary)' },
          { label: "Ce Mois", value: stats.month, icon: Calendar, color: 'var(--accent-green)' },
          { label: "Cette Année", value: stats.year, icon: Calendar, color: 'var(--warning-color)' }
        ].map((kpi, idx) => (
          <div key={idx} className="premium-glass-card" style={{
            background: 'rgba(23, 23, 37, 0.45)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: 14,
            padding: '16px 12px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <kpi.icon size={12} color={kpi.color} /> {kpi.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'white', marginTop: 2 }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Search Form Card */}
      <div className="card" style={{ 
        maxWidth: 800, 
        margin: '0 auto 48px auto', 
        padding: 32,
        background: 'rgba(23, 23, 37, 0.7)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border-color)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
      }}>
        {/* Search Mode Tabs */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 16 }}>
          <button 
            type="button"
            onClick={() => { setSearchMode('name'); setResults([]); setHasSearched(false); }}
            style={{ 
              background: 'none', border: 'none', color: searchMode === 'name' ? 'var(--accent-primary)' : 'var(--text-muted)', 
              fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: '8px 16px',
              borderBottom: searchMode === 'name' ? '2px solid var(--accent-primary)' : 'none'
            }}
          >
            Recherche par État Civil
          </button>
          <button 
            type="button"
            onClick={() => { setSearchMode('contact'); setSearchContactQuery('+225 '); setResults([]); setHasSearched(false); }}
            style={{ 
              background: 'none', border: 'none', color: searchMode === 'contact' ? 'var(--accent-primary)' : 'var(--text-muted)', 
              fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: '8px 16px',
              borderBottom: searchMode === 'contact' ? '2px solid var(--accent-primary)' : 'none'
            }}
          >
            Recherche par Téléphone
          </button>
        </div>

        {searchMode === 'name' ? (
          <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <User size={14} /> Nom de famille <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input 
                    ref={nomInputRef}
                    type="text" 
                    className="form-input" 
                    value={noms} 
                    onChange={e => setNoms(e.target.value.toUpperCase())} 
                    placeholder="Ex: KONE" 
                    style={{ height: 48, fontSize: 16 }}
                    required 
                  />
                </div>
                <div>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <User size={14} /> Prénoms <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={prenoms} 
                    onChange={e => setPrenoms(e.target.value.toUpperCase())} 
                    placeholder="Ex: ADAMA" 
                    style={{ height: 48, fontSize: 16 }}
                    required 
                  />
                </div>
              </div>
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <DateInput 
                label={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Calendar size={14} /> Date de naissance <span style={{ color: '#ef4444' }}>*</span>
                  </span>
                }
                value={ddn} 
                onChange={setDdn} 
                required 
                style={{ height: 48, fontSize: 16 }}
              />
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                Format obligatoire : JJ/MM/AAAA
              </p>
            </div>
          </div>

          {hasSearched && results.length > 2 && (
            <div className="animate-slide-up" style={{ 
              padding: 20, 
              background: 'rgba(245, 158, 11, 0.05)', 
              borderRadius: 12, 
              border: '1px solid rgba(245, 158, 11, 0.2)' 
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, color: 'var(--warning-color)' }}>
                <AlertTriangle size={20} />
                <span style={{ fontWeight: 600 }}>Affiner la recherche ({results.length} résultats trouvés)</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <MapPin size={14} /> Lieu de naissance
                  </label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={lieuNaissance} 
                    onChange={e => setLieuNaissance(e.target.value.toUpperCase())} 
                    placeholder="Ex: ABOBO" 
                    style={{ background: 'var(--bg-secondary)' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Phone size={14} /> Contact téléphonique
                  </label>
                  <input 
                    type="text" 
                    className="form-input" 
                    value={contact} 
                    onChange={handleRefinementContactChange} 
                    placeholder="+225 07 57 39 91 15" 
                    style={{ background: 'var(--bg-secondary)' }}
                  />
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={isSearching}
              style={{ 
                width: '100%', 
                height: 56, 
                fontSize: 18, 
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                borderRadius: 12
              }}
            >
              {isSearching ? (
                <>
                  <div className="spinner" style={{ width: 20, height: 20, borderTopColor: 'transparent' }} />
                  Recherche en cours...
                </>
              ) : (
                <>
                  <Search size={20} />
                  Lancer la recherche
                </>
              )}
            </button>

            {hasSearched && (
              <button 
                type="button" 
                onClick={handleClear}
                className="btn btn-secondary animate-fade-in"
                style={{ 
                  width: '100%', 
                  height: 48, 
                  fontSize: 16, 
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  borderRadius: 12,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--text-muted)'
                }}
              >
                <RotateCcw size={18} />
                Vider les champs pour une nouvelle saisie
              </button>
            )}
          </div>
          </form>
        ) : (
          <form onSubmit={handleContactSearch} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Phone size={14} /> Numéro de téléphone du bénéficiaire <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input 
                type="text" 
                className="form-input" 
                value={searchContactQuery} 
                onChange={handleContactChange} 
                placeholder="+225 07 57 39 91 15" 
                style={{ height: 48, fontSize: 16 }}
                required 
              />
            </div>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={isSearching}
              style={{ height: 48, borderRadius: 12, fontWeight: 700, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {isSearching ? <Loader className="animate-spin" /> : 'Rechercher par Téléphone'}
            </button>

            {hasSearched && (
              <button 
                type="button" 
                onClick={() => {
                  setSearchContactQuery('+225 ');
                  setResults([]);
                  setHasSearched(false);
                  toast.success('Champ réinitialisé');
                }}
                className="btn btn-secondary animate-fade-in"
                style={{ 
                  width: '100%', 
                  height: 48, 
                  fontSize: 16, 
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  borderRadius: 12,
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'var(--text-muted)'
                }}
              >
                <RotateCcw size={18} />
                Vider le champ pour une nouvelle saisie
              </button>
            )}
          </form>
        )}
      </div>

      {hasSearched && (
        <div className="card animate-slide-up" style={{ padding: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 20 }}>Résultats de recherche ({results.length})</h3>
              {results.length > 1 && (
                <span className="badge" style={{ 
                  background: isRefinementRequired ? 'rgba(239, 68, 68, 0.1)' : undefined, 
                  color: isRefinementRequired ? '#ef4444' : undefined,
                  border: isRefinementRequired ? '1px solid rgba(239, 68, 68, 0.2)' : undefined
                }}>
                  {isRefinementRequired ? 'Affinage requis' : 'Sélectionnez une carte pour vérification'}
                </span>
              )}
            </div>
            {isRefinementRequired && (
              <div style={{ 
                padding: '12px 16px', 
                background: 'rgba(239, 68, 68, 0.08)', 
                border: '1px solid rgba(239, 68, 68, 0.2)', 
                borderRadius: 10, 
                color: '#ff6b6b', 
                fontSize: 14, 
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                animation: 'fadeIn 0.2s ease-out'
              }}>
                <AlertTriangle size={16} /> Veuillez affiner votre recherche en renseignant le lieu de naissance ou le contact ci-dessus pour débloquer la vérification.
              </div>
            )}
          </div>
          
          {results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
              <Package size={64} style={{ opacity: 0.1, margin: '0 auto 20px auto' }} />
              <p style={{ fontSize: 18 }}>Aucun résultat pour ce requérant sur ce site.</p>
            </div>
          ) : (
            <div className="table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Assuré / N° Sécu</th>
                    <th>Informations Naissance</th>
                    <th>Rangement Physique</th>
                    <th>Statut Stock</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.id_carte}>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{r.noms} {r.prenoms}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {r.num_secu || 'N/A'}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 14 }}>{r.date_de_naissance}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.lieu_de_naissance}</div>
                      </td>
                      <td>
                        <div style={{ 
                          display: 'inline-flex',
                          padding: '4px 12px',
                          background: 'rgba(79, 70, 229, 0.1)',
                          color: 'var(--accent-primary)',
                          borderRadius: 6,
                          fontWeight: 600,
                          fontSize: 13,
                          border: '1px solid rgba(79, 70, 229, 0.2)'
                        }}>
                          {r.rangement || 'NON CLASSÉ'}
                        </div>
                      </td>
                      <td>
                        <span className="badge" style={{
                          background: r.statut === 'EN STOCK' ? 'rgba(46, 204, 113, 0.1)' : 'rgba(231, 76, 60, 0.1)',
                          color: r.statut === 'EN STOCK' ? '#2ecc71' : '#e74c3c'
                        }}>
                          {r.statut}
                        </span>
                      </td>
                      <td>
                        <button 
                          className="btn btn-secondary" 
                          disabled={isRefinementRequired}
                          style={{ 
                            padding: '8px 16px', 
                            fontSize: 13, 
                            borderRadius: 8,
                            opacity: isRefinementRequired ? 0.5 : 1,
                            cursor: isRefinementRequired ? 'not-allowed' : 'pointer',
                            background: isRefinementRequired ? 'rgba(255,255,255,0.05)' : undefined,
                            color: isRefinementRequired ? 'var(--text-muted)' : undefined,
                            border: isRefinementRequired ? '1px solid rgba(255,255,255,0.05)' : undefined
                          }}
                          onClick={() => {
                            setSelectedCarte(r);
                            setShowReportModal(true);
                            setModalStep(1);
                          }}
                        >
                          Vérification
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {stats.last7Days && stats.last7Days.length > 0 && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 12,
          maxWidth: 800,
          margin: '-16px auto 32px auto',
          padding: '8px 16px',
          background: 'rgba(255,255,255,0.01)',
          border: '1px solid rgba(255,255,255,0.03)',
          borderRadius: 12
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', alignSelf: 'center', textTransform: 'uppercase' }}>7 Derniers Jours :</span>
          {stats.last7Days.map((d, idx) => (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2px 8px' }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{d.dayName}</span>
              <span style={{ fontSize: 12, color: 'white', fontWeight: 800 }}>{d.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Mes Distributions du Jour Section */}
      <div className="card" style={{
        maxWidth: 800,
        margin: '32px auto 48px auto',
        padding: 32,
        background: 'rgba(23, 23, 37, 0.7)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border-color)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
      }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
          📋 Mes Distributions du Jour
        </h3>

        {cardsToday.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: '16px 0' }}>
            Aucune carte distribuée aujourd'hui.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Heure de remise</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Nom & Prénoms</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>ID Carte</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Contact</th>
                </tr>
              </thead>
              <tbody>
                {cardsToday.map((c, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '12px 8px', fontWeight: 600, color: 'var(--accent-secondary)' }}>
                      {new Date(c.date_delivrance).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '12px 8px', color: 'white', fontWeight: 500 }}>
                      {c.noms} {c.prenoms}
                    </td>
                    <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                      {c.id_carte}
                    </td>
                    <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                      {c.contact || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
 
      {/* Suivi de mes signalements Section */}
      <div className="card" style={{
        maxWidth: 800,
        margin: '0 auto 48px auto',
        padding: 32,
        background: 'rgba(23, 23, 37, 0.7)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border-color)',
        boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
      }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20, color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}>
          ⚠️ Suivi de mes signalements
        </h3>

        {myAbsences.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', padding: '16px 0' }}>
            Aucun signalement de carte absente enregistré.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Date de signalement</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Nom & Prénoms</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Rangement</th>
                  <th style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>Statut de recherche</th>
                </tr>
              </thead>
              <tbody>
                {myAbsences.map((c, idx) => {
                  const isActive = c.statut_physique === 'ABSENT';
                  return (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                        {c.date_signalement_absence ? new Date(c.date_signalement_absence).toLocaleDateString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td style={{ padding: '12px 8px', color: 'white', fontWeight: 500 }}>
                        {c.noms} {c.prenoms}
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                        {c.rangement || '—'}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        {c.statut_physique === 'ABSENT' ? (
                          <span style={{ 
                            background: 'rgba(231, 76, 60, 0.1)', 
                            color: '#e74c3c', 
                            padding: '4px 8px', 
                            borderRadius: 6, 
                            fontWeight: 'bold', 
                            fontSize: 11,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}>
                            ⏳ En cours de recherche par l'admin
                          </span>
                        ) : c.statut_physique === 'PERDUE' ? (
                          <span style={{ 
                            background: 'rgba(231, 76, 60, 0.1)', 
                            color: '#e74c3c', 
                            padding: '4px 8px', 
                            borderRadius: 6, 
                            fontWeight: 'bold', 
                            fontSize: 11,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            border: '1px solid rgba(231, 76, 60, 0.3)'
                          }}>
                            ❌ Introuvable (Clôturé)
                          </span>
                        ) : (
                          <span style={{ 
                            background: 'rgba(39, 174, 96, 0.1)', 
                            color: '#27ae60', 
                            padding: '4px 8px', 
                            borderRadius: 6, 
                            fontWeight: 'bold', 
                            fontSize: 11,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4
                          }}>
                            ✅ Traitée - Relocalisée dans {c.rangement || 'rangement'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Dynamique : Vérification ou Info Retrait */}
      {showReportModal && selectedCarte && (
        <div style={{ 
          position: 'fixed', 
          inset: 0, 
          zIndex: 1000, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          padding: '20px' 
        }}>
          {/* Overlay avec flou */}
          <div 
            style={{ 
              background: 'rgba(2, 6, 23, 0.85)', 
              backdropFilter: 'blur(8px)', 
              position: 'absolute', 
              inset: 0 
            }} 
            onClick={resetModal} 
          />
          
          {/* Container du Modal */}
          <div className="animate-slide-up" style={{ 
            position: 'relative', 
            width: '95%', 
            maxWidth: '600px', 
            maxHeight: '90vh',
            background: '#0f172a', 
            borderRadius: '24px', 
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid rgba(255,255,255,0.1)',
            overflow: 'hidden'
          }}>
            {/* --- HEADER FIXE --- */}
            <div style={{ 
              padding: '24px 32px', 
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(255,255,255,0.02)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ 
                  width: 44, 
                  height: 44, 
                  background: selectedCarte.statut === 'EN STOCK' ? 'var(--accent-primary)' : '#ef4444', 
                  borderRadius: 12, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  color: 'white' 
                }}>
                  {selectedCarte.statut === 'EN STOCK' ? <ShieldCheck size={24} /> : <AlertTriangle size={24} />}
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'white' }}>
                    {selectedCarte.statut === 'EN STOCK' ? 'Vérification de Disponibilité' : 'Carte déjà Retirée'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    RÉF : {selectedCarte.id_carte}
                  </div>
                </div>
              </div>
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  resetModal();
                }}
                style={{ 
                  width: 32, 
                  height: 32, 
                  borderRadius: '50%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  border: '1px solid rgba(255,255,255,0.2)', 
                  color: 'rgba(255,255,255,0.6)', 
                  cursor: 'pointer', 
                  background: 'rgba(255,255,255,0.05)',
                  transition: 'all 0.2s'
                }}
                title="Fermer"
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
              {/* Common Section: Beneficiary Details (Always shown) */}
              <div style={{ 
                padding: 24, 
                background: 'rgba(255,255,255,0.03)', 
                borderRadius: 20, 
                border: '1px solid rgba(255,255,255,0.05)',
                marginBottom: 24 
              }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 12, fontWeight: 700 }}>Détails du titulaire</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: 'white', marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 16 }}>
                  {selectedCarte.noms} {selectedCarte.prenoms}
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Date de Naissance</div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: '#f8fafc' }}>{selectedCarte.date_de_naissance}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Lieu de Naissance</div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: '#f8fafc' }}>{selectedCarte.lieu_de_naissance || 'N/A'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>N° Sécurité Sociale</div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent-primary)', fontFamily: 'monospace' }}>
                      {selectedCarte.num_secu 
                        ? (function() {
                            try {
                              const rawVal = String(selectedCarte.num_secu);
                              const valWithDot = rawVal.replace(',', '.');
                              if (valWithDot.toLowerCase().includes('e')) {
                                const num = Number(valWithDot);
                                if (!isNaN(num)) return num.toLocaleString('fr-FR', { useGrouping: false, maximumFractionDigits: 0 });
                              }
                              return rawVal;
                            } catch(e) { return String(selectedCarte.num_secu); }
                          })()
                        : 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Contact Bénéficiaire</div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: '#f8fafc' }}>{selectedCarte.contact || 'N/A'}</div>
                  </div>
                  <div style={{ gridColumn: '1 / -1', background: 'rgba(255,255,255,0.03)', padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Centre de Retrait / Enrôlement</div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent-secondary)' }}>{selectedCarte.lieu_enrolement || 'NON SPÉCIFIÉ'}</div>
                  </div>
                </div>
              </div>

              {/* Case 1: Card is EN STOCK - Verification Steps */}
              {selectedCarte.statut === 'EN STOCK' && (
                <>
                  {modalStep === 1 ? (
                    <>
                      <div style={{ 
                        padding: 24, 
                        background: 'rgba(79, 70, 229, 0.05)', 
                        borderRadius: 20, 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 20, 
                        border: '1px solid rgba(79, 70, 229, 0.15)',
                        marginBottom: 24
                      }}>
                        <div style={{ width: 56, height: 56, background: 'var(--accent-primary)', borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', flexShrink: 0 }}>
                          <MapPin size={28} />
                        </div>
                        <div>
                          <div style={{ fontSize: 12, color: 'var(--accent-primary)', fontWeight: 700, textTransform: 'uppercase' }}>Emplacement Physique</div>
                          <div style={{ fontSize: 32, fontWeight: 900, color: 'white' }}>{selectedCarte.rangement || 'NON CLASSÉ'}</div>
                        </div>
                      </div>

                      <div style={{ 
                        padding: 24, 
                        background: 'rgba(245, 158, 11, 0.08)', 
                        borderRadius: 20, 
                        border: '1px solid rgba(245, 158, 11, 0.2)',
                        textAlign: 'center'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#f59e0b', fontWeight: 800, marginBottom: 8, fontSize: 13, textTransform: 'uppercase' }}>
                          <AlertTriangle size={18} /> Vérification Obligatoire
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: 'white', lineHeight: 1.4 }}>
                          Le bénéficiaire présent physiquement correspond-il strictement à cette identité ?
                        </div>
                      </div>
                      {user?.role === 'CONSULTANT' && (
                        <div style={{ 
                          padding: 16, 
                          background: 'rgba(108, 99, 255, 0.08)', 
                          borderRadius: 16, 
                          border: '1px solid rgba(108, 99, 255, 0.2)',
                          textAlign: 'center',
                          marginTop: 16
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--accent-primary)', fontWeight: 800, fontSize: 13, textTransform: 'uppercase' }}>
                            ℹ️ Mode Lecture Seule
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                            Votre compte de Consultant est configuré en lecture seule pour ce site.
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                      <div style={{ marginBottom: 32 }}>
                        <div style={{ fontSize: 12, color: 'var(--accent-secondary)', fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>Phase de Finalisation</div>
                        <div style={{ fontSize: 28, fontWeight: 800, color: 'white' }}>Informations du retirant</div>
                        <div style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 8 }}>Merci de renseigner l'identité de la personne qui récupère la carte.</div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                        <div className="input-group">
                          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, fontWeight: 700, textTransform: 'uppercase' }}>Qui retire la carte ?</label>
                          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                            <button
                              type="button"
                              onClick={() => setRetirantType('lui-meme')}
                              style={{
                                flex: 1,
                                padding: '12px 16px',
                                borderRadius: 10,
                                border: retirantType === 'lui-meme' ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.05)',
                                background: retirantType === 'lui-meme' ? 'rgba(79, 70, 229, 0.15)' : 'rgba(255,255,255,0.02)',
                                color: retirantType === 'lui-meme' ? 'white' : 'var(--text-muted)',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                              }}
                            >
                              Le bénéficiaire lui-même
                            </button>
                            <button
                              type="button"
                              onClick={() => setRetirantType('tiers')}
                              style={{
                                flex: 1,
                                padding: '12px 16px',
                                borderRadius: 10,
                                border: retirantType === 'tiers' ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.05)',
                                background: retirantType === 'tiers' ? 'rgba(79, 70, 229, 0.15)' : 'rgba(255,255,255,0.02)',
                                color: retirantType === 'tiers' ? 'white' : 'var(--text-muted)',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                              }}
                            >
                              Un mandataire / Tiers
                            </button>
                          </div>

                          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 700, textTransform: 'uppercase' }}>Nom complet du retirant</label>
                          <input 
                            type="text" 
                            value={nomRetirant}
                            onChange={(e) => setNomRetirant(e.target.value)}
                            placeholder="Ex: M. KOFFI Kouame Jean"
                            readOnly={retirantType === 'lui-meme'}
                            style={{ 
                              width: '100%', 
                              padding: '16px 20px', 
                              background: retirantType === 'lui-meme' ? 'rgba(255,255,255,0.01)' : 'rgba(255,255,255,0.03)', 
                              border: '1px solid rgba(255,255,255,0.1)', 
                              borderRadius: 14, 
                              color: retirantType === 'lui-meme' ? 'var(--text-muted)' : 'white', 
                              fontSize: 16, 
                              outline: 'none',
                              cursor: retirantType === 'lui-meme' ? 'not-allowed' : 'text'
                            }}
                            autoFocus={retirantType === 'tiers'}
                          />
                        </div>
                        <div className="input-group">
                          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 700, textTransform: 'uppercase' }}>Numéro de téléphone</label>
                          <input 
                            type="text" 
                            value={telRetirant}
                            onChange={handleTelRetirantChange}
                            placeholder="+225 07 57 39 91 15"
                            style={{ width: '100%', padding: '16px 20px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: 'white', fontSize: 16, outline: 'none' }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Case 2: Card is ALREADY WITHDRAWN (NOT EN STOCK) */}
              {selectedCarte.statut !== 'EN STOCK' && (
                <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
                  <div style={{ 
                    padding: 24, 
                    background: 'rgba(239, 68, 68, 0.12)', 
                    borderRadius: 20, 
                    border: '2px solid #ef4444',
                    textAlign: 'center',
                    marginBottom: 24
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#ef4444', fontWeight: 800, marginBottom: 8, fontSize: 13, textTransform: 'uppercase' }}>
                      <XCircle size={20} /> Carte Déjà Retirée
                    </div>
                    <div style={{ 
                      fontSize: 20, 
                      fontWeight: 900, 
                      color: '#ff4d4d', 
                      lineHeight: 1.4,
                      animation: user?.role === 'CONSULTANT' ? 'pulse 1s infinite' : 'none'
                    }}>
                      {user?.role === 'CONSULTANT' 
                        ? `ATTENTION : Cette carte a déjà été retirée${selectedCarte.centre_retrait ? ` au ${selectedCarte.centre_retrait}` : ''} !` 
                        : `Cette carte n'est plus disponible en stock. Elle a été remise au bénéficiaire ou à un mandataire${selectedCarte.centre_retrait ? ` au ${selectedCarte.centre_retrait}` : ''}.`}
                    </div>
                  </div>

                  <div style={{ 
                    background: 'rgba(255,255,255,0.03)', 
                    padding: 24, 
                    borderRadius: 20, 
                    border: '1px solid rgba(255,255,255,0.05)'
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Nom du Retirant</div>
                        <div style={{ fontWeight: 700, fontSize: 17, color: 'white' }}>{selectedCarte.nom_retirant || 'NON DISPONIBLE'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Contact Retirant</div>
                        <div style={{ fontWeight: 700, fontSize: 17, color: 'white' }}>{selectedCarte.num_retirant || 'NON DISPONIBLE'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Centre de Retrait</div>
                        <div style={{ fontWeight: 700, fontSize: 17, color: 'white' }}>{selectedCarte.centre_retrait || 'NON SPÉCIFIÉ'}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Date de délivrance</div>
                        <div style={{ fontWeight: 700, fontSize: 17, color: 'white' }}>
                          {selectedCarte.date_delivrance 
                            ? new Date(selectedCarte.date_delivrance).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) 
                            : 'NON SPÉCIFIÉE'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Agent Distributeur</div>
                        <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--accent-secondary)' }}>{selectedCarte.agent_distributeur || 'SYSTÈME'}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* --- FOOTER FIXE --- */}
            <div style={{ 
              padding: '24px 32px', 
              background: 'rgba(255,255,255,0.02)', 
              borderTop: '1px solid rgba(255,255,255,0.05)',
              display: 'flex',
              gap: 16
            }}>
              {selectedCarte.statut === 'EN STOCK' && user?.role !== 'AJOUTANT' ? (
                modalStep === 1 ? (
                  <>
                    <button 
                      onClick={handleSignalerAbsence}
                      disabled={selectedCarte.statut_physique === 'ABSENT'}
                      style={{ 
                        flex: 1.5, 
                        padding: '16px', 
                        borderRadius: 14, 
                        background: selectedCarte.statut_physique === 'ABSENT' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                        color: selectedCarte.statut_physique === 'ABSENT' ? '#f59e0b' : '#ef4444', 
                        border: selectedCarte.statut_physique === 'ABSENT' ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)', 
                        fontWeight: 600, 
                        cursor: selectedCarte.statut_physique === 'ABSENT' ? 'not-allowed' : 'pointer',
                        opacity: selectedCarte.statut_physique === 'ABSENT' ? 0.75 : 1
                      }}
                      className={selectedCarte.statut_physique === 'ABSENT' ? '' : 'hover-scale'}
                    >
                      {selectedCarte.statut_physique === 'ABSENT' 
                        ? "⏳ En cours de traitement par l'administration" 
                        : "⚠️ Signaler Carte Introuvable dans ce Rangement"
                      }
                    </button>
                    <button 
                      onClick={() => setModalStep(2)}
                      style={{ 
                        flex: 2, 
                        padding: '16px', 
                        borderRadius: 14, 
                        background: 'var(--accent-primary)', 
                        color: 'white', 
                        border: 'none', 
                        fontWeight: 700, 
                        cursor: 'pointer', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        gap: 10,
                        animation: user?.role === 'CONSULTANT' ? 'pulse 1.5s infinite' : 'none'
                      }}
                      className="hover-scale btn-glow"
                    >
                      {user?.role === 'CONSULTANT' ? 'Confirmer le Retrait' : 'OUI, CONTINUER'} <ArrowRight size={20} />
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => setModalStep(1)}
                      style={{ flex: 1, padding: '16px', borderRadius: 14, background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', fontWeight: 600, cursor: 'pointer' }}
                      className="hover-scale"
                    >
                      Retour
                    </button>
                    <button 
                      onClick={handleDeliver}
                      disabled={isFinalizing || !nomRetirant || !telRetirant}
                      style={{ 
                        flex: 2, 
                        padding: '16px', 
                        borderRadius: 14, 
                        background: '#2ecc71', 
                        color: 'white', 
                        border: 'none', 
                        fontWeight: 800, 
                        cursor: (isFinalizing || !nomRetirant || !telRetirant) ? 'not-allowed' : 'pointer', 
                        opacity: (isFinalizing || !nomRetirant || !telRetirant) ? 0.5 : 1,
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        gap: 10 
                      }}
                      className="hover-scale"
                    >
                      {isFinalizing ? 'TRAITEMENT...' : 'DÉLIVRER ET FINALISER'} <CheckCircle size={20} />
                    </button>
                  </>
                )
              ) : (
                <button 
                  onClick={resetModal}
                  style={{ width: '100%', padding: '16px', borderRadius: 14, background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', fontWeight: 700, cursor: 'pointer' }}
                  className="hover-scale"
                >
                  Fermer
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
