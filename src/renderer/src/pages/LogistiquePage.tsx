import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, CheckCircle, Package, ArrowRight, ShieldAlert, AlertTriangle, Key } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';

export default function LogistiquePage() {
  const { user } = useAuthStore();
  const siteId = user?.site_id || 1;

  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedCarte, setSelectedCarte] = useState<any | null>(null);
  const [rangement, setRangement] = useState('');
  const [numSecu, setNumSecu] = useState('');
  const [loading, setLoading] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const rangementInputRef = useRef<HTMLInputElement>(null);
  const numSecuInputRef = useRef<HTMLInputElement>(null);

  // Focus initial sur la recherche
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // Détection de la saisie de recherche (Temps Réel débouclé ou direct)
  const handleSearchChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (val.trim().length >= 2) {
      try {
        const data = await window.api.cartes.searchQuickLogistique(siteId, val);
        setResults(data || []);
      } catch (err) {
        console.error('Failed logistique search:', err);
      }
    } else {
      setResults([]);
    }
  };

  // Raccourcis clavier globaux
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Si des homonymes ou multiples résultats sont affichés et qu'aucune carte n'est encore sélectionnée
    if (results.length > 0 && !selectedCarte) {
      const num = parseInt(e.key);
      if (num >= 1 && num <= results.length) {
        e.preventDefault();
        selectCard(results[num - 1]);
      }
    }
  };

  const selectCard = (carte: any) => {
    setSelectedCarte(carte);
    setRangement(carte.rangement || '');
    setNumSecu(carte.num_secu || '');
    setResults([]);
    
    // Si la carte n'a pas de numéro de sécu, on focus d'abord sur sécu, sinon rangement
    setTimeout(() => {
      if (!carte.num_secu && numSecuInputRef.current) {
        numSecuInputRef.current.focus();
      } else if (rangementInputRef.current) {
        rangementInputRef.current.focus();
      }
    }, 50);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCarte) return;
    if (!rangement.trim()) {
      toast.error('Le rangement est obligatoire.');
      return;
    }

    try {
      setLoading(true);
      await window.api.cartes.updateRangementEtFiche(selectedCarte.id_carte, {
        rangement: rangement.trim().toUpperCase(),
        num_secu: numSecu.trim() || undefined
      });
      toast.success('Rangement mis à jour avec succès.');
      resetState();
    } catch (err: any) {
      toast.error(`Erreur : ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const resetState = () => {
    setSelectedCarte(null);
    setRangement('');
    setNumSecu('');
    setSearchQuery('');
    setResults([]);
    setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, 50);
  };

  return (
    <div className="animate-fade-in" style={{ padding: '40px 24px', maxWidth: 800, margin: '0 auto' }} onKeyDown={handleKeyDown}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ 
          display: 'inline-flex', padding: 16, background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)', 
          borderRadius: 20, color: 'white', marginBottom: 16, boxShadow: '0 8px 24px rgba(124, 58, 237, 0.3)' 
        }}>
          <Package size={32} />
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 8, color: 'white' }}>CLASSEMENT LOGISTIQUE</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Saisie à la chaîne et levée de doute homonymes au clavier.</p>
      </div>

      {/* Main card */}
      <div className="premium-card premium-glass" style={{ padding: 32 }}>
        {!selectedCarte ? (
          /* SECTION RECHERCHE */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rechercher une fiche (Nom, Prénom, DDN, Sécu)</label>
              <div style={{ position: 'relative' }}>
                <Search size={20} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-purple)' }} />
                <input
                  ref={searchInputRef}
                  className="form-input"
                  style={{ width: '100%', paddingLeft: 48, borderRadius: 14, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 50, outline: 'none' }}
                  type="text"
                  placeholder="Saisir les critères..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                />
              </div>
            </div>

            {/* LISTE DES RÉSULTATS / LEVÉE DE DOUTE */}
            {results.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#ffd700', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  💡 Appuyez sur la touche numérique (1, 2, 3...) pour sélectionner
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {results.map((c, idx) => {
                    const hasRangement = !!c.rangement;
                    return (
                      <div
                        key={c.id_carte}
                        onClick={() => selectCard(c)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '16px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.02)',
                          border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', transition: 'all 0.2s'
                        }}
                        className="hover-scale"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                          {/* Touche raccourci numérique */}
                          <div style={{
                            width: 28, height: 28, borderRadius: 8, background: '#7c3aed', color: 'white',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13
                          }}>
                            {idx + 1}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, color: 'white', fontSize: 15 }}>{c.noms} {c.prenoms}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                              Né(e) le {c.date_de_naissance || '—'} à <span style={{ color: '#a855f7', fontWeight: 600 }}>{c.lieu_de_naissance || '—'}</span>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: 2 }}>
                              N° CMU : {c.num_secu || 'NON RENSEIGNÉ'}
                            </div>
                          </div>
                        </div>

                        {/* Badge de rangement actuel */}
                        <div>
                          {hasRangement ? (
                            <span style={{ padding: '4px 10px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                              {c.rangement}
                            </span>
                          ) : (
                            <span style={{ padding: '4px 10px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                              Sans rangement
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* SECTION ÉDITION ET CLASSEMENT */
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Infos de la carte sélectionnée */}
            <div style={{ padding: 20, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#ffd700', textTransform: 'uppercase', marginBottom: 8 }}>Fiche Sélectionnée</div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'white' }}>{selectedCarte.noms} {selectedCarte.prenoms}</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                Né(e) le {selectedCarte.date_de_naissance} à {selectedCarte.lieu_de_naissance}
              </p>
            </div>

            {/* Numéro de Sécu si manquant */}
            {!selectedCarte.num_secu && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#f97316' }}>NUMÉRO DE SÉCURITÉ SOCIALE / CMU <span style={{ color: '#ffd700' }}>*</span></label>
                <input
                  ref={numSecuInputRef}
                  className="form-input"
                  style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 46, padding: '0 16px', outline: 'none' }}
                  type="text"
                  placeholder="Ex: 22501..."
                  value={numSecu}
                  onChange={e => setNumSecu(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (rangementInputRef.current) rangementInputRef.current.focus();
                    }
                  }}
                />
              </div>
            )}

            {/* Nouveau Rangement */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>CLASSEMENT / NOUVEAU RANGEMENT <span style={{ color: '#ffd700' }}>*</span></label>
              <input
                ref={rangementInputRef}
                className="form-input"
                style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', height: 46, padding: '0 16px', outline: 'none', textTransform: 'uppercase', fontWeight: 700, fontSize: 18, color: '#ffd700' }}
                type="text"
                placeholder="Ex: MAIRIE-A3"
                value={rangement}
                onChange={e => setRangement(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <button
                type="button"
                onClick={resetState}
                style={{ flex: 1, padding: '14px', background: '#1e2235', border: 'none', borderRadius: 12, color: 'white', fontWeight: 600, cursor: 'pointer' }}
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={loading}
                style={{ flex: 1.5, padding: '14px', background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)', border: 'none', borderRadius: 12, color: 'white', fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 15px rgba(124, 58, 237, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                Valider (Entrée) <ArrowRight size={18} />
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
