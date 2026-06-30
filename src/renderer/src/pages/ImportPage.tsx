import { useEffect, useState } from 'react';
import { 
  Upload, FileSpreadsheet, CheckCircle, 
  AlertCircle, Loader, Database, 
  ArrowRight, ShieldAlert, FileText, 
  ChevronRight, HardDrive, Zap,
  Activity, Layers, Info, Trash2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';

export default function ImportPage() {
  const { user, activeSiteId } = useAuthStore();
  const [file, setFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rows: any[]; headers: string[]; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ updated: number; inserted: number } | null>(null);
  
  // Custom Modals State
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [isPurging, setIsPurging] = useState(false);
  const [cardCount, setCardCount] = useState<number>(0);

  const fetchCardCount = async () => {
    try {
      const count = await window.api.db.getCardCount();
      setCardCount(count);
    } catch (err) {
      console.error('Failed to fetch card count:', err);
    }
  };

  useEffect(() => {
    fetchCardCount();
  }, []);

  const handleSelectFile = async () => {
    try {
      const path = await window.api.import.selectFile();
      if (!path) return;
      setFile(path);
      setResult(null);
      setPreview(null);
      
      const data = await window.api.import.parseCSV(path);
      if (data.error) {
        toast.error(`Erreur de lecture: ${data.error}`);
        return;
      }
      setPreview(data);
      toast.success(`${data.total.toLocaleString('fr')} lignes détectées`);
    } catch (e) {
      toast.error('Erreur lors de la sélection du fichier');
      console.error(e);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setProgress(0);
    
    const removeListener = window.api.import.onProgress((p: number) => {
      setProgress(p);
    });
    
    try {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      if (!siteIdToUse) {
        toast.error('Aucun site sélectionné');
        setImporting(false);
        return;
      }

      await window.api.import.clearTemp(siteIdToUse);
      const res = await window.api.import.processFile(file, user?.login || 'ADMIN', preview?.total, siteIdToUse);
      setResult(res);
      toast.success(`Migration terminée !`);
      await fetchCardCount();
    } catch (e) {
      toast.error(`Échec de l'importation`);
    } finally {
      removeListener();
      setImporting(false);
      setProgress(100);
    }
  };

  const handlePurge = async () => {
    if (purgeConfirmText !== 'CONFIRMER') {
      toast.error('Veuillez saisir "CONFIRMER" pour valider');
      return;
    }

    setIsPurging(true);
    try {
      const res = await window.api.db.purge();
      if (res.success) {
        toast.success("Base de données locale purgée avec succès !");
        setPurgeConfirmText('');
        setShowPurgeModal(false);
        setCardCount(0);
      }
    } catch (e) {
      toast.error('Échec de la purge');
    } finally {
      setIsPurging(false);
    }
  };

  // Helper for Stepper
  const currentStep = result ? 3 : (importing ? 2 : (file ? 2 : 1));

  return (
    <div className="import-container animate-fade-in">
      
      {/* Optimized Header */}
      <div className="import-header">
        <div className="import-title-group">
          <div style={{ 
            width: 72, height: 72, borderRadius: 24, 
            background: 'linear-gradient(135deg, #6C63FF 0%, #3F37C9 100%)', 
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 12px 40px rgba(108, 99, 255, 0.4)',
            border: '1px solid rgba(255,255,255,0.1)',
            flexShrink: 0
          }}>
            <Database size={36} color="white" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1>Centre de Migration</h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
              <span style={{ 
                padding: '5px 14px', borderRadius: 20, background: 'rgba(108, 99, 255, 0.15)', 
                color: '#8e85ff', fontSize: 11, fontWeight: 900, textTransform: 'uppercase',
                border: '1px solid rgba(108, 99, 255, 0.2)', letterSpacing: 0.5
              }}>
                MOTEUR TURBO V2.0
              </span>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 16, fontWeight: 500 }}>Traitement haute performance de données massives.</p>
            </div>
          </div>
        </div>

        {/* Step Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, background: 'rgba(255,255,255,0.02)', padding: '12px 24px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap' }}>
          {[1, 2, 3].map((step) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ 
                width: 32, height: 32, borderRadius: '50%', 
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: currentStep >= step ? 'var(--accent-primary)' : 'transparent',
                color: currentStep >= step ? 'white' : 'var(--text-muted)',
                fontWeight: 800, fontSize: 14,
                border: currentStep >= step ? 'none' : '2px solid rgba(255,255,255,0.1)',
                transition: 'all 0.4s ease'
              }}>
                {currentStep > step ? <CheckCircle size={18} /> : step}
              </div>
              {step < 3 && <div style={{ width: 30, height: 2, background: currentStep > step ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)' }} />}
            </div>
          ))}
        </div>
      </div>

      {/* Page Content Stack */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
        
        {/* Step 1: Upload (Only if no file) */}
        {!file && (
          <div className="import-step-card animate-slide-up" style={{ borderStyle: 'dashed', borderColor: 'rgba(108, 99, 255, 0.3)' }}>
            <div style={{ 
              width: 120, height: 120, borderRadius: 40,
              background: 'rgba(108, 99, 255, 0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent-primary)', position: 'relative'
            }}>
              <Upload size={56} />
              <div style={{ 
                position: 'absolute', inset: -15, borderRadius: 50, 
                border: '2px solid rgba(108, 99, 255, 0.2)', animation: 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite' 
              }} />
            </div>
            
            <div style={{ maxWidth: 550 }}>
              <h2 style={{ fontSize: 32, fontWeight: 900, color: 'white', marginBottom: 16, letterSpacing: '-0.5px' }}>Prêt pour la migration ?</h2>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 18, lineHeight: 1.6, fontWeight: 500 }}>
                Glissez-déposez votre listing Excel/CSV ou utilisez le bouton pour injecter vos données dans le système.
              </p>
            </div>

            <button 
              className="btn btn-primary" 
              onClick={handleSelectFile}
              style={{ padding: '20px 64px', borderRadius: 24, fontSize: 18, fontWeight: 800, gap: 16, boxShadow: '0 20px 48px rgba(108, 99, 255, 0.3)' }}
            >
              <FileSpreadsheet size={28} />
              Sélectionner le Listing
            </button>
          </div>
        )}

        {/* Step 2: Progress Overlay */}
        {importing && (
          <div className="import-progress-container animate-slide-up">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                <div className="animate-spin" style={{ color: 'var(--accent-primary)' }}>
                  <Activity size={40} />
                </div>
                <div>
                  <h3 style={{ fontSize: 24, fontWeight: 900, color: 'white', margin: 0 }}>Injection en cours...</h3>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 16, fontWeight: 500, margin: 0 }}>Optimisation des buffers SQLite</p>
                </div>
              </div>
              <span style={{ fontSize: 44, fontWeight: 950, color: 'var(--accent-primary)', letterSpacing: -2 }}>{progress}%</span>
            </div>
            <div className="import-progress-bar-bg">
              <div className="import-progress-bar-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* Step 3: Success View */}
        {result && (
          <div className="import-step-card animate-slide-up" style={{ 
            border: '1px solid rgba(39, 174, 96, 0.3)',
            background: 'linear-gradient(135deg, rgba(39, 174, 96, 0.1) 0%, rgba(10, 14, 39, 0) 100%)'
          }}>
            <div style={{ 
              width: 96, height: 96, borderRadius: '50%', background: 'var(--accent-green)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
              boxShadow: '0 0 48px rgba(39, 174, 96, 0.5)', color: 'white'
            }}>
              <CheckCircle size={56} />
            </div>
            <h2 style={{ fontSize: 32, fontWeight: 950, color: 'white', marginBottom: 16, letterSpacing: '-1px' }}>Migration Terminée</h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 18, marginBottom: 24, fontWeight: 500 }}>L'intégralité du listing a été synchronisée avec succès.</p>
            <button className="btn btn-primary" onClick={() => { setFile(null); setResult(null); }} style={{ padding: '20px 56px', borderRadius: 20, fontSize: 18, fontWeight: 800 }}>Nouvelle Migration</button>
          </div>
        )}

        {/* --- MAIN INTERACTIVE VIEW (VERTICAL STACK) --- */}
        {file && !result && !importing && (
          <>
            {/* TOP: Aperçu des données */}
            <div className="animate-slide-up" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingLeft: 8 }}>
                <div style={{ 
                  width: 44, height: 44, borderRadius: 14, 
                  background: 'rgba(108, 99, 255, 0.1)', color: 'var(--accent-primary)', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center' 
                }}>
                  <Layers size={22} />
                </div>
                <h3 style={{ fontSize: 24, fontWeight: 900, color: 'white', letterSpacing: '-0.5px', margin: 0 }}>Aperçu des données</h3>
              </div>

              <div className="premium-glass" style={{ 
                borderRadius: 32, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(10, 14, 39, 0.4)'
              }}>
                {preview ? (() => {
                  const targetColumns = [
                    { id: 'noms', label: 'NOM(S)', matches: ['nom', 'noms'] },
                    { id: 'prenoms', label: 'PRÉNOM(S)', matches: ['prenom', 'prenoms', 'prénom', 'prénoms'] },
                    { id: 'date_de_naissance', label: 'DATE NAISSANCE', matches: ['date de naissance', 'date_naissance', 'naissance'] },
                    { id: 'num_secu', label: 'N° SÉCU', matches: ['num secu', 'n° secu', 'numero secu', 'num_secu', 'nss'] },
                    { id: 'lieu_de_naissance', label: 'LIEU NAISSANCE', matches: ['lieu de naissance', 'lieu_naissance', 'lieu'] },
                    { id: 'contact', label: 'CONTACT', matches: ['contact', 'contacts', 'téléphone', 'telephone', 'tel'] },
                    { id: 'action', label: 'ACTION', matches: [] }
                  ];

                  const activeHeaders = targetColumns.map(target => {
                    if (target.id === 'action') return { ...target, csvHeader: 'ACTION_COL' };
                    const foundHeader = (preview.headers || []).find(h => {
                      const normalized = h.toLowerCase().trim();
                      return target.matches.some(m => normalized === m || normalized.includes(m));
                    });
                    return { ...target, csvHeader: foundHeader };
                  }).filter(h => h.csvHeader);

                  return (
                    <div className="import-table-wrapper">
                      <table className="data-table" style={{ width: 'max-content', minWidth: '100%' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#1a1c2e' }}>
                          <tr>
                            {activeHeaders.map((h, i) => (
                              <th key={i} style={{ 
                                padding: '20px 24px', textAlign: h.id === 'action' ? 'center' : 'left', fontSize: 11, fontWeight: 900, 
                                color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', 
                                borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap',
                                letterSpacing: '1px'
                              }}>
                                {h.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(preview.rows || []).slice(0, 50).map((row, i) => (
                            <tr key={i} className="table-row-hover">
                              {activeHeaders.map((h, j) => {
                                if (h.id === 'action') {
                                  return (
                                    <td key={j} style={{ padding: '12px 24px', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                      <button 
                                        className="btn btn-icon" 
                                        onClick={() => {
                                          const newRows = [...preview.rows];
                                          newRows.splice(i, 1);
                                          setPreview({ ...preview, rows: newRows, total: preview.total - 1 });
                                          toast.success('Ligne retirée de l\'aperçu');
                                        }}
                                        style={{ background: 'rgba(231, 76, 60, 0.1)', color: 'var(--accent-red)', borderRadius: 10 }}
                                      >
                                        <Trash2 size={16} />
                                      </button>
                                    </td>
                                  );
                                }
                                const rowKey = (h.csvHeader || '').toLowerCase().replace(/\s+/g, '_');
                                return (
                                  <td key={j} style={{ 
                                    padding: '16px 24px', fontSize: 13, color: 'rgba(255,255,255,0.7)', 
                                    borderBottom: '1px solid rgba(255,255,255,0.03)', whiteSpace: 'nowrap',
                                    fontWeight: 500
                                  }}>
                                    {row[rowKey] || '—'}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })() : (
                  <div style={{ padding: '80px', textAlign: 'center' }}><Loader size={40} className="animate-spin" /></div>
                )}
              </div>
            </div>

            {/* BOTTOM: Source Active Card */}
            <div className="animate-slide-up" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingLeft: 8 }}>
                <div style={{ 
                  width: 44, height: 44, borderRadius: 14, 
                  background: 'rgba(39, 174, 96, 0.1)', color: 'var(--accent-green)', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center' 
                }}>
                  <FileText size={22} />
                </div>
                <h3 style={{ fontSize: 24, fontWeight: 900, color: 'white', letterSpacing: '-0.5px', margin: 0 }}>Source Active</h3>
              </div>

              <div className="premium-glass" style={{ 
                padding: '32px 40px', borderRadius: 32, border: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap'
              }}>
                <div style={{ display: 'flex', gap: 32, flex: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200, padding: '16px 24px', borderRadius: 20, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <p style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 4 }}>Nom du fichier</p>
                    <p style={{ fontSize: 16, fontWeight: 800, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: 0 }}>
                      {file.split('\\').pop()}
                    </p>
                  </div>
                  {preview && (
                    <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap' }}>
                      <div>
                        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 800, textTransform: 'uppercase', margin: 0 }}>Volume</p>
                        <p style={{ color: 'white', fontWeight: 900, fontSize: 22, margin: 0 }}>{preview.total.toLocaleString('fr')}</p>
                      </div>
                      <div>
                        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 800, textTransform: 'uppercase', margin: 0 }}>Colonnes</p>
                        <p style={{ color: 'white', fontWeight: 900, fontSize: 22, margin: 0 }}>{preview.headers.length}</p>
                      </div>
                    </div>
                  )}
                </div>

                <button 
                  className="btn btn-primary" 
                  onClick={handleImport} 
                  disabled={importing}
                  style={{ 
                    minWidth: 280, padding: '20px 40px', borderRadius: 24, 
                    background: 'var(--accent-green)',
                    boxShadow: '0 12px 40px rgba(39, 174, 96, 0.4)',
                    border: 'none', gap: 16, fontSize: 18, fontWeight: 900
                  }}
                >
                  <Zap size={24} />
                  Lancer l'Importation
                </button>
              </div>
            </div>
          </>
        )}

        {/* Maintenance Zone */}
        {(user?.role === 'ADMINISTRATEUR' || (user?.role === 'SUPER ADMIN' && activeSiteId)) && !importing && (
          <div style={{ marginTop: 20 }}>
            <div className="premium-glass" style={{ 
              padding: 32, borderRadius: 32, 
              background: 'rgba(231, 76, 60, 0.03)',
              border: '1px solid rgba(231, 76, 60, 0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 20
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
                <div style={{ 
                  width: 56, height: 56, borderRadius: 16, 
                  background: 'rgba(231, 76, 60, 0.1)', 
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--accent-red)', flexShrink: 0
                }}>
                  <ShieldAlert size={28} />
                </div>
                <div>
                  <h4 style={{ fontSize: 18, fontWeight: 900, color: 'white', marginBottom: 4, margin: 0 }}>Zone de Maintenance</h4>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: 500, margin: 0 }}>Réinitialisation complète de la base de données locale.</p>
                </div>
              </div>
              <button 
                className="btn" 
                disabled={cardCount === 0 || isPurging}
                onClick={() => setShowPurgeModal(true)}
                style={{ 
                  background: (cardCount === 0 || isPurging) ? 'rgba(255,255,255,0.05)' : 'rgba(231, 76, 60, 0.1)', 
                  color: (cardCount === 0 || isPurging) ? 'var(--text-muted)' : 'var(--accent-red)', 
                  padding: '14px 28px', borderRadius: 16, fontWeight: 800, 
                  border: (cardCount === 0 || isPurging) ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(231, 76, 60, 0.2)',
                  cursor: (cardCount === 0 || isPurging) ? 'not-allowed' : 'pointer',
                  opacity: (cardCount === 0 || isPurging) ? 0.5 : 1
                }}
              >
                Purger la base
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Purge Modal */}
      {showPurgeModal && (
        <div className="modal-overlay animate-fade-in" style={{ 
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24
        }}>
          <div className="premium-glass animate-slide-up" style={{ 
            width: '100%', maxWidth: 500, padding: 48, borderRadius: 40, 
            border: '1px solid rgba(231, 76, 60, 0.3)', background: 'rgba(20, 10, 10, 0.95)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
              <div style={{ 
                width: 96, height: 96, borderRadius: 32, background: 'rgba(231, 76, 60, 0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-red)'
              }}>
                <ShieldAlert size={56} />
              </div>
            </div>
            <h3 style={{ textAlign: 'center', marginBottom: 16, fontSize: 28, color: 'white', fontWeight: 950, letterSpacing: '-0.5px' }}>DANGER</h3>
            <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 16, lineHeight: 1.6, marginBottom: 40, fontWeight: 500 }}>
              Vous allez supprimer l'intégralité des données. Cette action est <strong>définitive</strong> et ne peut pas être annulée.
            </p>
            
            <div style={{ marginBottom: 40 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', marginBottom: 12, textAlign: 'center', letterSpacing: 1 }}>
                Saisissez <span style={{ color: 'white' }}>CONFIRMER</span>
              </label>
              <input 
                className="form-input" 
                type="text" 
                placeholder="---"
                value={purgeConfirmText}
                onChange={e => setPurgeConfirmText(e.target.value.toUpperCase())}
                style={{ 
                  textAlign: 'center', fontSize: 20, fontWeight: 950, letterSpacing: 6, 
                  background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: 20, height: 64
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 16 }}>
              <button 
                className="btn btn-outline" 
                disabled={isPurging}
                style={{ flex: 1, borderRadius: 20, padding: '18px', cursor: isPurging ? 'not-allowed' : 'pointer' }} 
                onClick={() => { setShowPurgeModal(false); setPurgeConfirmText(''); }}
              >
                Annuler
              </button>
              <button 
                className="btn" 
                disabled={purgeConfirmText !== 'CONFIRMER' || isPurging}
                style={{ 
                  flex: 1, 
                  borderRadius: 20, 
                  background: (purgeConfirmText === 'CONFIRMER' && !isPurging) ? 'var(--accent-red)' : 'rgba(255,255,255,0.05)', 
                  color: 'white', 
                  fontWeight: 900, 
                  border: 'none',
                  cursor: (purgeConfirmText !== 'CONFIRMER' || isPurging) ? 'not-allowed' : 'pointer'
                }}
                onClick={handlePurge}
              >
                {isPurging ? 'Purge en cours...' : 'Purger'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
