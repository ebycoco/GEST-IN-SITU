import React, { useState, useEffect, useRef } from 'react';
import { Search, Calendar, MapPin, User, CheckCircle, Clock, ArrowRight, X, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import DateInput from '../../components/DateInput';
import { confirmService } from '../../components/confirmService';

export default function InventaireApurement() {
  const { user } = useAuthStore();
  const siteId = user?.site_id || 1;
  const username = user?.login || 'INCONNU';

  // Champs de recherche
  const [nomsPrenoms, setNomsPrenoms] = useState('');
  const [dateNaissance, setDateNaissance] = useState('');
  const [lieuNaissance, setLieuNaissance] = useState('');
  
  const [results, setResults] = useState<any[]>([]);
  const [selectedCarte, setSelectedCarte] = useState<any | null>(null);

  // Formulaire d'apurement
  const [dateDelivrance, setDateDelivrance] = useState(new Date().toISOString().split('T')[0]);
  const [nomRetirant, setNomRetirant] = useState('');
  const [numRetirant, setNumRetirant] = useState('');
  const [relationRetirant, setRelationRetirant] = useState('SOI-MEME');
  const [loading, setLoading] = useState(false);

  // Déclaration manuelle de doublon (plan validé) — depuis le cahier d'émargement rétroactif.
  // Bouton strictement gaté par rôle OPERATEUR_APUREMENT plus bas (composant partagé avec le
  // module Inventaire, monté aussi par OPERATEUR_INVENTAIRE/OPERATEUR_LOGISTIQUE qui ne doivent
  // pas voir cette action).
  const [showDoublonForm, setShowDoublonForm] = useState(false);
  const [doublonMotif, setDoublonMotif] = useState('');
  const [isDeclaringDoublon, setIsDeclaringDoublon] = useState(false);

  // Focus Refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dateDelivranceRef = useRef<HTMLInputElement>(null);
  const relationRef = useRef<HTMLSelectElement>(null);
  const nomRetirantRef = useRef<HTMLInputElement>(null);
  const numRetirantRef = useRef<HTMLInputElement>(null);

  // Focus initial
  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // Déclencheur de recherche explicite
  const performSearch = async () => {
    const hasNom = nomsPrenoms.trim().length >= 2;
    const hasDate = dateNaissance.length === 10;
    const hasLieu = lieuNaissance.trim().length >= 2;

    if (!hasNom && !hasDate && !hasLieu) {
      toast.error('Veuillez remplir au moins un critère de recherche valide (Nom/Prénom >= 2 car., Date complète, ou Lieu >= 2 car.).');
      return;
    }

    try {
      setLoading(true);
      const res = await window.api.cartes.searchCombinedInventaire(siteId, nomsPrenoms, dateNaissance, lieuNaissance);
      setResults(res || []);
      if (!res || res.length === 0) {
        toast.error('Aucune carte trouvée pour ces critères.');
      } else if (res.length === 20) {
        // Signal "trop de résultats" (décision produit) : la requête est plafonnée à LIMIT 20
        // côté backend (searchCombinedInventaire) sans info de comptage total supplémentaire
        // (politique low-memory §2 CLAUDE.md, pas de requête COUNT additionnelle) — le nombre
        // exact de résultats atteignant la limite sert donc de signal suffisant côté renderer.
        toast('20 résultats maximum affichés : affinez votre recherche si la carte recherchée n\'apparaît pas.', { icon: 'ℹ️' });
      }
    } catch (err) {
      console.error('Failed inventaire search:', err);
      toast.error('Erreur lors de la recherche.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch();
  };

  // Raccourcis clavier (touches numériques 1, 2, 3...)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (results.length > 0 && !selectedCarte) {
      const num = parseInt(e.key);
      if (num >= 1 && num <= results.length) {
        e.preventDefault();
        selectCard(results[num - 1]);
      }
    }
  };

  // Applique effectivement la sélection (état + focus) — factorisé pour être appelé soit
  // directement (carte non encore déchargée), soit après confirmation explicite de l'agent
  // (carte déjà DELIVRE, cf. selectCard ci-dessous).
  const applyCardSelection = (carte: any) => {
    setSelectedCarte(carte);
    setResults([]);
    // Init retirant par défaut si soi-même
    setNomRetirant(`${carte.noms} ${carte.prenoms}`);

    // Focus sur la date du retrait du cahier
    setTimeout(() => {
      if (dateDelivranceRef.current) {
        dateDelivranceRef.current.focus();
      }
    }, 50);
  };

  // Sécurité métier : updateApurementHistorique fait un UPDATE sans vérifier l'état actuel de
  // la carte — une resaisie sur une fiche déjà déchargée (statut === 'DELIVRE') écraserait
  // silencieusement l'émargement déjà enregistré (date/nom/téléphone du retirant). L'agent peut
  // avoir oublié qu'il (ou un collègue) a déjà traité cette fiche : on affiche donc un
  // avertissement explicite avant de laisser resaisir, avec option d'annulation.
  const selectCard = async (carte: any) => {
    if (carte.statut === 'DELIVRE') {
      const confirmed = await confirmService.confirm({
        title: 'Carte déjà déchargée',
        message: `Cette carte a déjà été déchargée le ${carte.date_delivrance || '—'} par ${carte.agent_distributeur || 'un agent inconnu'}, au nom de ${carte.nom_retirant || 'un retirant non renseigné'}. Voulez-vous vraiment continuer et remplacer cet émargement ?`,
        isDanger: true,
        confirmText: 'Continuer quand même',
        cancelText: 'Annuler'
      });
      if (!confirmed) return;
    }
    applyCardSelection(carte);
  };

  const handleRelationChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setRelationRetirant(val);
    if (val === 'SOI-MEME' && selectedCarte) {
      setNomRetirant(`${selectedCarte.noms} ${selectedCarte.prenoms}`);
    } else if (val !== 'SOI-MEME' && nomRetirant === `${selectedCarte?.noms} ${selectedCarte?.prenoms}`) {
      setNomRetirant('');
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCarte) return;
    if (!nomRetirant.trim()) {
      toast.error('Le nom du retirant est obligatoire.');
      return;
    }
    if (!numRetirant.trim()) {
      toast.error('Le téléphone du retirant est obligatoire.');
      return;
    }

    try {
      setLoading(true);
      await window.api.cartes.updateApurementHistorique(selectedCarte.id_carte, {
        date_delivrance: dateDelivrance,
        nom_retirant: nomRetirant.trim().toUpperCase(),
        num_retirant: numRetirant.trim(),
        relation_retirant: relationRetirant,
        agent_distributeur: username
      });
      toast.success('Décharge historique enregistrée avec succès.');
      resetState();
    } catch (err: any) {
      toast.error(`Erreur d'enregistrement : ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const resetState = () => {
    setSelectedCarte(null);
    setNomsPrenoms('');
    setDateNaissance('');
    setLieuNaissance('');
    setResults([]);
    setNomRetirant('');
    setNumRetirant('');
    setRelationRetirant('SOI-MEME');
    setDateDelivrance(new Date().toISOString().split('T')[0]);
    setShowDoublonForm(false);
    setDoublonMotif('');
    setTimeout(() => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    }, 50);
  };

  // Déclaration manuelle de doublon (plan validé) : blocage immédiat côté serveur
  // (declarerDoublon(), cartes.queries.ts) — motif obligatoire, revalidé côté serveur même si
  // déjà vérifié ici.
  const handleDeclarerDoublon = async () => {
    if (!selectedCarte) return;
    if (!doublonMotif.trim()) {
      toast.error('Le motif de la déclaration de doublon est obligatoire.');
      return;
    }
    try {
      setIsDeclaringDoublon(true);
      await window.api.cartes.declarerDoublon(selectedCarte.id_carte, doublonMotif.trim());
      toast.success('Carte déclarée en doublon. Elle ne pourra plus être émargée.');
      resetState();
    } catch (err: any) {
      toast.error(`Erreur lors de la déclaration du doublon : ${err.message || err}`);
    } finally {
      setIsDeclaringDoublon(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: '40px 24px', maxWidth: 800, margin: '0 auto' }} onKeyDown={handleKeyDown}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ 
          display: 'inline-flex', padding: 16, background: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)', 
          borderRadius: 20, color: 'white', marginBottom: 16, boxShadow: '0 8px 24px rgba(236, 72, 153, 0.3)' 
        }}>
          <Clock size={32} />
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, marginBottom: 8, color: 'white' }}>APUREMENT DES CAHIERS HISTORIQUES</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Saisie à la chaîne des fiches d'émargement physiques.</p>
      </div>

      <div className="glass-card" style={{ padding: 32 }}>
        {!selectedCarte ? (
          /* SECTION RECHERCHE COMBINÉE */
          <form onSubmit={handleSearchSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: 16 }}>
              {/* Nom & Prénoms */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Nom & Prénoms</label>
                <div style={{ position: 'relative' }}>
                  <User size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-pink)' }} />
                  <input
                    ref={searchInputRef}
                    className="form-input"
                    style={{ width: '100%', paddingLeft: 38, borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 44, outline: 'none' }}
                    type="text"
                    placeholder="Saisir nom & prénoms..."
                    value={nomsPrenoms}
                    onChange={e => setNomsPrenoms(e.target.value.toUpperCase())}
                  />
                </div>
              </div>

              {/* Date Naissance */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Date de Naissance</label>
                <DateInput
                  value={dateNaissance}
                  onChange={setDateNaissance}
                />
              </div>

              {/* Lieu Naissance */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Lieu de Naissance</label>
                <div style={{ position: 'relative' }}>
                  <MapPin size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-pink)' }} />
                  <input
                    className="form-input"
                    style={{ width: '100%', paddingLeft: 38, borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 44, outline: 'none' }}
                    type="text"
                    placeholder="Lieu de naissance..."
                    value={lieuNaissance}
                    onChange={e => setLieuNaissance(e.target.value.toUpperCase())}
                  />
                </div>
              </div>
            </div>

            {/* BOUTON RECHERCHER PLEIN SOLEIL */}
            <button
              type="submit"
              disabled={loading}
              className="premium-btn"
              style={{
                width: '100%',
                background: '#ffd700',
                color: '#000000',
                fontWeight: 800,
                fontSize: 14,
                borderRadius: 12,
                height: 44,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s',
                textTransform: 'uppercase',
                boxShadow: '0 4px 12px rgba(255, 215, 0, 0.2)',
                opacity: loading ? 0.7 : 1
              }}
            >
              <Search size={18} />
              {loading ? 'Recherche en cours...' : 'Rechercher'}
            </button>

            {/* LEVÉE DE DOUTE CLAVIER */}
            {results.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#ffd700', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  💡 Touches (1, 2, 3...) pour sélectionner l'assuré émargé
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {results.map((c, idx) => (
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
                        <div style={{
                          width: 28, height: 28, borderRadius: 8, background: '#ec4899', color: 'white',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13
                        }}>
                          {idx + 1}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, color: 'white', fontSize: 15 }}>{c.noms} {c.prenoms}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            Né(e) le {c.date_de_naissance || '—'} à <span style={{ color: '#ec4899', fontWeight: 600 }}>{c.lieu_de_naissance || '—'}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: 2 }}>
                            Statut : <span style={{ color: c.statut === 'EN STOCK' ? '#10b981' : '#ec4899', fontWeight: 700 }}>{c.statut}</span> | CMU : {c.num_secu || '—'}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Rangement : <strong style={{ color: 'white' }}>{c.rangement || 'AUCUN'}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </form>
        ) : (
          /* FORMULAIRE D'ÉMARGEMENT HISTORIQUE */
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ padding: 20, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#ffd700', textTransform: 'uppercase', marginBottom: 4 }}>Dossier Sélectionné</div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'white' }}>{selectedCarte.noms} {selectedCarte.prenoms}</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                Né(e) le {selectedCarte.date_de_naissance} à {selectedCarte.lieu_de_naissance} | CMU : {selectedCarte.num_secu || 'NON RENSEIGNÉ'}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Date de Retrait */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>DATE DU RETRAIT (Cahier)</label>
                <input
                  ref={dateDelivranceRef}
                  className="form-input"
                  style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 44, padding: '0 16px', outline: 'none' }}
                  type="date"
                  value={dateDelivrance}
                  onChange={e => setDateDelivrance(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (relationRef.current) relationRef.current.focus();
                    }
                  }}
                />
              </div>

              {/* Lien de parenté */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>LIEN DE PARENTÉ</label>
                <select
                  ref={relationRef}
                  className="form-select"
                  style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 44, padding: '0 16px', outline: 'none' }}
                  value={relationRetirant}
                  onChange={handleRelationChange}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (nomRetirantRef.current) nomRetirantRef.current.focus();
                    }
                  }}
                >
                  <option value="SOI-MEME">L'assuré lui-même (Soi-même)</option>
                  <option value="CONJOINT">Conjoint (Époux / Épouse)</option>
                  <option value="ENFANT">Enfant</option>
                  <option value="PARENT">Parent (Père / Mère)</option>
                  <option value="FRERE/SOEUR">Frère / Sœur</option>
                  <option value="COLLABORATEUR">Collaborateur / Mandataire</option>
                </select>
              </div>
            </div>

            {/* Nom Complet Retirant */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>NOM COMPLET DU RETIRANT *</label>
              <input
                ref={nomRetirantRef}
                className="form-input"
                style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 44, padding: '0 16px', outline: 'none', textTransform: 'uppercase' }}
                type="text"
                placeholder="Ex: KOUASSI KOFFI JEAN"
                value={nomRetirant}
                onChange={e => setNomRetirant(e.target.value.toUpperCase())}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (numRetirantRef.current) numRetirantRef.current.focus();
                  }
                }}
              />
            </div>

            {/* Numéro de Contact Retirant */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>N° DE TÉLÉPHONE DU RETIRANT *</label>
              <input
                ref={numRetirantRef}
                className="form-input"
                style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 44, padding: '0 16px', outline: 'none' }}
                type="text"
                placeholder="Ex: 0707..."
                value={numRetirant}
                onChange={e => setNumRetirant(e.target.value)}
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
                style={{ flex: 1.5, padding: '14px', background: 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)', border: 'none', borderRadius: 12, color: 'white', fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                Valider l'Apurement (Entrée) <ArrowRight size={18} />
              </button>
            </div>

            {/* Déclaration manuelle de doublon (plan validé) — gatée strictement par rôle
                OPERATEUR_APUREMENT : ce composant est aussi monté par le module Inventaire
                (OPERATEUR_INVENTAIRE, OPERATEUR_LOGISTIQUE via /inventaire), qui ne doit pas
                voir cette action. */}
            {user?.role === 'OPERATEUR_APUREMENT' && (
              <div style={{ marginTop: 8, padding: 16, background: 'rgba(127, 29, 29, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {!showDoublonForm ? (
                  <button
                    type="button"
                    onClick={() => setShowDoublonForm(true)}
                    style={{ alignSelf: 'flex-start', padding: '10px 16px', background: 'transparent', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: 10, color: '#f87171', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <AlertTriangle size={16} />
                    Marquer comme doublon
                  </button>
                ) : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#f87171', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AlertTriangle size={14} />
                      Le requérant détient déjà cette carte (faite ailleurs)
                    </div>
                    <textarea
                      className="form-input"
                      style={{ width: '100%', minHeight: 80, borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: 12, outline: 'none', resize: 'vertical' }}
                      placeholder="Motif obligatoire — Ex : Le requérant présente déjà sa carte CMU physique, délivrée au centre X le..."
                      value={doublonMotif}
                      onChange={e => setDoublonMotif(e.target.value)}
                      required
                    />
                    <div style={{ display: 'flex', gap: 12 }}>
                      <button
                        type="button"
                        onClick={() => { setShowDoublonForm(false); setDoublonMotif(''); }}
                        disabled={isDeclaringDoublon}
                        style={{ flex: 1, padding: 12, background: '#1e2235', border: 'none', borderRadius: 10, color: 'white', fontWeight: 600, cursor: 'pointer' }}
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={handleDeclarerDoublon}
                        disabled={isDeclaringDoublon || !doublonMotif.trim()}
                        style={{ flex: 1.5, padding: 12, background: '#7f1d1d', border: 'none', borderRadius: 10, color: 'white', fontWeight: 800, cursor: (isDeclaringDoublon || !doublonMotif.trim()) ? 'not-allowed' : 'pointer', opacity: (isDeclaringDoublon || !doublonMotif.trim()) ? 0.6 : 1 }}
                      >
                        {isDeclaringDoublon ? 'Déclaration...' : 'Confirmer le doublon'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
