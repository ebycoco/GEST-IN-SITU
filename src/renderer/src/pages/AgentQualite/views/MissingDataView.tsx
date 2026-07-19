import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, Fingerprint, Package, ShieldAlert, Save, Edit3, RefreshCw, Phone, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../stores/authStore';
import { useQualityUIStore } from '../../../stores/qualityUIStore';
import { AdvancedSearchBar } from '../../../components/Quality/AdvancedSearchBar';
import { PaginationInput } from '../../../components/PaginationInput';
import { QualityFilters } from '../../../../../shared/types/quality.types';

type MissingTab = 'SANS_SECU' | 'SANS_RANGEMENT' | 'SANS_NOM' | 'SANS_PRENOM' | 'SANS_CONTACT' | 'SANS_LIEU';

export default function MissingDataView() {
  const { user, activeSiteId } = useAuthStore();
  const siteIdToUse = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? 1;

  const [activeTab, setActiveTab] = useState<MissingTab>('SANS_SECU');
  const [filters, setFilters] = useState<QualityFilters>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [records, setRecords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Édition en ligne
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isResolving, setIsResolving] = useState<Record<number, boolean>>({});

  const { refreshTrigger } = useQualityUIStore();

  const itemsPerPage = 10;

  const loadTabData = useCallback(async () => {
    setIsLoading(true);
    try {
      const offset = (currentPage - 1) * itemsPerPage;
      let res;
      if (activeTab === 'SANS_SECU') {
        res = await window.api.cartes.getSansNumSecuPage(siteIdToUse, offset, itemsPerPage, filters.nom || '');
      } else if (activeTab === 'SANS_NOM') {
        res = await window.api.cartes.getSansNomPage(siteIdToUse, offset, itemsPerPage, filters.nom || '');
      } else if (activeTab === 'SANS_PRENOM') {
        res = await window.api.cartes.getSansPrenomPage(siteIdToUse, offset, itemsPerPage, filters.nom || '');
      } else if (activeTab === 'SANS_CONTACT') {
        res = await window.api.cartes.getSansContactPage(siteIdToUse, offset, itemsPerPage, filters.nom || '');
      } else if (activeTab === 'SANS_LIEU') {
        res = await window.api.cartes.getSansLieuNaissancePage(siteIdToUse, offset, itemsPerPage, filters.nom || '');
      } else {
        res = await window.api.cartes.getSansRangementPage(siteIdToUse, offset, itemsPerPage, filters.nom || '');
      }
      setRecords(res?.rows || []);
      setTotalItems(res?.total || 0);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du chargement des données.');
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, currentPage, filters.nom, siteIdToUse, refreshTrigger]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  // Réinitialiser la page sur changement
  useEffect(() => {
    setCurrentPage(1);
    setEditingId(null);
  }, [filters, activeTab]);

  const handleSaveField = async (card: any, field: 'num_secu' | 'rangement' | 'noms' | 'prenoms' | 'contact' | 'lieu_de_naissance') => {
    if (!editValue.trim()) { toast.error('La valeur ne peut pas être vide.'); return; }
    if (field === 'num_secu' && editValue.trim().length !== 13) { toast.error('Le numéro de sécurité sociale doit faire exactement 13 chiffres.'); return; }
    if (field === 'contact') {
      const digits = editValue.replace(/\D/g, '');
      if (digits.length !== 10) {
        toast.error('Le contact doit faire exactement 10 chiffres locaux (ex: 0708090010).');
        return;
      }
    }

    try {
      setIsResolving(prev => ({ ...prev, [card.id_carte]: true }));
      await window.api.qualite.corrigerFormat({
        id_carte: card.id_carte,
        champ_corrige: field,
        valeur_avant: card[field] || '(Vide)',
        valeur_apres: field === 'contact' ? editValue.replace(/\D/g, '') : editValue.trim().toUpperCase()
      });
      toast.success('Donnée mise à jour avec succès !');
      setEditingId(null);
      loadTabData();
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de la mise à jour.');
    } finally {
      setIsResolving(prev => ({ ...prev, [card.id_carte]: false }));
    }
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  // Configuration par onglet
  const tabConfig: Record<MissingTab, {
    fieldName: 'num_secu' | 'rangement' | 'noms' | 'prenoms' | 'contact' | 'lieu_de_naissance';
    placeholder: string;
    maxLength: number;
    inputMode?: 'numeric' | 'text';
    columnLabel: string;
    emptyLabel: string;
  }> = {
    SANS_SECU:       { fieldName: 'num_secu',          placeholder: 'Ex: 1234567890123', maxLength: 13, inputMode: 'numeric', columnLabel: 'N° Sécurité (13 chiffres)',  emptyLabel: 'Manquant' },
    SANS_RANGEMENT:  { fieldName: 'rangement',          placeholder: 'Ex: AB123',         maxLength: 20, inputMode: 'text',    columnLabel: 'Emplacement (ex: KM102)',    emptyLabel: 'Non classé' },
    SANS_NOM:        { fieldName: 'noms',               placeholder: 'Saisir le nom',     maxLength: 100, inputMode: 'text',   columnLabel: 'Saisie Nom',                emptyLabel: 'Manquant' },
    SANS_PRENOM:     { fieldName: 'prenoms',            placeholder: 'Saisir les prénoms',maxLength: 100, inputMode: 'text',   columnLabel: 'Saisie Prénom',             emptyLabel: 'Manquant' },
    SANS_CONTACT:    { fieldName: 'contact',            placeholder: 'Ex: 0708090010',    maxLength: 10,  inputMode: 'numeric', columnLabel: 'Contact (10 chiffres CI)',  emptyLabel: 'Manquant' },
    SANS_LIEU:       { fieldName: 'lieu_de_naissance',  placeholder: 'Ex: ABIDJAN',       maxLength: 100, inputMode: 'text',   columnLabel: 'Lieu de naissance',         emptyLabel: 'Manquant' },
  };

  const cfg = tabConfig[activeTab];

  const tabStyle = (tab: MissingTab, activeColor: string, activeBg: string) => ({
    padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none',
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' as const,
    background: activeTab === tab ? activeBg : 'transparent',
    color: activeTab === tab ? activeColor : 'var(--text-muted)'
  });

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'white', margin: 0 }}>Complétion des Données Manquantes</h2>

        <div style={{ display: 'flex', gap: 8, background: 'rgba(255,255,255,0.02)', padding: 4, borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)', overflowX: 'auto' }}>
          <button onClick={() => setActiveTab('SANS_SECU')}    style={tabStyle('SANS_SECU',    '#70a1ff', 'rgba(112,161,255,0.1)')}> <Fingerprint size={14} /> Sans N° Sécu</button>
          <button onClick={() => setActiveTab('SANS_RANGEMENT')} style={tabStyle('SANS_RANGEMENT', '#2ed573', 'rgba(46,213,115,0.1)')}><Package size={14} /> Sans Rangement</button>
          <button onClick={() => setActiveTab('SANS_NOM')}     style={tabStyle('SANS_NOM',     '#ec4899', 'rgba(236,72,153,0.1)')}> <ShieldAlert size={14} /> Sans Nom</button>
          <button onClick={() => setActiveTab('SANS_PRENOM')}  style={tabStyle('SANS_PRENOM',  '#14b8a6', 'rgba(20,184,166,0.1)')}> <ShieldAlert size={14} /> Sans Prénom</button>
          <button onClick={() => setActiveTab('SANS_CONTACT')} style={tabStyle('SANS_CONTACT', '#f59e0b', 'rgba(245,158,11,0.1)')}> <Phone size={14} /> Sans Contact</button>
          <button onClick={() => setActiveTab('SANS_LIEU')}    style={tabStyle('SANS_LIEU',    '#a78bfa', 'rgba(167,139,250,0.1)')}><MapPin size={14} /> Sans Lieu Naiss.</button>
        </div>
      </div>

      <AdvancedSearchBar filters={filters} setFilters={setFilters} />

      <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="table-responsive">
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Assuré / N° Sécu</th>
                <th>Contact</th>
                <th>{cfg.columnLabel}</th>
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
                    ✅ Aucune donnée manquante pour ce critère.
                  </td>
                </tr>
              ) : (
                records.map(r => (
                  <tr key={r.id_carte} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ paddingLeft: 20 }}>
                      <strong>{r.noms || '(Sans Nom)'} {r.prenoms || '(Sans Prénom)'}</strong><br />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sécu: {r.num_secu || '—'}</span>
                    </td>
                    <td><span>{r.contact || '—'}</span></td>
                    <td>
                      {editingId === r.id_carte ? (
                        <input
                          type="text"
                          className="form-input"
                          maxLength={cfg.maxLength}
                          placeholder={cfg.placeholder}
                          inputMode={cfg.inputMode}
                          style={{
                            width: activeTab === 'SANS_SECU' || activeTab === 'SANS_CONTACT' ? 200 : 160,
                            height: 36, background: '#0a0e1a', color: 'white',
                            border: '1px solid var(--border-color)',
                            textTransform: activeTab === 'SANS_CONTACT' ? 'none' : 'uppercase'
                          }}
                          value={editValue}
                          onChange={(e) => {
                            if (activeTab === 'SANS_SECU') {
                              setEditValue(e.target.value.replace(/\D/g, ''));
                            } else if (activeTab === 'SANS_CONTACT') {
                              // Uniquement les chiffres, 10 max (format CI)
                              setEditValue(e.target.value.replace(/\D/g, '').slice(0, 10));
                            } else {
                              setEditValue(e.target.value.toUpperCase());
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic' }}>
                          {cfg.emptyLabel}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', paddingRight: 20 }}>
                      {editingId === r.id_carte ? (
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button className="btn btn-primary" onClick={() => handleSaveField(r, cfg.fieldName)} disabled={isResolving[r.id_carte]}>
                            {isResolving[r.id_carte] ? <RefreshCw size={14} className="animate-spin" /> : <Save size={16} />}
                          </button>
                          <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Annuler</button>
                        </div>
                      ) : (
                        <button className="btn btn-secondary" onClick={() => { setEditingId(r.id_carte); setEditValue(r[cfg.fieldName] || ''); }}>
                          <Edit3 size={14} style={{ marginRight: 6 }} /> Compléter
                        </button>
                      )}
                    </td>
                  </tr>
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
              <button className="btn btn-secondary" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>Précédent</button>
              <PaginationInput 
                currentPage={currentPage} 
                totalPages={totalPages} 
                onPageChange={setCurrentPage} 
              />
              <button className="btn btn-secondary" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>Suivant</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
