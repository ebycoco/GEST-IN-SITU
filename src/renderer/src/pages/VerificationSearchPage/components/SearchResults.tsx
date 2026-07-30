import React from 'react';
import { Package, User, Calendar, MapPin, Phone, CheckCircle, AlertTriangle, ArrowRight, ShieldCheck, Cloud, CloudDownload, X } from 'lucide-react';

interface SearchResultsProps {
  results: any[];
  hasSearched: string | boolean;
  selectedCentreId: number | null;
  user: any;
  userCentre: any;
  setSelectedCarte: (c: any) => void;
  setShowReportModal: (b: boolean) => void;
  setModalStep: (s: number) => void;
  setShowProofModal: (b: boolean) => void;
  isAgentAuthorisedForCard: (carte: any) => boolean;
  cloudResults?: any[];
  isCloudSearching?: boolean;
  cloudSearchDone?: boolean;
  setCloudResults?: (r: any[]) => void;
  onCloseNotFound?: () => void;
}

export function SearchResults({
  results,
  hasSearched,
  selectedCentreId,
  user,
  userCentre,
  setSelectedCarte,
  setShowReportModal,
  setModalStep,
  setShowProofModal,
  isAgentAuthorisedForCard,
  cloudResults = [],
  isCloudSearching = false,
  cloudSearchDone = false,
  setCloudResults,
  onCloseNotFound
}: SearchResultsProps) {
  const [pullingCard, setPullingCard] = React.useState<number | null>(null);

  if (!hasSearched) return null;

  if (results.length === 0) {
    let modalContent = null;

    if (isCloudSearching) {
      modalContent = (
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: 'rgba(56, 189, 248, 0.08)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <Cloud size={32} color="#38bdf8" style={{ animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }} />
          </div>
          <h3 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 12px 0', color: 'white' }}>Recherche complémentaire en cours...</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 15, margin: 0, lineHeight: 1.6 }}>
            Interrogation de la base de données centrale. Veuillez patienter.
          </p>
        </div>
      );
    } else if (cloudSearchDone && cloudResults.length > 0) {
      modalContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px', background: 'rgba(56, 189, 248, 0.1)', borderRadius: 16, border: '1px solid rgba(56, 189, 248, 0.3)' }}>
            <Cloud size={28} color="#38bdf8" />
            <div>
              <h4 style={{ margin: 0, color: 'white', fontSize: 16, fontWeight: 800 }}>Trouvée sur le Cloud</h4>
              <p style={{ margin: '4px 0 0 0', color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>
                Cette carte existe dans la base centrale pour votre site, mais n'est pas encore sur ce poste.
              </p>
            </div>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {cloudResults.map((carte) => {
              const handlePull = async () => {
                try {
                  setPullingCard(carte.id_carte);
                  const res = await window.api.cartes.pullSingleCard(carte);
                  if (res && res.success && res.carte) {
                    if (setCloudResults) setCloudResults([]);
                    setSelectedCarte(res.carte);
                    if (onCloseNotFound) onCloseNotFound();
                    setShowReportModal(true);
                    setModalStep(1);
                  }
                } catch (e) {
                  console.error(e);
                } finally {
                  setPullingCard(null);
                }
              };

              return (
                <div key={carte.id_carte} className="card" style={{ padding: '24px', border: '1px solid rgba(56, 189, 248, 0.3)', background: 'rgba(56, 189, 248, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ width: 48, height: 48, borderRadius: 16, background: 'rgba(56, 189, 248, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <User size={24} color="#38bdf8" />
                      </div>
                      <div>
                        <h4 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'white', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                          {carte.noms} <span style={{ color: 'var(--text-secondary)' }}>{carte.prenoms}</span>
                        </h4>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, fontSize: 13, color: 'var(--text-muted)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={14} /> Né(e) le {formatBirthDate(carte.date_naissance || carte.date_de_naissance)}</span>
                          <span>•</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Package size={14} /> Box : <strong style={{ color: 'white' }}>{carte.rangement || 'N/A'}</strong></span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <button
                      onClick={handlePull}
                      disabled={pullingCard === carte.id_carte}
                      className="btn btn-primary"
                      style={{
                        padding: '12px 24px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        background: '#38bdf8',
                        color: '#000',
                        boxShadow: '0 8px 20px rgba(56, 189, 248, 0.2)'
                      }}
                    >
                      <CloudDownload size={16} />
                      {pullingCard === carte.id_carte ? 'Rapatriement...' : 'Rapatrier'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    } else {
      modalContent = (
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: 'rgba(239, 68, 68, 0.08)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <AlertTriangle size={32} color="#f87171" />
          </div>
          <h3 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 12px 0', color: 'white' }}>Carte Introuvable</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 15, margin: 0, lineHeight: 1.6 }}>
            Aucune carte ne correspond exactement à ces critères d'identité.
            <br /><br />
            <span style={{ opacity: 0.8 }}>
              Causes possibles : erreur de frappe, carte pas encore synchronisée si vous êtes hors-ligne,
              ou carte réellement absente de la base de données.
            </span>
          </p>
        </div>
      );
    }

    return (
      <div className="animate-fade-in" style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        padding: 24
      }}>
        <div className="card" style={{ 
          maxWidth: 600, 
          width: '100%', 
          padding: '40px 32px', 
          position: 'relative',
          background: 'linear-gradient(145deg, rgba(45, 50, 85, 0.95) 0%, rgba(20, 22, 40, 0.98) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: 24,
          boxShadow: '0 40px 80px rgba(0, 0, 0, 0.8), 0 0 40px rgba(0, 0, 0, 0.2)'
        }}>
          {onCloseNotFound && !isCloudSearching && (
            <button 
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCloseNotFound();
              }}
              style={{
                position: 'absolute', top: 20, right: 20,
                background: 'rgba(255,255,255,0.05)', border: 'none', color: 'var(--text-muted)',
                width: 36, height: 36, borderRadius: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'white'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <X size={20} />
            </button>
          )}

          {modalContent}
          
          {(!isCloudSearching && (!cloudSearchDone || cloudResults.length === 0)) && (
            <div style={{ marginTop: 32, display: 'flex', justifyContent: 'center' }}>
              <button 
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (onCloseNotFound) onCloseNotFound();
                }} 
                className="btn btn-secondary" 
                style={{ padding: '12px 32px', fontSize: 15, fontWeight: 700 }}
              >
                Fermer et recommencer
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const formatBirthDate = (isoDate: string | null): string => {
    if (!isoDate) return '—';
    const parts = isoDate.split('-');
    if (parts.length === 3) {
      const [year, month, day] = parts;
      return `${day}/${month}/${year}`;
    }
    return isoDate;
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h3 style={{ fontSize: 18, fontWeight: 800, color: 'white', margin: '0 0 -8px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        Résultats de la Recherche ({results.length})
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {results.map((carte) => {
          const isAuthorised = isAgentAuthorisedForCard(carte);
          const isAbsent = carte.statut_physique === 'ABSENT';
          const isPerdue = carte.statut_physique === 'PERDUE';

          return (
            <div
              key={carte.id_carte}
              className="card animate-fade-in"
              style={{
                padding: '24px 28px',
                border: isAuthorised ? '1px solid rgba(255, 255, 255, 0.06)' : '1px solid rgba(239, 68, 68, 0.15)',
                background: isAuthorised ? 'var(--card-bg)' : 'rgba(239, 68, 68, 0.02)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 24,
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
                {/* Status and Location Badges */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
                    padding: '4px 10px', borderRadius: 20,
                    background: carte.statut === 'EN STOCK' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(79, 70, 229, 0.12)',
                    color: carte.statut === 'EN STOCK' ? '#10b981' : '#818cf8',
                    border: carte.statut === 'EN STOCK' ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(79, 70, 229, 0.2)'
                  }}>
                    {carte.statut}
                  </span>

                  <span style={{
                    fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
                    padding: '4px 10px', borderRadius: 20,
                    background: isPerdue ? 'rgba(127, 29, 29, 0.25)' : isAbsent ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                    color: isPerdue ? '#f87171' : isAbsent ? '#ef4444' : '#10b981',
                    border: isPerdue ? '1px solid rgba(127, 29, 29, 0.5)' : isAbsent ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(16, 185, 129, 0.2)'
                  }}>
                    {isPerdue ? '❌ DÉCLARÉE PERDUE' : isAbsent ? '⚠️ SIGNALÉE ABSENTE' : '✓ PRÉSENCE OK'}
                  </span>

                  {carte.rangement && (
                    <span style={{
                      fontSize: 11, fontWeight: 800,
                      padding: '4px 10px', borderRadius: 20,
                      background: 'rgba(251, 191, 36, 0.12)', color: '#fbbf24',
                      border: '1px solid rgba(251, 191, 36, 0.2)',
                      display: 'inline-flex', alignItems: 'center', gap: 6
                    }}>
                      <Package size={12} />
                      Rangement : {carte.rangement}
                    </span>
                  )}
                </div>

                {/* Identity Info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: 'white', letterSpacing: '-0.01em', textTransform: 'uppercase', display: 'flex', gap: '8px' }}>
                    <span>{carte.noms}</span> 
                    <span style={{ color: 'var(--text-muted)' }}>{carte.prenoms}</span>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px 24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                      <Calendar size={14} />
                      Né(e) le : {formatBirthDate(carte.date_de_naissance)} {carte.lieu_de_naissance ? `à ${carte.lieu_de_naissance}` : ''}
                    </div>
                    {carte.contact && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                        <Phone size={14} />
                        Tél : {carte.contact}
                      </div>
                    )}
                    {carte.num_secu && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                        <ShieldCheck size={14} />
                        N° CMU : {carte.num_secu}
                      </div>
                    )}
                    {carte.lieu_enrolement && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                        <MapPin size={14} />
                        Enrôlement : {carte.lieu_enrolement}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div>
                {!isAuthorised ? (
                  <div style={{
                    textAlign: 'right',
                    padding: '8px 16px',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    borderRadius: 10,
                    color: '#f87171',
                    fontSize: 12,
                    fontWeight: 700,
                    maxWidth: 240
                  }}>
                    Non autorisé pour votre Box ({carte.rangement || 'Sans rangement'})
                  </div>
                ) : isPerdue ? (
                  <button
                    disabled
                    className="btn btn-secondary"
                    style={{ opacity: 0.6, cursor: 'not-allowed', color: '#f87171', borderColor: 'rgba(127, 29, 29, 0.5)', padding: '12px 24px' }}
                    title="Cette carte a été déclarée perdue par l'administration. Contactez votre administrateur."
                  >
                    ❌ Carte déclarée perdue
                  </button>
                ) : isAbsent ? (
                  <button
                    disabled
                    className="btn btn-secondary"
                    style={{ opacity: 0.6, cursor: 'not-allowed', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.3)', padding: '12px 24px' }}
                  >
                    ⏳ En cours de traitement par l'administration
                  </button>
                ) : carte.statut === 'DELIVRE' ? (
                  <button
                    onClick={() => {
                      setSelectedCarte(carte);
                      setShowProofModal(true);
                    }}
                    className="btn btn-secondary"
                    style={{
                      padding: '12px 20px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      borderColor: 'rgba(56, 189, 248, 0.3)',
                      color: '#38bdf8',
                      background: 'rgba(56, 189, 248, 0.05)'
                    }}
                  >
                    <ShieldCheck size={16} />
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 13, fontWeight: 800 }}>Déjà distribuée</span>
                      <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.8 }}>Voir la preuve de retrait</span>
                    </div>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setSelectedCarte(carte);
                      setShowReportModal(true);
                      setModalStep(1);
                    }}
                    className="btn btn-primary"
                    style={{
                      padding: '12px 24px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      boxShadow: '0 8px 20px rgba(79, 70, 229, 0.2)'
                    }}
                  >
                    Procéder au Retrait
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
