import React, { useState, useEffect, useCallback } from 'react';
import { Search, Calendar, Edit3, Save, RefreshCw, ChevronDown, ChevronUp, Info, Trash2, Phone, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../stores/authStore';
import DateInput from '../../../components/DateInput';
import { PaginationInput } from '../../../components/PaginationInput';
import { isValidCalendarDate } from '../../../utils/dateValidator';
import { confirmService } from '../../../components/confirmService';
import { useQualityUIStore } from '../../../stores/qualityUIStore';
import { AdvancedSearchBar } from '../../../components/Quality/AdvancedSearchBar';
import { QualityFilters } from '../../../../../shared/types/quality.types';
import { ExpandedAnomalyDetails } from '../../../components/Quality/ExpandedAnomalyDetails';
import { useDebounce } from '../../../hooks/useDebounce';

export default function InvalidFormatView() {
  const { user, activeSiteId } = useAuthStore();
  const siteIdToUse = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? 1;

  const [filters, setFilters] = useState<QualityFilters>({});
  const debouncedFilters = useDebounce(filters, 500);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Édition en ligne — Date de naissance
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isResolving, setIsResolving] = useState<Record<number, boolean>>({});

  const { refreshTrigger, openCorrection, isFetchingQuery, setIsFetchingQuery } = useQualityUIStore();

  const itemsPerPage = 10;

  const loadTabData = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    setIsFetchingQuery(true);
    try {
      const offset = (currentPage - 1) * itemsPerPage;
      const query = debouncedFilters.nom || '';
      // ✔️ Pagination côté serveur via table unifiée
      const res = await window.api.cartes.getInvalidDates(siteIdToUse, offset, itemsPerPage, query);
      const allRows: any[] = res?.rows || [];

      setRecords(allRows);
      setTotalItems(res?.total || 0);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du chargement des données.');
    } finally {
      setIsLoading(false);
      setIsFetchingQuery(false);
    }
  }, [currentPage, debouncedFilters.nom, siteIdToUse, refreshTrigger, setIsFetchingQuery]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  // Réinitialiser la page sur changement de recherche
  useEffect(() => {
    setCurrentPage(1);
    setEditingId(null);
    setExpandedId(null);
  }, [debouncedFilters]);

  const handleSaveDate = async (card: any) => {
    if (editValue.length !== 10) { toast.error('Format de date invalide (JJ/MM/AAAA)'); return; }
    if (!isValidCalendarDate(editValue)) {
      toast.error('Date physiquement impossible dans le calendrier (ex: 30/02 ou 31/04). Veuillez saisir une date correcte.');
      return;
    }
    
    try {
      window.api.log.info(`[QUALITÉ] Tentative de correction de date pour la carte ID=${card.id_carte}`);
      setIsResolving(prev => ({ ...prev, [card.id_carte]: true }));
      await window.api.qualite.corrigerFormat({
        id_carte: card.id_carte,
        champ_corrige: 'date_de_naissance',
        valeur_avant: card.date_de_naissance || '(Vide)',
        valeur_apres: editValue
      });
      window.api.log.info(`[QUALITÉ] Succès : Correction de date terminée pour ID=${card.id_carte}`);
      toast.success('Date de naissance corrigée !');
      setEditingId(null);
      loadTabData();
    } catch (err) {
      window.api.log.error(`[QUALITÉ] ERREUR fatale lors de la correction de date pour ID=${card.id_carte} : ${err}`);
      console.error(err);
      toast.error('Erreur lors de la mise à jour.');
    } finally {
      setIsResolving(prev => ({ ...prev, [card.id_carte]: false }));
    }
  };

  const handleSaveContactLieu = async (card: any, champ: string, valeur: string) => {
    if (!valeur.trim()) { toast.error('La valeur ne peut pas être vide.'); return; }
    if (champ === 'contact') {
      const digits = valeur.replace(/\D/g, '');
      if (digits.length !== 10) {
        toast.error('Le contact doit faire exactement 10 chiffres locaux (ex: 0708090010).');
        return;
      }
    }
    if (champ === 'date_de_naissance') {
      if (valeur.length !== 10) { toast.error('Format de date invalide (JJ/MM/AAAA)'); return; }
      if (!isValidCalendarDate(valeur)) {
        toast.error('Date physiquement impossible dans le calendrier (ex: 30/02 ou 31/04). Veuillez saisir une date correcte.');
        return;
      }
    }
    try {
      setIsResolving(prev => ({ ...prev, [card.id_carte]: true }));
      window.api.log.info(`[QUALITÉ] Correction du champ '${champ}' pour anomalie ID=${card.id_carte}`);
      await window.api.qualite.corrigerFormat({
        id_carte: card.id_carte,
        champ_corrige: champ,
        valeur_avant: card[champ] || '(Vide)',
        valeur_apres: champ === 'contact' ? valeur.replace(/\D/g, '') : champ === 'date_de_naissance' ? valeur : valeur.trim().toUpperCase()
      });
      window.api.log.info(`[QUALITÉ] Succès correction '${champ}' pour ID=${card.id_carte}`);
      
      let label = champ;
      if (champ === 'contact') label = 'Contact';
      else if (champ === 'lieu_de_naissance') label = 'Lieu de naissance';
      else if (champ === 'num_secu') label = 'Numéro de Sécurité Sociale';
      else if (champ === 'date_de_naissance') label = 'Date de naissance';
      else if (champ === 'noms') label = 'Noms';
      else if (champ === 'prenoms') label = 'Prénoms';
      
      toast.success(`${label} corrigé avec succès !`);
      
      loadTabData();
    } catch (err: any) {
      window.api.log.error(`[QUALITÉ] ERREUR correction '${champ}' pour ID=${card.id_carte} : ${err}`);
      toast.error('Erreur lors de la mise à jour.');
    } finally {
      setIsResolving(prev => ({ ...prev, [card.id_carte]: false }));
    }
  };

  const executeDelete = async (id: number) => {
    const confirmed = await confirmService.confirm({
      title: "Supprimer l'anomalie",
      message: 'Êtes-vous sûr de vouloir supprimer cette anomalie ? Cette action est irréversible.',
      isDanger: true,
      actionName: 'Supprimer'
    });
    if (!confirmed) return;
    
    try {
      setIsResolving(prev => ({ ...prev, [id]: true }));
      window.api.log.info(`[QUALITÉ] Suppression de l'anomalie ID=${id} par l'opérateur`);
      await window.api.import.deleteAnomaly(id);
      toast.success('Anomalie supprimée avec succès.');
      setExpandedId(null);
      loadTabData();
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de la suppression de l'anomalie.");
    } finally {
      setIsResolving(prev => ({ ...prev, [id]: false }));
    }
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'white', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar color="#ff6348" /> 
          Correction des Dates Invalides ou Absentes
        </h2>
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
                <th>Date actuelle</th>
                <th>Nouvelle date (JJ/MM/AAAA)</th>
                <th style={{ textAlign: 'right', paddingRight: 20 }}>Actions</th>
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
                    Aucune date invalide trouvée.
                  </td>
                </tr>
              ) : (
                records.map(r => (
                  <React.Fragment key={r.id_carte}>
                    <tr 
                      style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', background: expandedId === r.id_carte ? 'rgba(255,255,255,0.02)' : 'transparent', transition: 'background 0.2s' }}
                      onClick={() => setExpandedId(expandedId === r.id_carte ? null : r.id_carte)}
                    >
                      <td style={{ paddingLeft: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          {expandedId === r.id_carte ? <ChevronUp size={18} color="var(--text-muted)" /> : <ChevronDown size={18} color="var(--text-muted)" />}
                          <div>
                            <strong>{r.noms} {r.prenoms}</strong>
                            {expandedId !== r.id_carte && (
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                                Cliquez pour voir les détails
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span style={{ color: '#ff6348', fontWeight: 600, background: 'rgba(255,99,72,0.1)', padding: '4px 8px', borderRadius: 6 }}>
                          {r.date_de_naissance || '(Vide)'}
                        </span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {editingId === r.id_carte ? (
                          <DateInput value={editValue} onChange={setEditValue} autoFocus disabled={isResolving[r.id_carte]} />
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 13 }}>Modification requise</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', paddingRight: 20 }} onClick={(e) => e.stopPropagation()}>
                        {editingId === r.id_carte ? (
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn btn-primary" onClick={() => handleSaveDate(r)} disabled={isResolving[r.id_carte]}>
                              {isResolving[r.id_carte] ? <RefreshCw size={14} className="animate-spin" /> : <Save size={16} />}
                            </button>
                            <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Annuler</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === r.id_carte ? null : r.id_carte); }} title="Détails" style={{ padding: '6px 10px' }}>
                              <Info size={14} />
                            </button>
                            <button className="btn btn-primary" onClick={() => openCorrection(r, 'date_de_naissance')}>
                              <Edit3 size={14} style={{ marginRight: 6 }} /> Corriger
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {expandedId === r.id_carte && (
                      <tr>
                        <td colSpan={4} style={{ padding: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <ExpandedAnomalyDetails
                            record={r}
                            isResolving={isResolving[r.id_carte] || false}
                            onSaveField={(field, value) => handleSaveContactLieu(r, field, value)}
                            colorTheme="#ff6348"
                          />
                          {r.erreur_message && (
                            <div style={{ padding: '0 20px 20px 50px', background: 'rgba(0,0,0,0.15)', borderLeft: '3px solid #ff6348' }}>
                              <div style={{ padding: '10px 14px', background: 'rgba(255, 118, 117, 0.08)', borderRadius: 8, border: '1px solid rgba(255, 118, 117, 0.3)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <strong style={{ color: '#ff7675', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    ⚠️ Raison du blocage
                                  </strong>
                                  <div style={{ color: '#ff7675', fontSize: 13, marginTop: 4 }}>{r.erreur_message}</div>
                                </div>
                                <button 
                                  className="btn btn-secondary" 
                                  onClick={(e) => { e.stopPropagation(); executeDelete(r.id_carte); }}
                                  disabled={isResolving[r.id_carte]}
                                  style={{ border: '1px solid rgba(255, 118, 117, 0.5)', color: '#ff7675', background: 'rgba(255, 118, 117, 0.1)', padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
                                  title="Supprimer l'anomalie"
                                >
                                  {isResolving[r.id_carte] ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                  Supprimer
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
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
