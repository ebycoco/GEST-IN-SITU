import React, { useState, useEffect, useCallback } from 'react';
import { Search, Calendar, Edit3, Save, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../../stores/authStore';
import DateInput from '../../../components/DateInput';

export default function InvalidFormatView() {
  const { user, activeSiteId } = useAuthStore();
  const siteIdToUse = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? 1;

  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [records, setRecords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Édition en ligne
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isResolving, setIsResolving] = useState<Record<number, boolean>>({});

  const itemsPerPage = 10;

  const loadTabData = useCallback(async () => {
    setIsLoading(true);
    try {
      const offset = (currentPage - 1) * itemsPerPage;
      const raw = await window.api.import.getAnomalies(siteIdToUse);
      
      // Filtre uniquement les anomalies de type "DATES_INVALIDES" ou on fait confiance à l'API backend si elle renvoie tout.
      // (D'après QualiteAssainissementPage, on filtrait tout sur getAnomalies)
      const mapped = (raw || []).map((r: any) => ({ ...r, id_carte: r.id }));
      const filtered = mapped.filter((r: any) =>
        `${r.noms} ${r.prenoms}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.num_secu && r.num_secu.includes(searchQuery)) ||
        (r.rangement && r.rangement.toLowerCase().includes(searchQuery.toLowerCase()))
      );
      
      setRecords(filtered.slice(offset, offset + itemsPerPage));
      setTotalItems(filtered.length);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du chargement des données.');
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, searchQuery, siteIdToUse]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  // Réinitialiser la page sur changement de recherche
  useEffect(() => {
    setCurrentPage(1);
    setEditingId(null);
  }, [searchQuery]);

  const handleSaveDate = async (card: any) => {
    if (editValue.length !== 10) { toast.error('Format de date invalide (JJ/MM/AAAA)'); return; }
    
    try {
      setIsResolving(prev => ({ ...prev, [card.id_carte]: true }));
      await window.api.qualite.corrigerFormat({
        id_carte: card.id_carte,
        champ_corrige: 'date_de_naissance',
        valeur_avant: card.date_de_naissance || '(Vide)',
        valeur_apres: editValue
      });
      toast.success('Date de naissance corrigée !');
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

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'white', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Calendar color="#ff6348" /> 
          Correction des Dates Invalides
        </h2>
      </div>

      <div style={{ position: 'relative', width: 300 }}>
        <Search size={16} style={{ position: 'absolute', left: 12, top: 10, color: 'var(--text-muted)' }} />
        <input 
          type="text" 
          placeholder="Rechercher..." 
          className="form-input" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '100%', paddingLeft: 36, height: 36, borderRadius: 10, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)' }}
        />
      </div>

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
                  <tr key={r.id_carte} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ paddingLeft: 20 }}>
                      <strong>{r.noms} {r.prenoms}</strong><br />
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sécu: {r.num_secu || 'N/A'}</span>
                      {r.erreur_message && (
                        <div style={{ fontSize: 11, color: '#ff7675', marginTop: 4, fontWeight: 500 }}>
                          ⚠️ {r.erreur_message}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ color: '#ff6348', fontWeight: 600, background: 'rgba(255,99,72,0.1)', padding: '4px 8px', borderRadius: 6 }}>
                        {r.date_de_naissance || '(Vide)'}
                      </span>
                    </td>
                    <td>
                      {editingId === r.id_carte ? (
                        <DateInput value={editValue} onChange={setEditValue} autoFocus disabled={isResolving[r.id_carte]} />
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 13 }}>Modification requise</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', paddingRight: 20 }}>
                      {editingId === r.id_carte ? (
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button className="btn btn-primary" onClick={() => handleSaveDate(r)} disabled={isResolving[r.id_carte]}>
                            {isResolving[r.id_carte] ? <RefreshCw size={14} className="animate-spin" /> : <Save size={16} />}
                          </button>
                          <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Annuler</button>
                        </div>
                      ) : (
                        <button className="btn btn-secondary" onClick={() => { setEditingId(r.id_carte); setEditValue(r.date_de_naissance || ''); }}>
                          <Edit3 size={14} style={{ marginRight: 6 }} /> Corriger
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
              <span style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: 6, fontSize: 13 }}>{currentPage} / {totalPages}</span>
              <button className="btn btn-secondary" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>Suivant</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
