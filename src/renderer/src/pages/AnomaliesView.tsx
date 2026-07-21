import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Database, Search, ChevronLeft, ChevronRight } from 'lucide-react';
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
        
        // Extraire dynamiquement TOUTES les colonnes de la première ligne
        if (rows && rows.length > 0) {
          const cols = Object.keys(rows[0]);
          // Optionnel: On pourrait réordonner pour mettre lieu_enrolement, statut, date_delivrance en évidence
          setColumns(cols);
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

  // Filter data based on search term
  const filteredData = useMemo(() => {
    if (!searchTerm.trim()) return data;
    const lowerSearch = searchTerm.toLowerCase();
    
    return data.filter(row => {
      // Rechercher dans les champs clés (nom, prénom, sécu, lieu, type)
      const searchableValues = [
        row.noms, row.prenoms, row.num_secu, 
        row.lieu_de_naissance, row.lieu_enrolement, 
        row.type_anomalie, row.statut
      ].filter(Boolean).map(String).map(s => s.toLowerCase());
      
      return searchableValues.some(val => val.includes(lowerSearch));
    });
  }, [data, searchTerm]);

  // Pagination logic
  const totalPages = Math.ceil(filteredData.length / rowsPerPage) || 1;
  const currentData = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredData.slice(start, start + rowsPerPage);
  }, [filteredData, currentPage, rowsPerPage]);

  // Reset to page 1 if search term or rows per page changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, rowsPerPage]);

  return (
    <div style={{ padding: '24px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '24px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', margin: 0 }}>
            <Database size={24} color="var(--accent-primary)" />
            Audit des Anomalies (t_import_anomalies)
          </h1>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)' }}>
            Vue permanente d'inspection des anomalies d'importation.
            <strong style={{ marginLeft: '8px', color: 'var(--accent-primary)' }}>
              Total : {filteredData.length} enregistrement(s).
            </strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '10px', color: 'var(--text-secondary)' }}>
              <Search size={16} />
            </div>
            <input 
              type="text" 
              placeholder="Rechercher (nom, type...)" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input-field"
              style={{ paddingLeft: '32px', width: '250px' }}
            />
          </div>
          <button 
            onClick={fetchData} 
            className="btn btn-secondary" 
            disabled={isLoading}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
            Rafraîchir
          </button>
        </div>
      </div>

      <div style={{ 
        flex: 1, 
        overflow: 'auto', 
        backgroundColor: 'var(--bg-secondary)', 
        borderRadius: '8px', 
        border: '1px solid var(--border-color)',
        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, color: 'var(--text-secondary)' }}>
            Chargement des anomalies...
          </div>
        ) : filteredData.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, color: 'var(--text-secondary)' }}>
            Aucune anomalie trouvée.
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto' }}>
            <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--bg-tertiary)', zIndex: 1, boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                <tr>
                  <th style={{ padding: '12px 8px', borderBottom: '1px solid var(--border-color)', textAlign: 'left', borderRight: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontWeight: 600 }}>#</th>
                  {columns.map(col => (
                    <th key={col} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', textAlign: 'left', borderRight: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentData.map((row, index) => (
                  <tr key={index} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: index % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)' }}>
                    <td style={{ padding: '8px', borderRight: '1px solid var(--border-color)', color: 'var(--text-secondary)', textAlign: 'center' }}>
                      {(currentPage - 1) * rowsPerPage + index + 1}
                    </td>
                    {columns.map(col => {
                      let cellValue = row[col];
                      if (cellValue === null) cellValue = <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>NULL</span>;
                      else if (cellValue === undefined) cellValue = '';
                      else if (typeof cellValue === 'object') cellValue = JSON.stringify(cellValue);
                      else cellValue = String(cellValue);

                      // Mise en évidence des nouvelles colonnes
                      let bgStyle = 'transparent';
                      if (['lieu_enrolement', 'statut', 'date_delivrance'].includes(col)) {
                        bgStyle = 'rgba(59, 130, 246, 0.05)';
                      }

                      return (
                        <td key={col} style={{ backgroundColor: bgStyle, padding: '8px 16px', borderRight: '1px solid var(--border-color)', whiteSpace: 'nowrap', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(row[col])}>
                          {cellValue}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      {!isLoading && filteredData.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
            <span>Lignes par page:</span>
            <select 
              className="input-field" 
              style={{ padding: '4px 8px', width: 'auto' }}
              value={rowsPerPage}
              onChange={(e) => setRowsPerPage(Number(e.target.value))}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              Page {currentPage} sur {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '6px' }}
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              >
                <ChevronLeft size={18} />
              </button>
              <button 
                className="btn btn-secondary" 
                style={{ padding: '6px' }}
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
  );
}
