import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, AlertCircle, RefreshCw, Filter, ChevronDown, ChevronUp, Info, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../stores/authStore';
import { useQualityUIStore } from '../../../stores/qualityUIStore';
import { confirmService } from '../../../components/confirmService';
import { PaginationInput } from '../../../components/PaginationInput';
import { ExpandedAnomalyDetails } from '../../../components/Quality/ExpandedAnomalyDetails';

export default function AnomaliesBrutesView() {
  const { user, activeSiteId } = useAuthStore();
  const siteIdToUse = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? 1;
  const { isFetchingQuery, setIsFetchingQuery } = useQualityUIStore();

  const [records, setRecords] = useState<any[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [showOnlyEmpty, setShowOnlyEmpty] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [isDeletingRow, setIsDeletingRow] = useState<Record<number, boolean>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const itemsPerPage = 50;

  const loadAnomalies = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    setIsFetchingQuery(true);
    try {
      const offset = (currentPage - 1) * itemsPerPage;
      // Pour l'instant on récupère tout et on filtre en local ou on affiche tout.
      // Idéalement, getAnomalies pourrait prendre un filtre, mais vu que la limite est 50,
      // on affiche les anomalies telles quelles.
      const res = await window.api.import.getAnomalies(siteIdToUse, offset, itemsPerPage);
      setRecords(res?.rows || []);
      setTotalItems(res?.total || 0);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du chargement des anomalies.');
    } finally {
      setIsLoading(false);
      setIsFetchingQuery(false);
    }
  }, [siteIdToUse, currentPage, setIsFetchingQuery]);

  useEffect(() => {
    loadAnomalies();
    setExpandedId(null);
  }, [loadAnomalies]);

  const isEmptyRow = (row: any) => {
    if (!row) return true;
    const noms = String(row?.noms || '').trim();
    const prenoms = String(row?.prenoms || '').trim();
    const ddn = String(row?.date_de_naissance || '').trim();
    return !noms && !prenoms && !ddn;
  };

  const displayedRecords = showOnlyEmpty ? (records || []).filter(isEmptyRow) : (records || []);
  const totalPages = Math.ceil(totalItems / itemsPerPage);

  const handleDeleteRow = async (id: number) => {
    try {
      setIsDeletingRow(prev => ({ ...prev, [id]: true }));
      await window.api.import.deleteAnomaly(id);
      toast.success('Anomalie supprimée.');
      loadAnomalies();
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de la suppression.');
    } finally {
      setIsDeletingRow(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleDeleteAllEmpty = async () => {
    try {
      setIsDeletingAll(true);
      const count = await window.api.import.countEmptyAnomalies(siteIdToUse);
      if (count === 0) {
        toast.error('Aucune ligne vide trouvée.');
        setIsDeletingAll(false);
        return;
      }

      const confirmMessage = `Cette action supprimera définitivement ${count} lignes vides. Continuer ?`;
      const isConfirmed = await confirmService.confirm({
        title: 'Confirmation de suppression',
        message: confirmMessage,
        isDanger: true
      });

      if (!isConfirmed) {
        setIsDeletingAll(false);
        return;
      }

      await window.api.import.deleteEmptyAnomalies(siteIdToUse);
      toast.success(`${count} lignes supprimées avec succès.`);
      loadAnomalies();
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de la suppression globale.');
    } finally {
      setIsDeletingAll(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: 'white', margin: 0 }}>Autres anomalies</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Nettoyez les rejets d'importation, notamment les lignes fantômes et les autres erreurs.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button 
            onClick={() => setShowOnlyEmpty(!showOnlyEmpty)}
            className={`btn ${showOnlyEmpty ? 'btn-primary' : 'btn-secondary'}`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, height: 36 }}
          >
            <Filter size={16} /> 
            {showOnlyEmpty ? 'Afficher tout' : 'Afficher uniquement lignes vides'}
          </button>
          
          <button 
            onClick={handleDeleteAllEmpty}
            disabled={isDeletingAll}
            className="btn btn-danger"
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, height: 36 }}
          >
            {isDeletingAll ? <RefreshCw size={16} className="spin" /> : <Trash2 size={16} />}
            Supprimer toutes les lignes vides
          </button>
        </div>
      </div>

      <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="table-responsive">
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Noms & Prénoms</th>
                <th>Date de naissance</th>
                <th>Contact</th>
                <th>Message d'erreur</th>
                <th>État</th>
                <th style={{ textAlign: 'right', paddingRight: 20 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px' }} />
                    Chargement...
                  </td>
                </tr>
              ) : displayedRecords.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                    Aucune anomalie trouvée.
                  </td>
                </tr>
              ) : (
                (displayedRecords || []).map((row, index) => {
                  if (!row) return null;
                  const empty = isEmptyRow(row);
                  return (
                  <React.Fragment key={row?.id || index}>
                    <tr
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', background: expandedId === row?.id ? 'rgba(255,255,255,0.02)' : 'transparent', transition: 'background 0.2s' }}
                      onClick={() => row?.id && setExpandedId(expandedId === row.id ? null : row.id)}
                    >
                      <td style={{ paddingLeft: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {row?.id && (expandedId === row.id ? <ChevronUp size={18} color="var(--text-muted)" /> : <ChevronDown size={18} color="var(--text-muted)" />)}
                          <div>
                            <div style={{ fontWeight: 600, color: 'white' }}>{row?.noms || '-'} {row?.prenoms || '-'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Num Sécu: {row?.num_secu || '-'}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{row?.date_de_naissance || '-'}</span>
                      </td>
                      <td>
                        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{row?.contact || '-'}</span>
                      </td>
                      <td>
                        <span style={{ color: '#ff7675', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <AlertCircle size={14} />
                          {row?.erreur_message || row?.type_anomalie || 'Erreur'}
                        </span>
                      </td>
                      <td>
                        {empty ? (
                          <span style={{ 
                            background: 'rgba(236,72,153,0.1)', 
                            color: '#ec4899', 
                            padding: '4px 8px', 
                            borderRadius: 6, 
                            fontSize: 11, 
                            fontWeight: 600 
                          }}>
                            Ligne vide
                          </span>
                        ) : (
                          <span style={{ 
                            background: 'rgba(255,255,255,0.05)', 
                            color: 'var(--text-muted)', 
                            padding: '4px 8px', 
                            borderRadius: 6, 
                            fontSize: 11, 
                            fontWeight: 600 
                          }}>
                            Contient données
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', paddingRight: 20 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteRow(row?.id); }}
                            disabled={row?.id ? isDeletingRow[row.id] : false}
                            style={{
                              background: 'rgba(255,118,117,0.1)',
                              border: 'none',
                              color: '#ff7675',
                              padding: '6px 12px',
                              borderRadius: 6,
                              cursor: 'pointer',
                              fontSize: 12,
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 6
                            }}
                          >
                            {(row?.id && isDeletingRow[row.id]) ? <RefreshCw size={14} className="spin" /> : <Trash2 size={14} />}
                            Supprimer
                          </button>
                      </td>
                    </tr>
                    {expandedId === row?.id && row?.id && !empty && (
                      <tr>
                        <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <ExpandedAnomalyDetails
                            record={row}
                            isResolving={false}
                            onSaveField={async (field, value) => {
                              try {
                                await window.api.import.updateAnomalyField(row.id, field, value);
                                toast.success('Champ modifié avec succès.');
                                loadAnomalies();
                              } catch (err) {
                                console.error(err);
                                toast.error('Erreur lors de la modification.');
                              }
                            }}
                            colorTheme={row?.type_anomalie === 'STATUT_INCONNU' ? "#f59e0b" : "#ff6348"}
                            onForceStock={row?.type_anomalie === 'STATUT_INCONNU' ? () => handleDeleteRow(row?.id) : undefined}
                            isDeleting={row?.id ? isDeletingRow[row.id] : false}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Affichage {((currentPage - 1) * itemsPerPage) + 1} à {Math.min(currentPage * itemsPerPage, totalItems)} sur {totalItems}
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
    </div>
  );
}
