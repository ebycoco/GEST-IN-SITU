import React, { useCallback, useEffect, useState } from 'react';
import { Package, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { PaginationInput } from '../../components/PaginationInput';

const ITEMS_PER_PAGE = 15;

interface CarteSansRangement {
  id_carte: number;
  noms: string;
  prenoms: string;
  num_secu: string | null;
}

/**
 * Page "Sans rangement" (portail OPERATEUR_LOGISTIQUE, plan validé) — liste en masse les cartes
 * sans rangement assigné (rangement NULL/vide/'NON CLASSE') et permet d'assigner un rangement
 * directement depuis la liste, sans avoir à les chercher une par une via "CLASSEMENT LOGISTIQUE"
 * (InventaireLogistique.tsx, inchangée). Même principe que la page "Cartes mal-centrées"
 * (InventaireCartesMalCentrees.tsx) dont ce composant reprend le gabarit et la charte visuelle.
 *
 * Lecture : queries.getSansRangementPage() (cartes.queries.ts), fonction partagée avec le
 * portail Qualité (MissingDataView.tsx) — élargie de façon additive/non-cassante avec un
 * paramètre `sortOrder` optionnel ('oldest' ici : plus anciennes en premier, décision produit
 * validée), sans changer le comportement par défaut ('recent') pour l'appelant historique.
 * Écriture : queries.updateRangementEtFiche() (cartes.queries.ts:2044-2117) via le handler IPC
 * cartes:updateRangementEtFiche, réutilisée telle quelle (déjà transactionnelle, déjà ouverte à
 * OPERATEUR_LOGISTIQUE, recalcule déjà centre_id à partir du préfixe de rangement).
 *
 * Pas de confirmation modale avant l'enregistrement (décision produit validée) : juste un toast
 * de succès/erreur, cohérent avec le rythme de traitement en masse attendu sur cette page.
 */
export default function InventaireSansRangement() {
  const { user, activeSiteId } = useAuthStore();
  const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;

  const [rows, setRows] = useState<CarteSansRangement[]>([]);
  const [editValues, setEditValues] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));

  const loadData = useCallback(async (silent = false) => {
    if (!siteIdToUse) { setRows([]); setTotalItems(0); setIsLoading(false); return; }
    try {
      if (!silent) setIsLoading(true);
      const offset = (currentPage - 1) * ITEMS_PER_PAGE;
      const res = await window.api.cartes.getSansRangementPage(Number(siteIdToUse), offset, ITEMS_PER_PAGE, '', undefined, 'oldest');
      const nextRows = (res?.rows || []) as CarteSansRangement[];
      const nextTotal = res?.total || 0;
      setRows(nextRows);
      setTotalItems(nextTotal);
      // Auto-correction défensive : si l'offset demandé était devenu obsolète (ex. reload
      // silencieux déclenché par app:data-updated avec un currentPage pas encore aligné sur le
      // total réel — voir handleSave), la réponse serveur peut renvoyer rows:[] alors que total
      // reste correct. On reclampe ici currentPage sur newTotalPages calculé depuis ce total
      // fiable : si ça change la page, loadData (useCallback dépendant de currentPage) change de
      // référence et l'effet de montage relance automatiquement une requête avec le bon offset.
      // Sans ce garde-fou, la page resterait bloquée sur un offset vide malgré des cartes encore
      // présentes en page 1 (bug corrigé par ce ticket).
      const newTotalPages = Math.max(1, Math.ceil(nextTotal / ITEMS_PER_PAGE));
      setCurrentPage(prev => Math.min(prev, newTotalPages));
      // Réinitialisation des valeurs éditées sur la page courante uniquement (Low-Memory §2 :
      // pas de rétention indéfinie de valeurs pour des lignes déjà quittées).
      setEditValues(Object.fromEntries(nextRows.map(r => [r.id_carte, ''])));
    } catch (err) {
      console.error('Erreur lors du chargement des cartes sans rangement :', err);
      toast.error('Erreur lors du chargement des cartes sans rangement.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [siteIdToUse, currentPage]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Rafraîchissement discret sur les corrections effectuées ailleurs dans le hub (même pattern
  // que InventaireCartesMalCentrees.tsx/InventaireOverview.tsx).
  useEffect(() => {
    const handleDataUpdated = () => { loadData(true); };
    window.addEventListener('app:data-updated', handleDataUpdated);
    return () => window.removeEventListener('app:data-updated', handleDataUpdated);
  }, [loadData]);

  const handleSave = async (carte: CarteSansRangement) => {
    const value = (editValues[carte.id_carte] ?? '').trim();
    if (!value) {
      toast.error('Veuillez saisir un rangement avant d\'enregistrer.');
      return;
    }
    try {
      setSavingId(carte.id_carte);
      await window.api.cartes.updateRangementEtFiche(carte.id_carte, { rangement: value });
      toast.success(`Rangement enregistré pour ${carte.noms} ${carte.prenoms}.`);
      // Retrait local immédiat de la ligne traitée (pas d'attente d'un rechargement complet).
      setRows(prev => prev.filter(r => r.id_carte !== carte.id_carte));
      setTotalItems(prev => Math.max(0, prev - 1));
      // Recale currentPage sur le nouveau total (ex. dernière carte de la page courante
      // enregistrée) — même modèle que InventaireCartesMalCentrees.tsx (handleCorriger). Sans ce
      // recalage, un offset obsolète survivrait jusqu'au prochain rechargement et pourrait
      // afficher une page vide alors qu'il reste des cartes en page 1 (bug corrigé par ce ticket).
      const newTotal = Math.max(0, totalItems - 1);
      const newTotalPages = Math.max(1, Math.ceil(newTotal / ITEMS_PER_PAGE));
      setCurrentPage(prev => Math.min(prev, newTotalPages));
      // Notifie le reste du hub (compteurs InventaireLayout.tsx, etc.) — même pattern que
      // InventaireCartesMalCentrees.tsx/InventaireLogistique.tsx. Le rechargement silencieux que
      // ce dispatch provoque en interne (listener app:data-updated ci-dessus, loadData(true)) peut
      // partir d'un offset encore basé sur l'ancien currentPage (closure figée avant ce commit
      // React) : c'est le garde-fou posé dans loadData (clamp sur le total serveur reçu) qui
      // absorbe ce cas plutôt qu'un ordre d'appel ici, un setState React ne changeant pas la
      // valeur lue de façon synchrone par le code qui suit dans le même tick.
      window.dispatchEvent(new CustomEvent('app:data-updated'));
    } catch (err: any) {
      toast.error(`Erreur : ${err.message || err}`);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Package size={20} color="#f97316" />
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'white' }}>Sans rangement</h2>
        </div>
        <button
          onClick={() => loadData()}
          className="btn-outline"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'white', cursor: 'pointer' }}
        >
          <RefreshCw size={14} /> Actualiser
        </button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
        Cartes sans rangement assigné (plus anciennes en premier). Saisissez un rangement et
        enregistrez directement depuis la liste, sans passer par la recherche individuelle de
        "CLASSEMENT LOGISTIQUE".
      </p>

      <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement en cours...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <Package size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            Aucune carte sans rangement détectée.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Nom</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Prénom</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>N° Sécu</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Rangement</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isSaving = savingId === r.id_carte;
                  const value = editValues[r.id_carte] ?? '';
                  return (
                    <tr key={r.id_carte} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '16px 24px', fontWeight: 600, color: 'white' }}>{r.noms}</td>
                      <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>{r.prenoms}</td>
                      <td style={{ padding: '16px 24px', fontFamily: 'monospace', color: '#6ee7b7' }}>{r.num_secu || '—'}</td>
                      <td style={{ padding: '16px 24px' }}>
                        <input
                          type="text"
                          value={value}
                          disabled={isSaving}
                          onChange={(e) => setEditValues(prev => ({ ...prev, [r.id_carte]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSave(r); }}
                          placeholder="Ex: A-12-034"
                          style={{
                            width: 160, padding: '8px 10px', borderRadius: 8, fontSize: 13,
                            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
                            color: 'white', outline: 'none'
                          }}
                        />
                      </td>
                      <td style={{ padding: '16px 24px' }}>
                        <button
                          onClick={() => handleSave(r)}
                          disabled={isSaving || !value.trim()}
                          style={{
                            padding: '8px 14px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 12,
                            cursor: (isSaving || !value.trim()) ? 'not-allowed' : 'pointer',
                            opacity: (isSaving || !value.trim()) ? 0.6 : 1,
                            background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
                            color: 'white'
                          }}
                        >
                          {isSaving ? 'Enregistrement...' : 'Enregistrer'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Affichage {((currentPage - 1) * ITEMS_PER_PAGE) + 1} à {Math.min(currentPage * ITEMS_PER_PAGE, totalItems)} sur {totalItems}
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button className="btn btn-secondary" disabled={currentPage === 1 || isLoading} onClick={() => setCurrentPage(p => p - 1)}>Précédent</button>
              <PaginationInput
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
                disabled={isLoading}
              />
              <button className="btn btn-secondary" disabled={currentPage === totalPages || isLoading} onClick={() => setCurrentPage(p => p + 1)}>Suivant</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
