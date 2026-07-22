import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Database, Search, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AnomaliesView() {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Search state
  const [searchTerm, setSearchTerm] = useState('');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      if (window.api?.debug?.getAllAnomalies) {
        const rows = await window.api.debug.getAllAnomalies();
        setData(rows || []);
        
        if (rows && rows.length > 0) {
          const cols = Object.keys(rows[0]);
          // Placer les colonnes importantes en premier
          const priorityCols = ['id', 'carte_id', 'type_anomalie', 'description'];
          const otherCols = cols.filter(c => !priorityCols.includes(c));
          setColumns([...priorityCols.filter(c => cols.includes(c)), ...otherCols]);
        } else {
          setColumns([]);
        }
      } else {
        toast.error("L'API d'anomalies n'est pas disponible.");
      }
    } catch (error: any) {
      console.error(error);
      toast.error("Erreur lors du chargement des anomalies.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;
    const lowerSearch = searchTerm.toLowerCase();
    
    return data.filter(row => {
      const searchableValues = [
        row.noms, row.prenoms, row.num_secu, 
        row.lieu_de_naissance, row.lieu_enrolement, 
        row.type_anomalie, row.statut
      ].filter(Boolean).map(String).map(s => s.toLowerCase());
      
      return searchableValues.some(val => val.includes(lowerSearch));
    });
  }, [data, searchTerm]);

  const totalPages = Math.ceil(filteredData.length / rowsPerPage) || 1;
  const currentData = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredData.slice(start, start + rowsPerPage);
  }, [filteredData, currentPage, rowsPerPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, rowsPerPage]);

  const getBadgeStyle = (type: string) => {
    const upperType = String(type).toUpperCase();
    if (upperType.includes('DATE')) return { bg: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: 'rgba(239, 68, 68, 0.2)' };
    if (upperType.includes('DOUBLON')) return { bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.2)' };
    if (upperType.includes('ABSENT') || upperType.includes('MANQUANT') || upperType.includes('SANS')) return { bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', border: 'rgba(59, 130, 246, 0.2)' };
    return { bg: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', border: 'rgba(168, 85, 247, 0.2)' };
  };

  return (
    <div style={{ padding: '32px', height: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <style>{`
        .anomalies-table-row {
          transition: all 0.2s ease;
        }
        .anomalies-table-row:hover {
          background-color: rgba(255, 255, 255, 0.04) !important;
          transform: translateY(-1px);
        }
        .glass-panel {
          background: rgba(255, 255, 255, 0.02);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 16px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }
        .glass-header {
          background: rgba(30, 41, 59, 0.8);
          backdrop-filter: blur(12px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .modern-input {
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          color: white;
          transition: all 0.2s;
        }
        .modern-input:focus {
          outline: none;
          border-color: var(--accent-primary);
          box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
        }
        .badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 10px;
          border-radius: 9999px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
      `}</style>

      {/* Header Section */}
      <div className="glass-panel" style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ padding: '12px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '12px', color: 'var(--accent-primary)' }}>
            <Database size={28} />
          </div>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0', color: '#fff', letterSpacing: '-0.01em' }}>
              Audit des Anomalies
            </h1>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              Table <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: '4px', color: '#cbd5e1' }}>t_import_anomalies</code>
              • <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{filteredData.length} enregistrements</span>
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '12px', color: '#64748b' }}>
              <Search size={16} />
            </div>
            <input 
              type="text" 
              placeholder="Rechercher (nom, type...)" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="modern-input"
              style={{ padding: '10px 16px 10px 36px', width: '280px', fontSize: '14px' }}
            />
          </div>
          <button 
            onClick={fetchData} 
            className="btn btn-primary" 
            disabled={isLoading}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', borderRadius: '8px', fontWeight: 600 }}
          >
            <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
            Rafraîchir
          </button>
        </div>
      </div>

      {/* Table Section */}
      <div className="glass-panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flex: 1, color: '#64748b', gap: '16px' }}>
            <RefreshCw size={32} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
            <span>Analyse de la table en cours...</span>
          </div>
        ) : filteredData.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', flex: 1, color: '#64748b', gap: '12px' }}>
            <Database size={48} style={{ opacity: 0.2 }} />
            <span style={{ fontSize: '16px' }}>Aucune anomalie trouvée.</span>
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead className="glass-header" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', textAlign: 'center', color: '#94a3b8', fontWeight: 600, width: '60px' }}>#</th>
                  {columns.map(col => (
                    <th key={col} style={{ padding: '16px', textAlign: 'left', color: '#e2e8f0', fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'capitalize', letterSpacing: '0.02em' }}>
                      {col.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentData.map((row, index) => (
                  <tr key={index} className="anomalies-table-row" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                    <td style={{ padding: '12px 16px', color: '#64748b', textAlign: 'center', fontWeight: 500 }}>
                      {(currentPage - 1) * rowsPerPage + index + 1}
                    </td>
                    {columns.map(col => {
                      let cellValue = row[col];
                      
                      // Formatage spécifique par type de colonne
                      if (col === 'type_anomalie') {
                        const style = getBadgeStyle(cellValue);
                        return (
                          <td key={col} style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>
                            <span className="badge" style={{ backgroundColor: style.bg, color: style.color, border: `1px solid ${style.border}` }}>
                              {String(cellValue).replace(/_/g, ' ')}
                            </span>
                          </td>
                        );
                      }

                      if (col === 'description') {
                        return (
                          <td key={col} style={{ padding: '12px 16px', maxWidth: '300px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#cbd5e1' }}>
                              <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(cellValue)}>
                                {String(cellValue)}
                              </span>
                            </div>
                          </td>
                        );
                      }

                      // Traitement des valeurs génériques
                      let displayValue: React.ReactNode = String(cellValue);
                      let isNull = false;

                      if (cellValue === null) {
                        displayValue = <span style={{ color: '#475569', fontStyle: 'italic' }}>NULL</span>;
                        isNull = true;
                      } else if (cellValue === undefined) {
                        displayValue = '';
                      } else if (typeof cellValue === 'object') {
                        displayValue = JSON.stringify(cellValue);
                      }

                      return (
                        <td key={col} style={{ 
                          padding: '12px 16px', 
                          color: isNull ? '#475569' : '#94a3b8',
                          whiteSpace: 'nowrap', 
                          maxWidth: '250px', 
                          overflow: 'hidden', 
                          textOverflow: 'ellipsis',
                          fontWeight: isNull ? 400 : 500
                        }} title={isNull ? '' : String(row[col])}>
                          {displayValue}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        {/* Pagination Footer */}
        {!isLoading && filteredData.length > 0 && (
          <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#64748b', fontSize: '13px' }}>
              <span>Lignes par page:</span>
              <select 
                className="modern-input" 
                style={{ padding: '6px 10px', fontSize: '13px', width: '70px' }}
                value={rowsPerPage}
                onChange={(e) => setRowsPerPage(Number(e.target.value))}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={500}>500</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 500 }}>
                Page <span style={{ color: '#fff' }}>{currentPage}</span> sur {totalPages}
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  className="modern-input" 
                  style={{ padding: '6px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', opacity: currentPage === 1 ? 0.5 : 1 }}
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                >
                  <ChevronLeft size={18} />
                </button>
                <button 
                  className="modern-input" 
                  style={{ padding: '6px', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer', opacity: currentPage === totalPages ? 0.5 : 1 }}
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

