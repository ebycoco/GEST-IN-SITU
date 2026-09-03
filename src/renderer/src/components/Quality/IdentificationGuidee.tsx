import React, { useState } from 'react';
import { Search, ChevronRight, CheckCircle, AlertCircle, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface IdentificationGuideeProps {
  isOpen: boolean;
  onClose: () => void;
  siteId: number;
  initialName?: string;
  onSelectCard: (carte: any) => void;
}

export function IdentificationGuidee({ isOpen, onClose, siteId, initialName, onSelectCard }: IdentificationGuideeProps) {
  const [step, setStep] = useState(1);
  const [queryNoms, setQueryNoms] = useState(initialName || '');
  const [queryDdn, setQueryDdn] = useState('');
  const [queryLieu, setQueryLieu] = useState('');
  
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  if (!isOpen) return null;

  const handleSearch = async () => {
    if (!queryNoms.trim()) {
      toast.error('Veuillez entrer au moins un nom/prénom pour la recherche');
      return;
    }
    setIsSearching(true);
    try {
      const res = await window.api.cartes.searchCombinedInventaire(siteId, queryNoms, queryDdn || undefined, queryLieu || undefined);
      setResults(res || []);
      setStep(2);
      if (res && res.length === 20) {
        // Signal "trop de résultats" (décision produit) : même pattern que InventaireApurement.tsx —
        // la requête est plafonnée à LIMIT 20 côté backend (searchCombinedInventaire) sans requête
        // de comptage additionnelle (politique low-memory §2 CLAUDE.md) ; atteindre exactement 20
        // sert de signal suffisant.
        toast('20 résultats maximum affichés : affinez votre recherche si la carte recherchée n\'apparaît pas.', { icon: 'ℹ️' });
      }
    } catch (e: any) {
      toast.error('Erreur de recherche: ' + e.message);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div 
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 998,
          backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }} 
      >
        <div style={{
          background: 'var(--bg-secondary)', width: 700, maxWidth: '90vw', maxHeight: '90vh',
          borderRadius: 16, border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
        }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Search size={20} color="var(--accent-primary)" />
              Identification Guidée (Inventaire Global)
            </h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <X size={20} />
            </button>
          </div>

          <div style={{ padding: 24, flex: 1, overflowY: 'auto' }}>
            {/* Stepper */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <StepIndicator num={1} label="Critères" active={step >= 1} />
              <ChevronRight size={16} color="var(--text-muted)" />
              <StepIndicator num={2} label="Résultats" active={step >= 2} />
              <ChevronRight size={16} color="var(--text-muted)" />
              <StepIndicator num={3} label="Résolution" active={step >= 3} />
            </div>

            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: 12, borderRadius: 8, display: 'flex', gap: 12 }}>
                  <AlertCircle size={18} color="#3b82f6" style={{ flexShrink: 0 }} />
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                    Recherchez la véritable identité du patient dans tout l'inventaire pour éviter de créer un doublon supplémentaire ou d'écraser la mauvaise carte.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>Nom et Prénoms (Obligatoire)</label>
                  <input type="text" value={queryNoms} onChange={e => setQueryNoms(e.target.value.toUpperCase())}
                    style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '12px', borderRadius: 8, color: 'white', fontSize: 14 }} 
                    placeholder="Saisissez le nom..." autoFocus />
                </div>
                
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                    <label style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>Date de Naissance (Optionnel)</label>
                    <input type="text" value={queryDdn} onChange={e => setQueryDdn(e.target.value)}
                      style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '12px', borderRadius: 8, color: 'white', fontSize: 14 }} 
                      placeholder="JJ/MM/AAAA" />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                    <label style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>Lieu de Naissance (Optionnel)</label>
                    <input type="text" value={queryLieu} onChange={e => setQueryLieu(e.target.value.toUpperCase())}
                      style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '12px', borderRadius: 8, color: 'white', fontSize: 14 }} 
                      placeholder="Ex: ABOBO" />
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0, color: 'white', fontSize: 15 }}>{results.length} résultat(s) trouvé(s)</h4>
                  <button onClick={() => setStep(1)} style={{ background: 'none', border: 'none', color: '#70a1ff', cursor: 'pointer', fontSize: 13 }}>
                    ← Modifier la recherche
                  </button>
                </div>

                {results.length === 0 ? (
                  <div style={{ background: 'rgba(0,0,0,0.2)', padding: 40, borderRadius: 8, textAlign: 'center', border: '1px dashed var(--border-color)' }}>
                    <p style={{ color: 'var(--text-secondary)' }}>Aucune carte correspondante n'a été trouvée dans l'inventaire.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 350, overflowY: 'auto' }}>
                    {results.map((r, i) => (
                      <div key={i} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', padding: 16, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, color: 'white', fontSize: 15 }}>{r.noms} {r.prenoms}</div>
                          <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                            <span>N° Sécu: <strong style={{ color: 'white' }}>{r.num_secu || '—'}</strong></span>
                            <span>Date: <strong style={{ color: 'white' }}>{r.date_de_naissance || '—'}</strong></span>
                            <span>Rangement: <strong style={{ color: 'var(--accent-primary)' }}>{r.rangement || 'NON CLASSE'}</strong></span>
                          </div>
                        </div>
                        <button 
                          onClick={() => { onSelectCard(r); setStep(3); }}
                          style={{ background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                          Sélectionner
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <CheckCircle size={48} color="#10b981" style={{ margin: '0 auto 16px' }} />
                <h4 style={{ margin: '0 0 8px 0', color: 'white', fontSize: 18 }}>Carte Identifiée</h4>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
                  Vous pouvez maintenant procéder à la résolution de l'anomalie en vous basant sur la carte sélectionnée.
                </p>
              </div>
            )}
          </div>

          {/* Footer fixe : boutons d'action, hors du flux scrollable du body (gabarit modal-adaptatif-terrain) */}
          {step === 1 && (
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.2)' }}>
              <button onClick={handleSearch} disabled={isSearching || !queryNoms.trim()}
                style={{ width: '100%', background: 'var(--accent-primary)', color: 'black', border: 'none', padding: '12px', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: (isSearching || !queryNoms.trim()) ? 0.7 : 1 }}>
                {isSearching ? 'Recherche en cours...' : 'Lancer la recherche globale'}
              </button>
            </div>
          )}
          {step === 3 && (
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-color)', background: 'rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'center' }}>
              <button onClick={onClose} style={{ background: 'var(--accent-primary)', color: 'black', border: 'none', padding: '10px 24px', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                Terminer
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function StepIndicator({ num, label, active }: { num: number, label: string, active: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: active ? 1 : 0.4 }}>
      <div style={{ 
        width: 24, height: 24, borderRadius: '50%', background: active ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
        color: active ? 'black' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700
      }}>
        {num}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'white' : 'var(--text-secondary)' }}>{label}</span>
    </div>
  );
}
