import React, { useEffect, useState, useCallback } from 'react';
import { Search, RefreshCw, Database, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';

export default function TableCartesPage() {
  const [cartes, setCartes] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  const user = useAuthStore(state => state.user);
  const activeSiteId = useAuthStore(state => state.activeSiteId);

  const loadData = useCallback(async (currentOffset = 0, currentLimit = limit, query = searchQuery) => {
    setLoading(true);
    try {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const filters: any = {};
      
      if (siteIdToUse) filters.site_id = siteIdToUse.toString();
      if (query) filters.q = query;

      const data = await window.api.cartes.getPage(currentOffset, currentLimit, filters);
      
      setCartes(data.rows);
      setTotal(data.total);
      setOffset(currentOffset);
      setLimit(currentLimit);
    } catch (e) {
      console.error(e);
      toast.error("Erreur de chargement de la table des cartes");
    } finally {
      setLoading(false);
    }
  }, [user, activeSiteId, limit, searchQuery]);

  useEffect(() => {
    loadData(0);
    const handleDataUpdated = () => loadData(0);
    window.addEventListener('app:data-updated', handleDataUpdated);
    return () => window.removeEventListener('app:data-updated', handleDataUpdated);
  }, [loadData]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const executeSearch = () => {
    loadData(0, limit, searchQuery);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeSearch();
    }
  };

  const columns = [
    { key: 'id_carte', label: 'ID', width: 70 },
    { key: 'site_id', label: 'SITE ID', width: 80 },
    { key: 'centre_id', label: 'CENTRE ID', width: 90 },
    { key: 'poste_id', label: 'POSTE ID', width: 80 },
    { key: 'noms', label: 'NOMS', width: 150 },
    { key: 'prenoms', label: 'PRENOMS', width: 200 },
    { key: 'date_de_naissance', label: 'DATE NAISSANCE', width: 120 },
    { key: 'lieu_de_naissance', label: 'LIEU NAISSANCE', width: 150 },
    { key: 'num_secu', label: 'NUM SECU', width: 130 },
    { key: 'contact', label: 'CONTACT', width: 120 },
    { key: 'lieu_enrolement', label: 'LIEU ENROLEMENT', width: 150 },
    { key: 'rangement', label: 'RANGEMENT', width: 120 },
    { key: 'statut', label: 'STATUT', width: 120 },
    { key: 'statut_physique', label: 'STATUT PHYSIQUE', width: 130 },
    { key: 'date_delivrance', label: 'DATE DELIVRANCE', width: 130 },
    { key: 'nom_retirant', label: 'NOM RETIRANT', width: 150 },
    { key: 'num_retirant', label: 'NUM RETIRANT', width: 130 },
    { key: 'agent_distributeur', label: 'AGENT DISTRIB.', width: 150 },
    { key: 'centre_retrait', label: 'CENTRE RETRAIT', width: 150 },
    { key: 'agent_saisie', label: 'AGENT SAISIE', width: 150 },
    { key: 'created_by', label: 'CREATED BY', width: 100 },
    { key: 'agent_signalement_absence', label: 'AGENT SIGNAL. ABSENCE', width: 180 },
    { key: 'date_signalement_absence', label: 'DATE SIGNAL. ABSENCE', width: 170 },
    { key: 'note_signalement_absence', label: 'NOTE SIGNAL. ABSENCE', width: 200 },
    { key: 'escalade_niveau', label: 'ESCALADE NIVEAU', width: 130 },
    { key: 'agent_resolution_absence', label: 'AGENT RESOL. ABSENCE', width: 180 },
    { key: 'date_resolution_absence', label: 'DATE RESOL. ABSENCE', width: 160 },
    { key: 'note_resolution', label: 'NOTE RESOLUTION', width: 200 },
    { key: 'cle_doublon', label: 'CLE DOUBLON', width: 200 },
    { key: 'cle_doublon_flex', label: 'CLE DOUBLON FLEX', width: 200 },
    { key: 'has_invalid_date', label: 'INVALID DATE', width: 120 },
    { key: 'notif_lue', label: 'NOTIF LUE', width: 90 },
    { key: 'qr_code_data', label: 'QR CODE DATA', width: 150 },
    { key: 'sync_id', label: 'SYNC ID', width: 280 },
    { key: 'is_dirty', label: 'IS DIRTY', width: 90 },
    { key: 'synced_at', label: 'SYNCED AT', width: 150 },
    { key: 'created_at', label: 'CREATED AT', width: 150 },
    { key: 'updated_at', label: 'UPDATED AT', width: 150 },
  ];

  return (
    <div className="page-content animate-fade-in" style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 24, height: '100vh', overflow: 'hidden' }}>
      
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Database size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: 'white', letterSpacing: '-0.02em', margin: 0 }}>Table des Cartes</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 500, margin: '2px 0 0 0' }}>
              Vue technique complète de la base de données (t_cartes)
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={16} style={{ position: 'absolute', left: 16, color: 'var(--text-muted)', opacity: 0.6 }} />
            <input 
              className="form-input" 
              style={{ 
                width: 300, paddingLeft: 44, paddingRight: 16, borderRadius: 12, 
                background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', 
                height: 42, fontSize: 13, color: 'white', transition: 'border-color 0.2s ease-in-out'
              }}
              placeholder="Rechercher (nom, prénom, sécu, contact...)"
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleKeyDown}
            />
          </div>
          <button 
            className="btn btn-primary" 
            style={{ 
              borderRadius: 12, padding: '0 20px', height: 42, 
              background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
              color: 'white', border: 'none', fontWeight: 700, fontSize: 13,
              cursor: 'pointer'
            }}
            onClick={executeSearch}
          >
            Filtrer
          </button>
          <button 
            className="btn btn-outline" 
            style={{ 
              borderRadius: 12, width: 42, height: 42, padding: 0, justifyContent: 'center',
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
              color: 'white', cursor: 'pointer'
            }} 
            onClick={() => loadData(offset, limit, searchQuery)}
            title="Rafraîchir"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Container principal du tableau */}
      <div className="premium-glass" style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column',
        borderRadius: 16, 
        border: '1px solid rgba(255,255,255,0.05)', 
        overflow: 'hidden',
        background: 'rgba(0,0,0,0.2)'
      }}>
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }} className="custom-scrollbar">
          <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgba(30, 41, 59, 0.95)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <tr>
                {columns.map((col) => (
                  <th key={col.key} style={{ 
                    padding: '12px 16px', 
                    fontSize: 11, 
                    fontWeight: 800, 
                    color: 'var(--text-muted)', 
                    textTransform: 'uppercase', 
                    letterSpacing: '0.05em',
                    whiteSpace: 'nowrap',
                    minWidth: col.width
                  }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && cartes.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} style={{ padding: '60px 0', textAlign: 'center' }}>
                    <RefreshCw size={32} className="animate-spin" style={{ color: '#8b5cf6', margin: '0 auto 16px' }} />
                    <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Chargement des données...</div>
                  </td>
                </tr>
              ) : cartes.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Aucune carte trouvée.
                  </td>
                </tr>
              ) : (
                cartes.map((row, idx) => (
                  <tr key={row.id_carte} className="table-row-hover" style={{ 
                    borderBottom: '1px solid rgba(255,255,255,0.02)',
                    transition: 'background 0.2s',
                    background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'
                  }}>
                    {columns.map((col) => {
                      const value = row[col.key];
                      // Formatage spécifique pour certaines colonnes
                      let displayValue = value;
                      if (value === null || value === undefined) {
                        displayValue = <span style={{ opacity: 0.3 }}>NULL</span>;
                      } else if (typeof value === 'boolean' || col.key === 'has_invalid_date' || col.key === 'notif_lue') {
                        displayValue = value ? '1' : '0';
                      }
                      
                      return (
                        <td key={`${row.id_carte}-${col.key}`} style={{ 
                          padding: '10px 16px', 
                          fontSize: 12, 
                          color: 'rgba(255,255,255,0.85)',
                          whiteSpace: 'nowrap',
                          maxWidth: 300,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontFamily: col.key === 'id_carte' || col.key === 'sync_id' ? 'monospace' : 'inherit'
                        }} title={String(value || '')}>
                          {displayValue}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer Pagination */}
        <div style={{ 
          padding: '14px 24px', 
          background: 'rgba(0,0,0,0.3)', 
          borderTop: '1px solid rgba(255,255,255,0.04)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          fontSize: 13
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ color: 'var(--text-muted)' }}>
              Affichage de <span style={{ color: 'white', fontWeight: 600 }}>{total > 0 ? offset + 1 : 0}</span> à <span style={{ color: 'white', fontWeight: 600 }}>{Math.min(offset + limit, total)}</span> sur <span style={{ color: '#a78bfa', fontWeight: 800 }}>{total.toLocaleString('fr')}</span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Lignes par page :</span>
              <select
                value={limit}
                onChange={(e) => loadData(0, Number(e.target.value))}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  color: 'white',
                  padding: '4px 8px',
                  fontSize: 12,
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value={25} style={{ background: '#1e293b' }}>25</option>
                <option value={50} style={{ background: '#1e293b' }}>50</option>
                <option value={100} style={{ background: '#1e293b' }}>100</option>
                <option value={250} style={{ background: '#1e293b' }}>250</option>
              </select>
            </div>
          </div>
          
          <div style={{ display: 'flex', gap: 8 }}>
            <button 
              className="btn btn-secondary btn-sm" 
              disabled={offset === 0}
              onClick={() => loadData(offset - limit)}
              style={{ 
                width: 34, height: 34, padding: 0, borderRadius: 10, justifyContent: 'center',
                display: 'flex', alignItems: 'center', 
                background: 'rgba(255,255,255,0.05)', color: 'white', border: 'none', cursor: 'pointer',
                opacity: offset === 0 ? 0.4 : 1
              }}
            >
              <ChevronLeft size={16} />
            </button>
            <button 
              className="btn btn-secondary btn-sm" 
              disabled={offset + limit >= total}
              onClick={() => loadData(offset + limit)}
              style={{ 
                width: 34, height: 34, padding: 0, borderRadius: 10, justifyContent: 'center',
                display: 'flex', alignItems: 'center', 
                background: 'rgba(255,255,255,0.05)', color: 'white', border: 'none', cursor: 'pointer',
                opacity: offset + limit >= total ? 0.4 : 1
              }}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
