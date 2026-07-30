import React, { useState, useEffect, useCallback } from 'react';
import { Search, Edit } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../stores/authStore';
import { useQualityUIStore } from '../../../stores/qualityUIStore';
import { QualityFilters } from '../../../../../shared/types/quality.types';
import { AdvancedSearchBar } from '../../../components/Quality/AdvancedSearchBar';

export default function GlobalSearchView() {
  const { user, activeSiteId } = useAuthStore();
  const siteIdToUse = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? 1;

  const [filters, setFilters] = useState<QualityFilters>({});
  const [records, setRecords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const { refreshTrigger, openCorrection, isFetchingQuery, setIsFetchingQuery } = useQualityUIStore();

  const handleSearch = useCallback(async () => {
    // Ne pas chercher si les filtres sont complètement vides pour éviter une requête lourde
    if (!filters.nom && !filters.contact && !filters.ddn && !filters.lieu) {
      setRecords([]);
      setHasSearched(false);
      return;
    }

    setIsLoading(true);
    setIsFetchingQuery(true);
    setHasSearched(true);
    try {
      // On passe les filtres à l'API. On limite arbitrairement à 50 résultats pour la performance.
      const res = await window.api.cartes.searchAllRecords(siteIdToUse, filters, 50);
      setRecords(res || []);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de la recherche.');
    } finally {
      setIsLoading(false);
      setIsFetchingQuery(false);
    }
  }, [siteIdToUse, filters, setIsFetchingQuery]);

  // Effectuer la recherche automatiquement quand les filtres changent avec un debounce (200ms)
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      handleSearch();
    }, 200);
    return () => clearTimeout(delayDebounceFn);
  }, [filters, handleSearch]);

  // Rafraîchir après une correction
  useEffect(() => {
    if (hasSearched) {
      handleSearch();
    }
  }, [refreshTrigger]);

  const handleModifier = async (record: any) => {
    try {
      const fullRecord = await window.api.cartes.getRecordForCorrection(record.original_id, record.record_type, siteIdToUse);
      if (fullRecord) {
        // Ajouter la propriété _recordType pour aider le panneau de correction si besoin
        fullRecord._recordType = record.record_type;
        openCorrection(fullRecord, record.record_type === 'Valide' ? 'CorrectionGlobale' : 'AnomalieImport');
      } else {
        toast.error('Fiche introuvable ou supprimée.');
      }
    } catch (e) {
      console.error(e);
      toast.error('Erreur lors de la récupération de la fiche complète.');
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <Search size={24} color="var(--accent-orange, #f39c12)" />
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Recherche Universelle</h2>
      </div>
      
      <p style={{ color: 'var(--text-muted)', fontSize: '14px', margin: 0 }}>
        Recherchez simultanément parmi les cartes valides et les anomalies d'importation.
      </p>

      <AdvancedSearchBar filters={filters} setFilters={setFilters} />

      <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="table-responsive">
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Recherche en cours...</div>
        ) : !hasSearched ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            Saisissez des critères de recherche pour commencer.
          </div>
        ) : records.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
            Aucun résultat trouvé pour ces critères.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', color: 'white' }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <th style={{ textAlign: 'left', padding: '16px 20px', fontSize: 13, color: 'var(--text-muted)' }}>Statut / Type</th>
                <th style={{ textAlign: 'left', padding: '16px 0', fontSize: 13, color: 'var(--text-muted)' }}>Noms</th>
                <th style={{ textAlign: 'left', padding: '16px 0', fontSize: 13, color: 'var(--text-muted)' }}>Prénoms</th>
                <th style={{ textAlign: 'left', padding: '16px 0', fontSize: 13, color: 'var(--text-muted)' }}>Date Naiss.</th>
                <th style={{ textAlign: 'left', padding: '16px 0', fontSize: 13, color: 'var(--text-muted)' }}>Contact</th>
                <th style={{ textAlign: 'left', padding: '16px 0', fontSize: 13, color: 'var(--text-muted)' }}>N° Sécu</th>
                <th style={{ textAlign: 'right', padding: '16px 20px', fontSize: 13, color: 'var(--text-muted)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, index) => (
                <tr key={r.virtual_id || index} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ paddingLeft: 20, paddingTop: 12, paddingBottom: 12 }}>
                    {r.record_type === 'Valide' ? (
                      <span className="badge badge-success" style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '8px' }}>🟢 Carte en base</span>
                    ) : (
                      <span className="badge badge-error" style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '8px', background: 'rgba(244, 67, 54, 0.15)', color: '#f44336' }}>🔴 Anomalie à corriger</span>
                    )}
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {r.status_or_anomaly}
                    </div>
                  </td>
                  <td style={{ paddingTop: 12, paddingBottom: 12 }}>
                    <div style={{ fontWeight: 600, color: 'white' }}>{r.noms || '-'}</div>
                  </td>
                  <td style={{ paddingTop: 12, paddingBottom: 12 }}>
                    <div style={{ fontWeight: 600, color: 'white' }}>{r.prenoms || '-'}</div>
                  </td>
                  <td style={{ paddingTop: 12, paddingBottom: 12 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{r.date_de_naissance || '-'}</span>
                  </td>
                  <td style={{ paddingTop: 12, paddingBottom: 12 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{r.contact || '-'}</span>
                  </td>
                  <td style={{ paddingTop: 12, paddingBottom: 12 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{r.num_secu || '-'}</span>
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: 20, paddingTop: 12, paddingBottom: 12 }}>
                    <button
                      className="btn-outline btn-sm"
                      onClick={() => handleModifier(r)}
                      style={{
                        padding: '6px 12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        borderRadius: '6px'
                      }}
                    >
                      <Edit size={14} /> Modifier
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </div>
      </div>
    </div>
  );
}
