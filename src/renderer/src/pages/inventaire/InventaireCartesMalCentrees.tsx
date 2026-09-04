import React, { useCallback, useEffect, useState } from 'react';
import { MapPinOff, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { confirmService } from '../../components/confirmService';
import { PaginationInput } from '../../components/PaginationInput';

// Pagination CÔTÉ RENDERER uniquement (slice d'un tableau déjà entièrement chargé en mémoire) —
// pas de LIMIT/OFFSET SQL possible ici : getCartesMalCentrees() (cartes.queries.ts:1057-1129)
// calcule un index de routage préfixe→centre en mémoire TypeScript et applique le filtre
// "mal centrée" (expected.centre_id !== row.centre_id) APRÈS la lecture SQL complète, donc hors
// du WHERE. Une vraie pagination SQL nécessiterait de restructurer cet algorithme (hors périmètre
// de ce ticket — voir STOP & WARN du rapport associé). Même valeur que InventaireSansRangement.tsx
// pour la cohérence visuelle entre les deux pages du portail OPERATEUR_LOGISTIQUE.
const ITEMS_PER_PAGE = 15;

interface CarteMalCentree {
  id_carte: number;
  noms: string;
  prenoms: string;
  num_secu: string | null;
  rangement: string;
  centre_id_actuel: number | null;
  nom_centre_actuel: string | null;
  centre_id_attendu: number;
  nom_centre_attendu: string;
  statut: string;
}

/**
 * Page "Cartes mal-centrées" (portail OPERATEUR_LOGISTIQUE, plan validé) — liste les cartes dont
 * le rangement physique matche (par préfixe) un centre du site différent du centre_id
 * actuellement stocké, y compris centre_id NULL (voir commentaire de tête de
 * getCartesMalCentrees(), cartes.queries.ts). Ces cartes sont bloquées à la délivrance pour les
 * agents du centre attendu (delivrerCarte(), cartes.queries.ts:~640) sans qu'aucun message
 * n'explique pourquoi — cette page permet de corriger le centre_id pour rendre la carte à
 * nouveau délivrable.
 *
 * Réservée à OPERATEUR_LOGISTIQUE côté navigation (route dédiée, voir App.tsx/Sidebar.tsx) — le
 * handler IPC backend (cartes:getCartesMalCentrees / cartes:corrigerCentreCarte) reste, lui,
 * ouvert aux 4 rôles du hub (décision produit validée), au même titre que
 * stats:getInventaireOverview.
 *
 * Cartes DOUBLON/DELIVRE : non corrigibles ici (verrous serveur dans corrigerCentreCarte()) —
 * l'action "Corriger" reste affichée pour ces lignes (transparence : la carte est bien
 * mal-centrée, l'agent doit comprendre pourquoi elle reste bloquée) mais l'erreur serveur
 * explicite remonte via toast si l'agent tente quand même la correction.
 */
export default function InventaireCartesMalCentrees() {
  const { user, activeSiteId } = useAuthStore();
  const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;

  const [rows, setRows] = useState<CarteMalCentree[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [correctingId, setCorrectingId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(rows.length / ITEMS_PER_PAGE));
  const pagedRows = rows.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const loadData = useCallback(async (silent = false) => {
    if (!siteIdToUse) { setRows([]); setCurrentPage(1); setIsLoading(false); return; }
    try {
      if (!silent) setIsLoading(true);
      const res = await window.api.cartes.getCartesMalCentrees(Number(siteIdToUse));
      const nextRows = res || [];
      setRows(nextRows);
      // Conserve la page courante si elle reste valide vis-à-vis du nouveau total ; sinon
      // recale sur la dernière page valide (ex. anomalies corrigées ailleurs entre-temps).
      const newTotalPages = Math.max(1, Math.ceil(nextRows.length / ITEMS_PER_PAGE));
      setCurrentPage(prev => Math.min(prev, newTotalPages));
    } catch (err) {
      console.error('Erreur lors du chargement des cartes mal-centrées :', err);
      toast.error('Erreur lors du chargement des cartes mal-centrées.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [siteIdToUse]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Rafraîchissement discret sur les corrections effectuées ailleurs dans le hub (même pattern
  // que InventaireOverview.tsx/ApurementOverview.tsx).
  useEffect(() => {
    const handleDataUpdated = () => { loadData(true); };
    window.addEventListener('app:data-updated', handleDataUpdated);
    return () => window.removeEventListener('app:data-updated', handleDataUpdated);
  }, [loadData]);

  const handleCorriger = async (carte: CarteMalCentree) => {
    const confirmed = await confirmService.confirm({
      title: 'Corriger le centre de la carte',
      message: `Confirmez-vous le rattachement de la carte de ${carte.noms} ${carte.prenoms} au centre "${carte.nom_centre_attendu}" (d'après son rangement "${carte.rangement}") ? Le centre actuellement enregistré est "${carte.nom_centre_actuel || 'aucun'}".`,
      confirmText: 'Corriger',
      cancelText: 'Annuler'
    });
    if (!confirmed) return;

    try {
      setCorrectingId(carte.id_carte);
      await window.api.cartes.corrigerCentreCarte(carte.id_carte);
      toast.success(`Centre corrigé pour ${carte.noms} ${carte.prenoms}.`);
      // Retrait local immédiat de la ligne corrigée (pas d'attente d'un rechargement complet).
      const nextRows = rows.filter(r => r.id_carte !== carte.id_carte);
      setRows(nextRows);
      // Si la page courante devient vide (ex. dernière ligne de la dernière page corrigée),
      // recule sur la dernière page encore valide.
      const newTotalPages = Math.max(1, Math.ceil(nextRows.length / ITEMS_PER_PAGE));
      setCurrentPage(prev => Math.min(prev, newTotalPages));
      // Notifie le reste du hub (compteurs InventaireLayout.tsx, etc.) — même pattern que
      // InventaireLogistique.tsx/InventaireApurement.tsx.
      window.dispatchEvent(new CustomEvent('app:data-updated'));
    } catch (err: any) {
      toast.error(`Erreur : ${err.message || err}`);
    } finally {
      setCorrectingId(null);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1100, margin: '0 auto', padding: '24px 32px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MapPinOff size={20} color="#f97316" />
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'white' }}>Cartes mal-centrées</h2>
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
        Cartes dont le rangement physique correspond au préfixe d'un autre centre que celui
        actuellement enregistré. Tant que le centre n'est pas corrigé, ces cartes sont bloquées à
        la délivrance pour les agents du centre attendu.
      </p>

      <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement en cours...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <MapPinOff size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            Aucune carte mal-centrée détectée.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Identité</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>N° Sécu</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Rangement</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Centre actuel</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Centre attendu</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Statut</th>
                  <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((r) => {
                  const isLocked = r.statut === 'DOUBLON' || r.statut === 'DELIVRE';
                  return (
                    <tr key={r.id_carte} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '16px 24px' }}>
                        <div style={{ fontWeight: 600, color: 'white' }}>{r.noms} {r.prenoms}</div>
                      </td>
                      <td style={{ padding: '16px 24px', fontFamily: 'monospace', color: '#6ee7b7' }}>{r.num_secu || '—'}</td>
                      <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>{r.rangement}</td>
                      <td style={{ padding: '16px 24px', color: '#f87171' }}>{r.nom_centre_actuel || 'Aucun'}</td>
                      <td style={{ padding: '16px 24px', color: '#34d399', fontWeight: 600 }}>{r.nom_centre_attendu}</td>
                      <td style={{ padding: '16px 24px', color: 'var(--text-secondary)' }}>{r.statut}</td>
                      <td style={{ padding: '16px 24px' }}>
                        <button
                          onClick={() => handleCorriger(r)}
                          disabled={correctingId === r.id_carte}
                          title={isLocked ? `Carte ${r.statut} — la correction sera refusée par le serveur, contactez un administrateur.` : undefined}
                          style={{
                            padding: '8px 14px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 12,
                            cursor: correctingId === r.id_carte ? 'not-allowed' : 'pointer',
                            opacity: correctingId === r.id_carte ? 0.6 : 1,
                            background: isLocked ? 'rgba(248, 113, 113, 0.15)' : 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
                            color: isLocked ? '#f87171' : 'white'
                          }}
                        >
                          {correctingId === r.id_carte ? 'Correction...' : 'Corriger'}
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
              Affichage {((currentPage - 1) * ITEMS_PER_PAGE) + 1} à {Math.min(currentPage * ITEMS_PER_PAGE, rows.length)} sur {rows.length}
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
