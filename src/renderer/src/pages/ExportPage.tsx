import React, { useState, useEffect } from 'react';
import { Download, FileText, Database, ShieldAlert, CheckCircle, RefreshCw, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { useVisibilityBufferedCallback } from '../hooks/useVisibilityBufferedCallback';

export default function ExportPage() {
  const { user, activeSiteId } = useAuthStore();
  const [sites, setSites] = useState<any[]>([]);
  const [loadingSites, setLoadingSites] = useState(true);

  // States
  const [selectedStatut, setSelectedStatut] = useState<string>('ALL');
  const [isIncremental, setIsIncremental] = useState<boolean>(true);
  const [exportFormat, setExportFormat] = useState<'csv' | 'excel' | 'pdf'>('csv');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [progressMessage, setProgressMessage] = useState<string>('');

  // Rangement Filter States
  const [rangements, setRangements] = useState<string[]>([]);
  const [selectedRangement, setSelectedRangement] = useState<string>('ALL');
  const [rangementSearch, setRangementSearch] = useState<string>('');
  const [showRangementSuggestions, setShowRangementSuggestions] = useState<boolean>(false);

  const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
  const currentSiteName = sites.find(s => s.id === siteIdToUse)?.nom || 'Tous les sites';

  useEffect(() => {
    setLoadingSites(true);
    window.api.hierarchy.getSites()
      .then(setSites)
      .catch(err => console.error(err))
      .finally(() => setLoadingSites(false));
  }, []);

  const handleProgress = useVisibilityBufferedCallback((progress: number) => {
    if (progress === 100) {
      setIsGenerating(false);
      setProgressMessage('');
      return;
    }
    setProgressMessage(`Génération du PDF : ${progress}%...`);
  });

  // Listen to PDF progress
  useEffect(() => {
    if (window.api && window.api.export.onPdfProgress) {
      const unsubscribe = window.api.export.onPdfProgress(handleProgress);
      return () => unsubscribe();
    }
    return undefined;
  }, [handleProgress]);

  // Fetch unique locations when site context changes
  useEffect(() => {
    window.api.export.getRangements(siteIdToUse || undefined)
      .then(setRangements)
      .catch(err => console.error("Error fetching distinct locations:", err));
  }, [siteIdToUse]);

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!siteIdToUse && user?.role !== 'SUPER ADMIN') {
      toast.error("Aucun site d'opération configuré pour votre compte.");
      return;
    }

    setIsGenerating(true);
    setProgressMessage("Extraction et structuration des données...");

    try {
      const filters: Record<string, string> = {
        statut: selectedStatut,
        incremental: isIncremental ? 'true' : 'false',
        rangement: selectedRangement,
      };
      if (siteIdToUse) {
        filters.site_id = siteIdToUse.toString();
      }

      let res;
      if (exportFormat === 'csv') {
        setProgressMessage("Génération du fichier CSV...");
        res = await window.api.export.csv(filters);
      } else if (exportFormat === 'excel') {
        setProgressMessage("Génération du classeur Excel (.xlsx)...");
        res = await window.api.export.excel(filters);
      } else {
        // PDF Generation
        setProgressMessage("Lancement de la génération du PDF...");
        res = await window.api.export.pdf(filters);
      }

      if (res && res.success) {
        toast.success(`Export terminé ! ${res.count} cartes exportées.`);
      } else if (res) {
        if (res.reason === 'cancelled') {
          toast.error("Exportation annulée par l'utilisateur.");
        } else if (res.reason === 'no_data') {
          toast.error("Aucune donnée ne correspond aux critères sélectionnés.");
        } else {
          toast.error(`Erreur d'exportation : ${res.reason}`);
        }
      }
    } catch (err: any) {
      console.error(err);
      toast.error(`Échec de l'exportation : ${err.message || err}`);
    } finally {
      setIsGenerating(false);
      setProgressMessage('');
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: '24px 32px', maxWidth: 800, margin: '0 auto', color: 'var(--text-primary)' }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
        <div style={{ width: 56, height: 56, background: 'linear-gradient(135deg, #eccc68 0%, #ffd700 100%)', borderRadius: 16, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(255, 215, 0, 0.15)' }}>
          <Download size={28} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' }}>Centrale d'Exportation de Données</h2>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>Exportation sécurisée des cartes CMU pour les échanges offline.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
        
        {/* EXPORT OPTIONS CARD */}
        <form onSubmit={handleExport} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 20, padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          {/* SITE CONTEXT */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: 12, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Périmètre du Site</span>
              <strong style={{ fontSize: 15, color: '#ffd700' }}>{currentSiteName}</strong>
            </div>
            <Database size={20} style={{ color: '#ffd700', opacity: 0.8 }} />
          </div>

          {/* FILTERS */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Filtre de données (Statut / Anomalie)</label>
            <select
              value={selectedStatut}
              onChange={e => setSelectedStatut(e.target.value)}
              style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: 12, color: 'white', fontSize: 14 }}
              disabled={isGenerating}
            >
              <option value="ALL" style={{ color: 'black' }}>Toute la base (Sans filtre)</option>
              <option value="EN STOCK" style={{ color: 'black' }}>Cartes en stock</option>
              <option value="DELIVRE" style={{ color: 'black' }}>Cartes livrées / distribuées</option>
              <option value="SANS_RANGEMENT" style={{ color: 'black' }}>Anomalie : Sans Rangement physique</option>
              <option value="SANS_SECU" style={{ color: 'black' }}>Anomalie : Sans numéro de Sécurité Sociale (incomplets)</option>
            </select>
          </div>

          {/* RANGEMENT AUTOCOMPLETE FILTER */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, position: 'relative' }}>
            <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Filtre par Rangement ciblé
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="form-input"
                placeholder="Taper pour filtrer les rangements (Ex: BOITE 42)..."
                value={rangementSearch}
                onChange={e => {
                  setRangementSearch(e.target.value);
                  setShowRangementSuggestions(true);
                  if (e.target.value === '') {
                    setSelectedRangement('ALL');
                  }
                }}
                onFocus={() => setShowRangementSuggestions(true)}
                disabled={isGenerating}
                style={{ width: '100%' }}
              />
              {selectedRangement !== 'ALL' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setSelectedRangement('ALL');
                    setRangementSearch('');
                    setShowRangementSuggestions(false);
                  }}
                  style={{ borderRadius: 12, padding: '0 16px' }}
                >
                  Effacer
                </button>
              )}
            </div>

            {/* Suggestions list */}
            {showRangementSuggestions && (
              <div 
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 12,
                  marginTop: 6,
                  maxHeight: 200,
                  overflowY: 'auto',
                  zIndex: 10,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
                  padding: 6
                }}
              >
                <div
                  onClick={() => {
                    setSelectedRangement('ALL');
                    setRangementSearch('');
                    setShowRangementSuggestions(false);
                  }}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: selectedRangement === 'ALL' ? 'rgba(255,215,0,0.08)' : 'transparent',
                    color: selectedRangement === 'ALL' ? '#ffd700' : 'white',
                    fontSize: 13,
                    fontWeight: selectedRangement === 'ALL' ? 700 : 500
                  }}
                >
                  -- Tous les rangements --
                </div>
                {rangements
                  .filter(r => r.toUpperCase().includes(rangementSearch.toUpperCase()))
                  .map(rang => (
                    <div
                      key={rang}
                      onClick={() => {
                        setSelectedRangement(rang);
                        setRangementSearch(rang);
                        setShowRangementSuggestions(false);
                      }}
                      style={{
                        padding: '10px 14px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        background: selectedRangement === rang ? 'rgba(255,215,0,0.08)' : 'transparent',
                        color: selectedRangement === rang ? '#ffd700' : 'white',
                        fontSize: 13,
                        fontWeight: selectedRangement === rang ? 700 : 500,
                        marginTop: 2
                      }}
                    >
                      {rang}
                    </div>
                  ))
                }
                {rangements.filter(r => r.toUpperCase().includes(rangementSearch.toUpperCase())).length === 0 && (
                  <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontSize: 13 }}>
                    Aucune boîte correspondante.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* INCREMENTAL EXPORT */}
          <div 
            onClick={() => !isGenerating && setIsIncremental(!isIncremental)}
            style={{ 
              display: 'flex', 
              alignItems: 'flex-start', 
              gap: 12, 
              padding: 16, 
              background: isIncremental ? 'rgba(255, 215, 0, 0.03)' : 'rgba(255, 255, 255, 0.01)', 
              border: isIncremental ? '1px solid rgba(255, 215, 0, 0.2)' : '1px solid var(--border-color)', 
              borderRadius: 12, 
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <input 
              type="checkbox" 
              checked={isIncremental}
              onChange={() => {}} // handled by parent div click
              disabled={isGenerating}
              style={{ marginTop: 3, cursor: 'pointer' }}
            />
            <div>
              <strong style={{ display: 'block', fontSize: 13, color: isIncremental ? '#ffd700' : 'white' }}>Exporter uniquement les nouveautés</strong>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                Active la mise à jour automatique. Les cartes extraites seront marquées pour ne plus figurer dans les prochains exports ordinaires.
              </span>
            </div>
          </div>

          {/* FORMAT SELECTOR */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Format de fichier ciblé</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
              <div 
                onClick={() => !isGenerating && setExportFormat('csv')}
                style={{ 
                  padding: '20px 16px', 
                  borderRadius: 16, 
                  border: exportFormat === 'csv' ? '2px solid #ffd700' : '1px solid var(--border-color)', 
                  background: exportFormat === 'csv' ? 'rgba(255,215,0,0.02)' : 'rgba(255,255,255,0.01)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                <FileText size={24} style={{ color: exportFormat === 'csv' ? '#ffd700' : 'var(--text-muted)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: exportFormat === 'csv' ? 'white' : 'var(--text-secondary)' }}>Fichier CSV (.csv)</span>
              </div>

              <div 
                onClick={() => !isGenerating && setExportFormat('excel')}
                style={{ 
                  padding: '20px 16px', 
                  borderRadius: 16, 
                  border: exportFormat === 'excel' ? '2px solid #ffd700' : '1px solid var(--border-color)', 
                  background: exportFormat === 'excel' ? 'rgba(255,215,0,0.02)' : 'rgba(255,255,255,0.01)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                <Database size={24} style={{ color: exportFormat === 'excel' ? '#ffd700' : 'var(--text-muted)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: exportFormat === 'excel' ? 'white' : 'var(--text-secondary)' }}>Classeur Excel (.xlsx)</span>
              </div>
              
              <div 
                onClick={() => !isGenerating && setExportFormat('pdf')}
                style={{ 
                  padding: '20px 16px', 
                  borderRadius: 16, 
                  border: exportFormat === 'pdf' ? '2px solid #ffd700' : '1px solid var(--border-color)', 
                  background: exportFormat === 'pdf' ? 'rgba(255,215,0,0.02)' : 'rgba(255,255,255,0.01)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                <FileText size={24} style={{ color: exportFormat === 'pdf' ? '#ffd700' : 'var(--text-muted)' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: exportFormat === 'pdf' ? 'white' : 'var(--text-secondary)' }}>Imprimable PDF (.pdf)</span>
              </div>
            </div>
          </div>

          {/* PROGRESS INDICATION */}
          {isGenerating && (
            <div style={{ background: 'rgba(255,215,0,0.04)', border: '1px solid rgba(255,215,0,0.15)', borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <RefreshCw size={18} className="animate-spin" style={{ color: '#ffd700' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#ffd700' }}>{progressMessage}</span>
            </div>
          )}

          {/* ACTION BUTTON */}
          <button
            type="submit"
            disabled={isGenerating}
            style={{
              padding: '16px 24px',
              borderRadius: 12,
              background: isGenerating ? 'var(--border-color)' : 'linear-gradient(135deg, #eccc68, #ffd700)',
              color: 'black',
              border: 'none',
              fontWeight: 800,
              fontSize: 15,
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              boxShadow: isGenerating ? 'none' : '0 8px 24px rgba(255,215,0,0.15)',
              transition: 'all 0.2s'
            }}
          >
            <Download size={18} />
            {isGenerating ? "EXÉCUTION EN COURS..." : "LANCER L'EXPORTATION"}
          </button>

        </form>

        {/* SECURITY & OFFLINE SAFETY RULES BOARD */}
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 20, padding: 24, background: 'rgba(255,255,255,0.01)', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700 }}>
            <ShieldAlert size={16} style={{ color: '#ffd700' }} />
            <span>RÈGLES DE CONFORMITÉ DES EXPORTS</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <li>Les exports incluent obligatoirement la colonne unique de signature <code style={{ color: '#ffd700' }}>cle_doublon</code>. Elle permet de fusionner des bases de sites distants en limitant à 100% le risque de doublon.</li>
            <li>Le marquage des nouveautés met à jour l'historique local pour éviter d'exporter deux fois les mêmes éléments physiques lors de navettes successives sur clé USB.</li>
          </ul>
        </div>

      </div>

    </div>
  );
}
