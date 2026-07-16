import React from 'react';
import { Package, User, Calendar, MapPin, Phone, CheckCircle, AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';

interface SearchResultsProps {
  results: any[];
  hasSearched: string | boolean;
  selectedCentreId: number | null;
  user: any;
  userCentre: any;
  setSelectedCarte: (c: any) => void;
  setShowReportModal: (b: boolean) => void;
  setModalStep: (s: number) => void;
  isAgentAuthorisedForCard: (carte: any) => boolean;
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
  isAgentAuthorisedForCard
}: SearchResultsProps) {
  if (!hasSearched) return null;

  if (results.length === 0) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto', textAlign: 'center', padding: '48px 24px' }}>
        <div style={{ width: 56, height: 56, borderRadius: 18, background: 'rgba(239, 68, 68, 0.08)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <AlertTriangle size={24} color="#f87171" />
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px 0', color: 'white' }}>Carte Introuvable</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0, lineHeight: 1.5 }}>
          Aucune carte ne correspond exactement à ces critères d'identité dans la base locale du site.
        </p>
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
                    background: isAbsent ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                    color: isAbsent ? '#ef4444' : '#10b981',
                    border: isAbsent ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(16, 185, 129, 0.2)'
                  }}>
                    {isAbsent ? '⚠️ SIGNALÉE ABSENTE' : '✓ PRÉSENCE OK'}
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
                ) : isAbsent ? (
                  <button
                    disabled
                    className="btn btn-secondary"
                    style={{ opacity: 0.6, cursor: 'not-allowed', color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.3)', padding: '12px 24px' }}
                  >
                    ⏳ En cours de traitement par l'administration
                  </button>
                ) : carte.statut === 'DELIVRE' ? (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 4
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '6px 12px', borderRadius: 8 }}>
                      DÉJÀ DISTRIBUÉE
                    </span>
                    {carte.date_delivrance && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                        Le {new Date(carte.date_delivrance).toLocaleDateString('fr-FR')} par {carte.agent_distributeur || 'un agent'}
                      </span>
                    )}
                  </div>
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
