import React, { useState } from 'react';
import { Search, MapPin, Phone, AlertTriangle, CheckCircle, Package, Calendar, Clock, User, X, ShieldCheck, ArrowRight, XCircle, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import DateInput from '../components/DateInput';
import CentreContextSwitcher from '../components/layout/CentreContextSwitcher';
import { useAuthStore } from '../stores/authStore';

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
  const [showReportModal, setShowReportModal] = useState(false);
  const [modalStep, setModalStep] = useState(1); // 1: Verification, 2: Finalize
  const [nomRetirant, setNomRetirant] = useState('');
  const [telRetirant, setTelRetirant] = useState('');
  const [isFinalizing, setIsFinalizing] = useState(false);

  const resetModal = () => {
    setShowReportModal(false);
    setSelectedCarte(null);
    setModalStep(1);
    setNomRetirant('');
    setTelRetirant('');
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
    if (!noms.trim() || !prenoms.trim() || ddn.length !== 10) {
      toast.error('Veuillez remplir Nom, Prénom et une Date de Naissance valide (JJ/MM/AAAA).');
      return;
    }

    setIsSearching(true);
    try {
      const query = `${noms.trim()} ${prenoms.trim()}`;
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const filters: any = { date_de_naissance: ddn };
      if (siteIdToUse) filters.site_id = siteIdToUse.toString();
      if (lieuNaissance.trim()) filters.lieu_de_naissance = lieuNaissance.trim();
      if (contact.trim()) filters.contact = contact.trim();

      const res = await window.api.cartes.search(query, 50, filters);
      const searchResults = res || [];
      
      setResults(searchResults);
      setHasSearched(true);
      
      if (searchResults.length === 1) {
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

  const handleSignalerAbsence = async () => {
    if (!selectedCarte) return;
    try {
      const auth = localStorage.getItem('gest-in-situ-auth');
      const agent = auth ? JSON.parse(auth).state?.user?.login : 'CONSULTANT';
      
      await window.api.cartes.signalerAbsence(selectedCarte.id_carte, agent);
      toast.success('Absence physique signalée. Traitement admin en cours.');
      resetModal();
      handleSearch({ preventDefault: () => {} } as any);
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
      });

      toast.success('Carte délivrée avec succès !');
      resetModal();
      handleSearch({ preventDefault: () => {} } as any);
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

      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <CentreContextSwitcher />
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
        <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div className="form-group" style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <User size={14} /> Nom de famille <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <input 
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

          {hasSearched && results.length > 3 && (
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
                    onChange={e => setContact(e.target.value)} 
                    placeholder="Ex: 0102030405" 
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
      </div>

      {hasSearched && (
        <div className="card animate-slide-up" style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3 style={{ margin: 0, fontSize: 20 }}>Résultats de recherche ({results.length})</h3>
            {results.length > 1 && <span className="badge">Sélectionnez une carte pour vérification</span>}
          </div>
          
          {results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
              <Package size={64} style={{ opacity: 0.1, margin: '0 auto 20px auto' }} />
              <p style={{ fontSize: 18 }}>Aucune carte trouvée pour ces critères.</p>
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
                          style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8 }}
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
            width: '100%', 
            maxWidth: '600px', 
            maxHeight: 'min(900px, 95vh)',
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
                          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 700, textTransform: 'uppercase' }}>Nom complet du retirant</label>
                          <input 
                            type="text" 
                            value={nomRetirant}
                            onChange={(e) => setNomRetirant(e.target.value)}
                            placeholder="Ex: M. KOFFI Kouame Jean"
                            style={{ width: '100%', padding: '16px 20px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: 'white', fontSize: 16, outline: 'none' }}
                            autoFocus
                          />
                        </div>
                        <div className="input-group">
                          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 700, textTransform: 'uppercase' }}>Numéro de téléphone</label>
                          <input 
                            type="text" 
                            value={telRetirant}
                            onChange={(e) => setTelRetirant(e.target.value)}
                            placeholder="Ex: 07 08 09 10 11"
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
                    background: 'rgba(239, 68, 68, 0.08)', 
                    borderRadius: 20, 
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    textAlign: 'center',
                    marginBottom: 24
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#ef4444', fontWeight: 800, marginBottom: 8, fontSize: 13, textTransform: 'uppercase' }}>
                      <XCircle size={20} /> Carte Déjà Retirée
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'white', lineHeight: 1.4 }}>
                      Cette carte n'est plus disponible en stock. Elle a été remise au bénéficiaire ou à un mandataire.
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
              {selectedCarte.statut === 'EN STOCK' && user?.role !== 'CONSULTANT' && user?.role !== 'AJOUTANT' ? (
                modalStep === 1 ? (
                  <>
                    <button 
                      onClick={handleSignalerAbsence}
                      style={{ flex: 1, padding: '16px', borderRadius: 14, background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', fontWeight: 600, cursor: 'pointer' }}
                      className="hover-scale"
                    >
                      Signaler Introuvable
                    </button>
                    <button 
                      onClick={() => setModalStep(2)}
                      style={{ flex: 2, padding: '16px', borderRadius: 14, background: 'var(--accent-primary)', color: 'white', border: 'none', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                      className="hover-scale btn-glow"
                    >
                      OUI, CONTINUER <ArrowRight size={20} />
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
