import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Database, AlertTriangle, GitMerge, Trash2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../stores/authStore';
import { useQualityUIStore } from '../../../stores/qualityUIStore';
import { AdvancedSearchBar } from '../../../components/Quality/AdvancedSearchBar';
import { QualityFilters } from '../../../../../shared/types/quality.types';
import { PaginationInput } from '../../../components/PaginationInput';
import { useDebounce } from '../../../hooks/useDebounce';

export default function DoublonsView() {
  const { user, activeSiteId } = useAuthStore();
  const siteIdToUse = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? 1;

  const [activeTab, setActiveTab] = useState<'DOUBLONS' | 'DOUBLONS_PROBABLES'>('DOUBLONS');
  const [filters, setFilters] = useState<QualityFilters>({});
  const debouncedFilters = useDebounce(filters, 500);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [records, setRecords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { openCorrection, refreshTrigger, openGuide, isFetchingQuery, setIsFetchingQuery } = useQualityUIStore();

  // Modales
  const [mergeModal, setMergeModal] = useState<{ isOpen: boolean; target: any; source: any } | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; cardId: number; cardName: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMerging, setIsMerging] = useState(false);

  const itemsPerPage = 10;

  const loadTabData = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    setIsFetchingQuery(true);
    try {
      const offset = (currentPage - 1) * itemsPerPage;
      let res;
      if (activeTab === 'DOUBLONS') {
        res = await window.api.cartes.getDoublonsPage(siteIdToUse, offset, itemsPerPage, debouncedFilters.nom || '');
      } else {
        res = await window.api.cartes.getDoublonsProbablesPage(siteIdToUse, offset, itemsPerPage, debouncedFilters.nom || '');
      }
      
      const rawRows = res?.rows || [];
      const pairedRecords: any[] = [];
      
      // Group flat rows into pairs (carte1 = target, carte2 = source duplicate)
      const groups = new Map<string, any[]>();
      rawRows.forEach((r: any) => {
        const groupKey = activeTab === 'DOUBLONS' 
          ? r.cle_doublon 
          : `${r.noms}|${r.prenoms}|${r.date_de_naissance}`;
          
        if (!groups.has(groupKey)) {
          groups.set(groupKey, []);
        }
        groups.get(groupKey)!.push(r);
      });
      
      groups.forEach((cards) => {
        if (cards.length > 1) {
          const targetCard = cards[0];
          // For each subsequent card in the group, create a pair with the first card
          for (let i = 1; i < cards.length; i++) {
            pairedRecords.push({
              carte1: targetCard,
              carte2: cards[i],
              similitude: activeTab === 'DOUBLONS' ? 'Identique' : 'Probable'
            });
          }
        }
      });

      setRecords(pairedRecords);
      setTotalItems(res?.total || 0);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du chargement des données.');
    } finally {
      setIsLoading(false);
      setIsFetchingQuery(false);
    }
  }, [activeTab, currentPage, debouncedFilters.nom, siteIdToUse, refreshTrigger, setIsFetchingQuery]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  // Réinitialiser la page sur changement
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedFilters, activeTab]);

  const executeDelete = async () => {
    if (!deleteModal || isDeleting) return;
    setIsDeleting(true);
    try {
      await window.api.cartes.delete(deleteModal.cardId, user);
      toast.success('Doublon supprimé !');
      setDeleteModal(null);
      loadTabData();
      // Notifie AgentQualiteLayout.tsx pour recalculer dirtyCartesCount/detailedSyncStats,
      // qui pilotent l'état enabled/disabled du bouton "Envoyer les corrections" — même bug
      // que celui corrigé sur AgentVerificationLayout.tsx. Le layout écoute déjà cet
      // événement (cf. onSave de CorrectionSidePanel, même convention).
      window.dispatchEvent(new CustomEvent('app:data-updated'));
    } catch (err) {
      toast.error('Impossible de supprimer la carte.');
    } finally {
      setIsDeleting(false);
    }
  };

  const executeMerge = async () => {
    if (!mergeModal || isMerging) return;
    setIsMerging(true);
    const { target, source } = mergeModal;
    try {
      const mergedFields: string[] = [];
      if (!target.num_secu && source.num_secu) mergedFields.push('num_secu');
      if ((!target.rangement || target.rangement === 'NON CLASSE') && source.rangement) mergedFields.push('rangement');
      
      await window.api.qualite.fusionnerDoublons({
        id_carte_source: source.id_carte,
        id_carte_cible: target.id_carte,
        champs_fusionnes: mergedFields
      });
      toast.success('Cartes fusionnées avec succès !');
      setMergeModal(null);
      loadTabData();
      // Notifie AgentQualiteLayout.tsx pour recalculer dirtyCartesCount/detailedSyncStats,
      // qui pilotent l'état enabled/disabled du bouton "Envoyer les corrections" — même bug
      // que celui corrigé sur AgentVerificationLayout.tsx. Le layout écoute déjà cet
      // événement (cf. onSave de CorrectionSidePanel, même convention).
      window.dispatchEvent(new CustomEvent('app:data-updated'));
    } catch (err) {
      toast.error('Erreur lors de la fusion.');
    } finally {
      setIsMerging(false);
    }
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'white', margin: 0 }}>Traitement des Doublons</h2>
        
        <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.02)', padding: 4, borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
          <button 
            onClick={() => setActiveTab('DOUBLONS')}
            style={{ 
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: activeTab === 'DOUBLONS' ? 'rgba(255,215,0,0.1)' : 'transparent',
              color: activeTab === 'DOUBLONS' ? '#FFE600' : 'var(--text-muted)'
            }}>
            Doublons Stricts
          </button>
          <button 
            onClick={() => setActiveTab('DOUBLONS_PROBABLES')}
            style={{ 
              padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: activeTab === 'DOUBLONS_PROBABLES' ? 'rgba(255,215,0,0.1)' : 'transparent',
              color: activeTab === 'DOUBLONS_PROBABLES' ? '#FFE600' : 'var(--text-muted)'
            }}>
            Doublons Probables
          </button>
        </div>
      </div>

      <AdvancedSearchBar 
        filters={filters} 
        setFilters={setFilters} 
        disabled={isLoading || isFetchingQuery}
      />

      <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="table-responsive">
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Assuré principal</th>
                <th>Détails doublon</th>
                <th>Comparaison</th>
                <th style={{ textAlign: 'right', paddingRight: 20 }}>Actions de Fusion</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                    <RefreshCw className="animate-spin" size={24} style={{ margin: '0 auto 12px' }} />
                    Chargement...
                  </td>
                </tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
                    Aucun doublon trouvé.
                  </td>
                </tr>
              ) : (
                records.map((r, i) => {
                  const targetCard = r.carte1;
                  const sourceCard = r.carte2;
                  if (!targetCard || !sourceCard) return null;

                  return (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ paddingLeft: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(46,213,115,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2ed573' }}>
                            <Database size={18} />
                          </div>
                          <div>
                            <strong>{targetCard.noms} {targetCard.prenoms}</strong>
                            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>ID: {targetCard.id_carte}</span>
                              <span style={{ fontSize: 11, background: targetCard.num_secu ? 'rgba(46,213,115,0.1)' : 'rgba(255,99,72,0.1)', color: targetCard.num_secu ? '#2ed573' : '#ff6b81', padding: '2px 6px', borderRadius: 4 }}>
                                🛡️ {targetCard.num_secu || 'Sans Sécu'}
                              </span>
                              <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>📦 {targetCard.rangement || 'NON CLASSE'}</span>
                              {targetCard.date_de_naissance && <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>📅 {targetCard.date_de_naissance}</span>}
                              {targetCard.lieu_de_naissance && <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>📍 {targetCard.lieu_de_naissance}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
                            <AlertTriangle size={18} />
                          </div>
                          <div>
                            <strong style={{ color: '#ef4444' }}>{sourceCard.noms} {sourceCard.prenoms}</strong>
                            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', opacity: 0.8 }}>
                              <span style={{ fontSize: 11, background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: 4, color: '#ef4444' }}>ID: {sourceCard.id_carte}</span>
                              <span style={{ fontSize: 11, background: sourceCard.num_secu ? 'rgba(46,213,115,0.1)' : 'rgba(255,99,72,0.1)', color: sourceCard.num_secu ? '#2ed573' : '#ff6b81', padding: '2px 6px', borderRadius: 4 }}>
                                🛡️ {sourceCard.num_secu || 'Sans Sécu'}
                              </span>
                              <span style={{ fontSize: 11, background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: 4, color: '#ef4444' }}>📦 {sourceCard.rangement || 'NON CLASSE'}</span>
                              {sourceCard.date_de_naissance && <span style={{ fontSize: 11, background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: 4, color: '#ef4444' }}>📅 {sourceCard.date_de_naissance}</span>}
                              {sourceCard.lieu_de_naissance && <span style={{ fontSize: 11, background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: 4, color: '#ef4444' }}>📍 {sourceCard.lieu_de_naissance}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                          Similitude: <strong>{r.similitude || 'Identique'}</strong>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', paddingRight: 20 }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <button className="btn btn-secondary" onClick={() => setMergeModal({ isOpen: true, target: targetCard, source: sourceCard })} title="Fusionner (Garder principal)">
                            <GitMerge size={14} /> Fusionner
                          </button>
                          <button className="btn btn-danger" onClick={() => setDeleteModal({ isOpen: true, cardId: sourceCard.id_carte, cardName: `${sourceCard.noms} ${sourceCard.prenoms}` })} title="Supprimer le doublon direct" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                            <Trash2 size={14} /> Supprimer
                          </button>
                          {activeTab === 'DOUBLONS_PROBABLES' && (
                            <button className="btn btn-primary" onClick={() => openGuide(sourceCard.noms)}>
                              Assistant
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {/* La pagination porte sur des groupes de doublons (pas des paires individuelles) :
                  un groupe de 3+ doublons peut produire plus de paires que d'éléments paginés,
                  donc on affiche le compte réel de cette page plutôt qu'un intervalle calculé. */}
              {records.length} paire(s) affichée(s) sur cette page — {totalItems} au total
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-secondary" disabled={currentPage === 1 || isLoading || isFetchingQuery} onClick={() => setCurrentPage(p => p - 1)}>Précédent</button>
              <PaginationInput 
                currentPage={currentPage} 
                totalPages={totalPages} 
                onPageChange={setCurrentPage}
                disabled={isLoading || isFetchingQuery}
              />
              <button className="btn btn-secondary" disabled={currentPage === totalPages || isLoading || isFetchingQuery} onClick={() => setCurrentPage(p => p + 1)}>Suivant</button>
            </div>
          </div>
        )}
      </div>

      {/* Modale de fusion */}
      {mergeModal && mergeModal.isOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="premium-card animate-scale-in" style={{ width: 500, padding: 32, borderRadius: 24, border: '1px solid rgba(255,215,0,0.2)', background: '#111' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,215,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffd700' }}>
                <GitMerge size={24} />
              </div>
              <h3 style={{ margin: 0, fontSize: 20, color: 'white' }}>Fusion de Cartes</h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14, lineHeight: 1.5 }}>
              La carte cible recevra les informations manquantes (N° Sécu, Rangement) de la carte source. La carte source sera ensuite supprimée.
            </p>
            <div style={{ background: 'rgba(46,213,115,0.05)', border: '1px solid rgba(46,213,115,0.2)', padding: 16, borderRadius: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#2ed573', fontWeight: 700, marginBottom: 4 }}>CIBLE (Conservée)</div>
              <div style={{ color: 'white', fontWeight: 600 }}>{mergeModal.target.noms} {mergeModal.target.prenoms}</div>
            </div>
            <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', padding: 16, borderRadius: 12, marginBottom: 32 }}>
              <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>SOURCE (Supprimée)</div>
              <div style={{ color: 'white', fontWeight: 600 }}>{mergeModal.source.noms} {mergeModal.source.prenoms}</div>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setMergeModal(null)} disabled={isMerging} style={{ padding: '12px 24px', borderRadius: 12 }}>Annuler</button>
              <button className="btn-plein-soleil" onClick={executeMerge} disabled={isMerging} style={{ padding: '12px 24px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8, opacity: isMerging ? 0.7 : 1, cursor: isMerging ? 'not-allowed' : 'pointer' }}>
                <GitMerge size={18} /> {isMerging ? 'Fusion en cours...' : 'Confirmer la fusion'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale de suppression */}
      {deleteModal && deleteModal.isOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="premium-card animate-scale-in" style={{ width: 400, padding: 32, borderRadius: 24, border: '1px solid rgba(239,68,68,0.3)', background: '#111' }}>
            <h3 style={{ margin: '0 0 16px 0', color: 'white', display: 'flex', alignItems: 'center', gap: 12 }}>
              <AlertTriangle color="#ef4444" />
              Supprimer le doublon
            </h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24, lineHeight: 1.5 }}>
              Êtes-vous sûr de vouloir supprimer définitivement <strong>{deleteModal.cardName}</strong> ? Cette action est irréversible.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => setDeleteModal(null)} disabled={isDeleting}>Annuler</button>
              <button className="btn btn-primary" onClick={executeDelete} disabled={isDeleting} style={{ background: '#ef4444', color: 'white', border: 'none' }}>
                {isDeleting ? 'Suppression...' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
