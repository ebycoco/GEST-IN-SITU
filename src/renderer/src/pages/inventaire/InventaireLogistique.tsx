import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, CheckCircle, Package, ArrowRight, ShieldAlert, AlertTriangle, Key } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import DateInput from '../../components/DateInput';
import { formatContactForDisplay, applyPhoneChange, isOverlongContact, CONTACT_TOO_LONG_MESSAGE, resolveContactToSend, cleanIpcErrorMessage } from './phoneFormat';
import { formatNumSecu } from '../../../../shared/utils/numSecu';

/**
 * Vrai si la carte n'a pas de rangement exploitable : vide, NULL/undefined ou « NON CLASSE »
 * (insensible à la casse et aux espaces, même règle que cartes.queries.ts). Fonction pure,
 * locale au fichier : sert à vider le champ de saisie et à afficher le badge « Sans rangement ».
 */
const isRangementVide = (rangement: string | null | undefined): boolean => {
  const val = (rangement ?? '').trim();
  return val === '' || val.toUpperCase() === 'NON CLASSE';
};

export default function InventaireLogistique() {
  const { user } = useAuthStore();
  const siteId = user?.site_id || 1;

  const [searchQuery, setSearchQuery] = useState('');
  // Filtres facultatifs de levée de doute homonymes (AND additionnels côté SQL,
  // cf. queries.searchQuickLogistique) — n'affectent pas le comportement existant quand vides.
  const [filterDateNaissance, setFilterDateNaissance] = useState('');
  const [filterLieuNaissance, setFilterLieuNaissance] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedCarte, setSelectedCarte] = useState<any | null>(null);
  const [rangement, setRangement] = useState('');
  const [numSecu, setNumSecu] = useState('');
  // Contact facultatif (jamais bloquant) : prérempli depuis la fiche, envoyé seulement si non vide.
  const [contact, setContact] = useState('');
  const [loading, setLoading] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const rangementInputRef = useRef<HTMLInputElement>(null);
  const numSecuInputRef = useRef<HTMLInputElement>(null);
  const lieuNaissanceInputRef = useRef<HTMLInputElement>(null);

  // Focus initial sur la recherche
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // Recherche en temps réel : ré-exécutée à chaque changement du critère libre (Nom/Prénom,
  // toujours actif en arrière-plan sur num_secu — cf. queries.searchQuickLogistique) ou des
  // filtres facultatifs Date/Lieu de naissance, pour affiner sans casser le flux existant.
  const runSearch = async (query: string, ddn: string, lieu: string) => {
    if (query.trim().length >= 2) {
      try {
        // La Date de Naissance n'est envoyée qu'une fois complète (JJ/MM/AAAA, 10 car.) pour
        // éviter de filtrer sur une date partielle pendant la saisie (masque géré par DateInput).
        const ddnFilter = ddn.length === 10 ? ddn : undefined;
        const lieuFilter = lieu.trim() || undefined;
        const data = await window.api.cartes.searchQuickLogistique(siteId, query, ddnFilter, lieuFilter);
        setResults(data || []);
      } catch (err) {
        console.error('Failed logistique search:', err);
      }
    } else {
      setResults([]);
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setSearchQuery(val);
    runSearch(val, filterDateNaissance, filterLieuNaissance);
  };

  const handleDateNaissanceFilterChange = (val: string) => {
    setFilterDateNaissance(val);
    runSearch(searchQuery, val, filterLieuNaissance);
  };

  const handleLieuNaissanceFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setFilterLieuNaissance(val);
    runSearch(searchQuery, filterDateNaissance, val);
  };

  // Raccourcis clavier globaux
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Les chiffres saisis dans les filtres facultatifs Date/Lieu de naissance ne doivent jamais
    // être interceptés comme raccourci de sélection : ces champs servent justement à affiner la
    // liste pendant qu'elle est affichée (results.length > 0), donc la saisie doit être préservée.
    const target = e.target as HTMLInputElement;
    if (target === lieuNaissanceInputRef.current || target?.name === 'filterDateNaissance') {
      return;
    }
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
    // « NON CLASSE » / vide : champ vide pour éviter à l'opérateur de l'effacer avant saisie.
    setRangement(isRangementVide(carte.rangement) ? '' : carte.rangement);
    setNumSecu(formatNumSecu(carte.num_secu));
    setContact(formatContactForDisplay(carte.contact));
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

    // Contact : envoyé (chiffres seuls) seulement si non vide ET modifié par rapport à la fiche ;
    // une valeur historique non conforme déjà en base ne bloque pas le rangement. Si saisi et
    // différent de 10 chiffres : toast clair, aucun appel IPC.
    const contactDecision = resolveContactToSend(contact, selectedCarte.contact);
    if (contactDecision.error) {
      toast.error(contactDecision.error);
      return;
    }

    try {
      setLoading(true);
      const saveRes = await window.api.cartes.updateRangementEtFiche(selectedCarte.id_carte, {
        rangement: rangement.trim().toUpperCase(),
        num_secu: numSecu.trim() || undefined,
        contact: contactDecision.contact
      });
      toast.success('Rangement mis à jour avec succès.');
      if (saveRes?.doublonBloqueSync === true) {
        toast('Ce contact crée un doublon avec une autre carte : la fiche reste en local tant que le doublon n\'est pas résolu dans le portail Qualité.', { icon: '⚠️', duration: 7000 });
      }
      resetState();
      // Notifie InventaireLayout.tsx pour recalculer dirtyCartesCount/conformeCartesCount, qui
      // pilotent l'état enabled/disabled du bouton "Envoyer les corrections" — même pattern
      // que MissingDataView.tsx/DoublonsView.tsx (AgentQualite).
      window.dispatchEvent(new CustomEvent('app:data-updated'));
    } catch (err: any) {
      toast.error(`Erreur : ${cleanIpcErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const resetState = () => {
    setSelectedCarte(null);
    setRangement('');
    setNumSecu('');
    setContact('');
    setSearchQuery('');
    setFilterDateNaissance('');
    setFilterLieuNaissance('');
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
      <div className="glass-card" style={{ padding: 32 }}>
        {!selectedCarte ? (
          /* SECTION RECHERCHE */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rechercher une fiche (Nom et Prénom)</label>
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

            {/* FILTRES FACULTATIFS DE LEVÉE DE DOUTE HOMONYMES (Date/Lieu de naissance) —
                affinent la recherche libre ci-dessus (AND côté SQL), sans obligation de saisie. */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Date de Naissance <span style={{ textTransform: 'none', fontWeight: 400 }}>(facultatif)</span>
                </label>
                <DateInput
                  name="filterDateNaissance"
                  value={filterDateNaissance}
                  onChange={handleDateNaissanceFilterChange}
                  placeholder="JJ/MM/AAAA"
                  style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 46, padding: '0 16px', outline: 'none' }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Lieu de Naissance <span style={{ textTransform: 'none', fontWeight: 400 }}>(facultatif)</span>
                </label>
                <input
                  ref={lieuNaissanceInputRef}
                  className="form-input"
                  style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 46, padding: '0 16px', outline: 'none' }}
                  type="text"
                  placeholder="Ex: ABOBO"
                  value={filterLieuNaissance}
                  onChange={handleLieuNaissanceFilterChange}
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
                    const hasRangement = !isRangementVide(c.rangement);
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
                              N° CMU : {formatNumSecu(c.num_secu) || 'NON RENSEIGNÉ'}
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

            {/* Contact facultatif (jamais obligatoire) — vide = contact existant conservé */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label htmlFor="logistique-contact-input" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                CONTACT <span style={{ fontWeight: 400 }}>(facultatif)</span>
              </label>
              <input
                id="logistique-contact-input"
                className="form-input"
                style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: isOverlongContact(contact) ? '1px solid #f59e0b' : '1px solid rgba(255,255,255,0.08)', color: 'white', height: 46, padding: '0 16px', outline: 'none' }}
                type="text"
                inputMode="numeric"
                title={isOverlongContact(contact) ? 'Contact historique non conforme (plus de 10 chiffres) : à corriger.' : undefined}
                placeholder="+225 01 02 03 04 05"
                value={contact}
                onChange={e => {
                  // Jamais de troncature silencieuse : collage > 10 chiffres => valeur inchangée + toast.
                  const res = applyPhoneChange(contact, e.target.value);
                  if (res.tooLong) toast.error(CONTACT_TOO_LONG_MESSAGE);
                  setContact(res.value);
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (rangementInputRef.current) rangementInputRef.current.focus();
                  }
                }}
              />
            </div>

            {/* Nouveau Rangement */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label htmlFor="logistique-rangement-input" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>CLASSEMENT / NOUVEAU RANGEMENT <span style={{ color: '#ffd700' }}>*</span></label>
              <input
                id="logistique-rangement-input"
                ref={rangementInputRef}
                className="form-input"
                style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', height: 46, padding: '0 16px', outline: 'none', textTransform: 'uppercase', fontWeight: 700, fontSize: 18, color: '#ffd700' }}
                type="text"
                placeholder="Ex: MAIRIE-A3"
                value={rangement}
                onChange={e => setRangement(e.target.value.toUpperCase())}
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
