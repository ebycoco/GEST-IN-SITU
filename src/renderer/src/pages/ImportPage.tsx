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
import { confirmService } from '../components/confirmService';
import { useNavigate } from 'react-router-dom';
import { useCacheStore } from '../stores/cacheStore';

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s`;
};

export default function ImportPage() {
  const { user, activeSiteId } = useAuthStore();
  const navigate = useNavigate();
  const [file, setFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rows: any[]; headers: string[]; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ updated: number; inserted: number; rejected: number; duplicates: number; probableDuplicates?: number; duration: number; totalProcessed: number } | null>(null);
  
  const [showPurgeModal, setShowPurgeModal] = useState(false);
  const [showFixCentreModal, setShowFixCentreModal] = useState(false);
  const [showConfirmSetupModal, setShowConfirmSetupModal] = useState(false);
  const [existingCentres, setExistingCentres] = useState<any[]>([]);
  const [purgeConfirmText, setPurgeConfirmText] = useState('');
  const [isPurging, setIsPurging] = useState(false);
  const [isEmergencyPurging, setIsEmergencyPurging] = useState(false);
  const [purgeProgress, setPurgeProgress] = useState(0);
  const [showEmergencyPurgeModal, setShowEmergencyPurgeModal] = useState(false);
  const [emergencyPurgeConfirmText, setEmergencyPurgeConfirmText] = useState('');
  const [cardCount, setCardCount] = useState<number>(0);

  const fetchCardCount = async (silent = false) => {
    try {
      const count = await window.api.db.getCardCount();
      setCardCount(count);
      useCacheStore.getState().setImportCache(count);
    } catch (err) {
      console.error('Failed to fetch card count:', err);
    }
  };

  useEffect(() => {
    const cache = useCacheStore.getState().importCache;
    let hasCache = false;
    if (cache.cachedAt && cache.cardCount !== null) {
      setCardCount(cache.cardCount);
      hasCache = true;
    }
    fetchCardCount(hasCache);
  }, []);

  // ─── ANTI-FREEZE (Couche 3) — Réconciliation au retour de focus ───────────
  // Écoute le signal 'app:focus-restored' dispatché par MainLayout via la
  // Visibility API. Au retour de l'utilisateur, force un seul setState léger
  // pour réconcilier l'UI et afficher la valeur de progression correcte,
  // au lieu de traiter une avalanche de messages IPC bufferisés.
  useEffect(() => {
    if (!importing && !isPurging) return; // S'abonner uniquement si un traitement est en cours
    const handleFocusRestored = () => {
      // Force un re-render léger : React comparera le state et mettra à jour
      // seulement si la valeur a changé depuis la dernière frame rendue.
      setProgress(prev => prev);
      setPurgeProgress(prev => prev);
    };
    window.addEventListener('app:focus-restored', handleFocusRestored);
    return () => window.removeEventListener('app:focus-restored', handleFocusRestored);
  }, [importing, isPurging]);
  // ──────────────────────────────────────────────────────────────────────────


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

    try {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      if (!siteIdToUse) {
        toast.error('Aucun site sélectionné');
        return;
      }

      // Récupérer la liste des centres du site
      const centres = await window.api.hierarchy.getCentres(Number(siteIdToUse));
      const centrePrincipal = centres.find((c: any) => c.numero === 1 || c.nom.toUpperCase().includes('PRINCIPAL'));

      // ÉTAPE A : Validation du nom personnalisé du Centre Principal
      if (centrePrincipal && centrePrincipal.nom.toUpperCase() === 'CENTRE PRINCIPAL') {
        setShowFixCentreModal(true);
        return;
      }

      // ÉTAPE B : Ouvrir la nouvelle modale personnalisée
      setExistingCentres(centres || []);
      setShowConfirmSetupModal(true);
    } catch (e) {
      toast.error(`Échec de la validation d'importation`);
      console.error(e);
    }
  };

  const executeImport = async () => {
    if (!file) return;
    
    setShowConfirmSetupModal(false);
    setImporting(true);
    setIsImporting(true);
    setProgress(0);
    
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) return;

    // ─── ANTI-FREEZE THROTTLE (Couche 2) ──────────────────────────────────────
    // requestAnimationFrame : synchronise les mises à jour React avec le cycle
    // de rendu GPU. Automatiquement suspendu quand document.visibilityState est
    // 'hidden', ce qui coupe le flux de re-renders inutiles en arrière-plan.
    // En cas de rafale IPC au retour de fenêtre, un seul re-render est effectué.
    const pendingImportProgress = { current: -1 };
    let importRafPending = false;
    // ──────────────────────────────────────────────────────────────────────────

    const removeListener = window.api.import.onProgress((p: number) => {
      // Ignorer les rafraîchissements graphiques React si la fenêtre est réduite/masquée
      if (document.visibilityState === 'hidden') {
        pendingImportProgress.current = p;
        return;
      }
      pendingImportProgress.current = p;
      if (!importRafPending) {
        importRafPending = true;
        requestAnimationFrame(() => {
          setProgress(pendingImportProgress.current);
          importRafPending = false;
        });
      }
    });

    try {
      await window.api.import.clearTemp(Number(siteIdToUse));
      const res = await window.api.import.processFile(file, user?.login || 'ADMIN', preview?.total, Number(siteIdToUse));
      setResult(res);
      toast.success(`Migration terminée !`);
      await fetchCardCount();
    } catch (e) {
      toast.error(`Échec de l'importation`);
      console.error(e);
    } finally {
      if (typeof removeListener === 'function') {
        removeListener();
      }
      setImporting(false);
      setIsImporting(false);
      setProgress(100);
    }
  };

  // ─── Logique interne de purge (sans vérification de texte) ─────────────────
  // Appelée après confirmation externe (confirmService) OU depuis le modal interne.
  const executePurge = async () => {
    setIsPurging(true);
    setPurgeProgress(0);

    // ─── ANTI-FREEZE THROTTLE (Couche 2) ──────────────────────────────────────
    const pendingPurgeProgress = { current: -1 };
    let purgeRafPending = false;
    // ──────────────────────────────────────────────────────────────────────────

    const removePurgeListener = window.api.db.onPurgeProgress((p: number) => {
      // Ignorer les rafraîchissements graphiques React si la fenêtre est réduite/masquée
      if (document.visibilityState === 'hidden') {
        pendingPurgeProgress.current = p;
        return;
      }
      pendingPurgeProgress.current = p;
      if (!purgeRafPending) {
        purgeRafPending = true;
        requestAnimationFrame(() => {
          setPurgeProgress(pendingPurgeProgress.current);
          purgeRafPending = false;
        });
      }
    });

    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      toast.error("Impossible de déterminer le site à purger.");
      setIsPurging(false);
      removePurgeListener();
      return;
    }

    try {
      const res = await window.api.db.purge(Number(siteIdToUse), user);
      if (res.success) {
        toast.success("Base de données locale purgée avec succès !");
        setPurgeConfirmText('');
        setShowPurgeModal(false);
        setCardCount(0);
      }
    } catch (e) {
      toast.error('Échec de la purge');
    } finally {
      removePurgeListener();
      setIsPurging(false);
    }
  };

  // Appelée depuis le modal interne avec saisie manuelle du texte
  const handlePurge = async () => {
    if (purgeConfirmText !== 'CONFIRMER') {
      toast.error('Veuillez saisir "CONFIRMER" pour valider');
      return;
    }
    await executePurge();
  };

  // ─── Logique interne de réparation (sans vérification de texte) ─────────────
  // Appelée après confirmation externe (confirmService) OU depuis le modal interne.
  const executeEmergencyPurge = async () => {
    setIsEmergencyPurging(true);
    setPurgeProgress(0);

    const pendingPurgeProgress = { current: -1 };
    let purgeRafPending = false;

    const removePurgeListener = window.api.db.onPurgeProgress((p: number) => {
      // Sécurité anti-saccade/latence IPC lors de la réduction de la fenêtre
      if (p === 100) {
        setIsEmergencyPurging(false);
        setPurgeProgress(100);
        return;
      }
      // Ignorer les rafraîchissements graphiques React si la fenêtre est réduite/masquée
      if (document.visibilityState === 'hidden') {
        pendingPurgeProgress.current = p;
        return;
      }

      pendingPurgeProgress.current = p;
      if (!purgeRafPending) {
        purgeRafPending = true;
        requestAnimationFrame(() => {
          setPurgeProgress(pendingPurgeProgress.current);
          purgeRafPending = false;
        });
      }
    });

    try {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      if (!siteIdToUse) {
        toast.error("Impossible de déterminer le site pour la purge d'urgence.");
        removePurgeListener();
        setIsEmergencyPurging(false);
        return;
      }
      await window.api.db.emergencyPurge(Number(siteIdToUse), user);
      toast.success("Base de données vidée et FTS5 réparé avec succès !");
      setFile(null);
      setPreview(null);
      setProgress(0);
      setResult(null);
      setCardCount(0);
      setShowEmergencyPurgeModal(false);
      setEmergencyPurgeConfirmText('');
    } catch (err: any) {
      toast.error("Échec de la purge forcée : " + err.message);
    } finally {
      removePurgeListener();
      setIsEmergencyPurging(false);
    }
  };

  // Appelée depuis le modal interne avec saisie manuelle du texte
  const handleEmergencyPurge = async () => {
    if (emergencyPurgeConfirmText !== 'RÉPARER') {
      toast.error("Veuillez saisir RÉPARER pour confirmer.");
      return;
    }
    await executeEmergencyPurge();
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
            border: '1px solid rgba(39, 174, 96, 0.2)',
            background: 'linear-gradient(135deg, rgba(39, 174, 96, 0.05) 0%, rgba(10, 14, 39, 0) 100%)',
            padding: 40,
            borderRadius: 32
          }}>
            <div style={{ 
              width: 80, height: 80, borderRadius: '50%', background: 'var(--accent-green)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
              boxShadow: '0 0 40px rgba(39, 174, 96, 0.4)', color: 'white'
            }}>
              <CheckCircle size={44} />
            </div>
            <h2 style={{ fontSize: 28, fontWeight: 950, color: 'white', marginBottom: 8, letterSpacing: '-1px', textAlign: 'center' }}>Bilan de Migration</h2>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, marginBottom: 32, fontWeight: 500, textAlign: 'center' }}>
              Importation finalisée en <span style={{ color: '#ffd700', fontWeight: 700 }}>{formatDuration(result.duration)}</span>.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px', marginBottom: '32px', width: '100%' }}>
              {/* Colonne 1: Volume */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Total Processed */}
                <div className="premium-glass" style={{ padding: '20px 24px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', textAlign: 'center' }}>
                  <p style={{ fontSize: 11, fontWeight: 800, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Lignes Traitées</p>
                  <p style={{ fontSize: 24, fontWeight: 900, color: 'white', margin: 0 }}>{result.totalProcessed?.toLocaleString('fr') || 0}</p>
                </div>

                {/* Inserted */}
                <div className="premium-glass" style={{ padding: '20px 24px', borderRadius: 20, border: '1px solid rgba(16, 185, 129, 0.2)', textAlign: 'center', background: 'rgba(16, 185, 129, 0.02)' }}>
                  <p style={{ fontSize: 11, fontWeight: 800, color: '#10b981', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Nouvelles Fiches</p>
                  <p style={{ fontSize: 24, fontWeight: 900, color: '#10b981', margin: 0 }}>{result.inserted?.toLocaleString('fr') || 0}</p>
                </div>
              </div>

              {/* Colonne 2: Maintenance */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Updated */}
                <div className="premium-glass" style={{ padding: '20px 24px', borderRadius: 20, border: '1px solid rgba(124, 58, 237, 0.2)', textAlign: 'center', background: 'rgba(124, 58, 237, 0.02)' }}>
                  <p style={{ fontSize: 11, fontWeight: 800, color: '#a855f7', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Mises à jour</p>
                  <p style={{ fontSize: 24, fontWeight: 900, color: '#a855f7', margin: 0 }}>{result.updated?.toLocaleString('fr') || 0}</p>
                </div>

                {/* Duplicates */}
                <div className="premium-glass" style={{ padding: '20px 24px', borderRadius: 20, border: '1px solid rgba(255, 215, 0, 0.2)', textAlign: 'center', background: 'rgba(255, 215, 0, 0.02)' }}>
                  <p style={{ fontSize: 11, fontWeight: 800, color: '#ffd700', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Doublons Ignorés</p>
                  <p style={{ fontSize: 24, fontWeight: 900, color: '#ffd700', margin: 0 }}>{result.duplicates?.toLocaleString('fr') || 0}</p>
                </div>
              </div>

              {/* Colonne 3: Alertes */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Probable Duplicates */}
                <div className="premium-glass" style={{ padding: '20px 24px', borderRadius: 20, border: '1px solid rgba(249, 115, 22, 0.3)', textAlign: 'center', background: 'rgba(249, 115, 22, 0.02)' }}>
                  <p style={{ fontSize: 11, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>⚠️ Doublons Probables</p>
                  <p style={{ fontSize: 24, fontWeight: 900, color: '#f97316', margin: 0 }}>{result.probableDuplicates?.toLocaleString('fr') || 0}</p>
                </div>

                {/* Rejected */}
                <div className="premium-glass" style={{ padding: '20px 24px', borderRadius: 20, border: '1px solid rgba(239, 68, 68, 0.2)', textAlign: 'center', background: 'rgba(239, 68, 68, 0.02)' }}>
                  <p style={{ fontSize: 11, fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Rejetées / Erreurs</p>
                  <p style={{ fontSize: 24, fontWeight: 900, color: '#ef4444', margin: 0 }}>{result.rejected?.toLocaleString('fr') || 0}</p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button 
                className="btn btn-primary" 
                onClick={() => { setFile(null); setResult(null); }} 
                style={{ padding: '20px 56px', borderRadius: 20, fontSize: 18, fontWeight: 800 }}
              >
                Nouvelle Migration
              </button>
            </div>
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
                  disabled={importing || !preview || !preview.total}
                  style={{ 
                    minWidth: 280, padding: '20px 40px', borderRadius: 24, 
                    background: (importing || !preview || !preview.total) ? 'rgba(255, 255, 255, 0.05)' : 'var(--accent-green)',
                    color: (importing || !preview || !preview.total) ? 'var(--text-muted)' : 'white',
                    boxShadow: (importing || !preview || !preview.total) ? 'none' : '0 12px 40px rgba(39, 174, 96, 0.4)',
                    border: 'none', gap: 16, fontSize: 18, fontWeight: 900,
                    cursor: (importing || !preview || !preview.total) ? 'not-allowed' : 'pointer',
                    opacity: (importing || !preview || !preview.total) ? 0.6 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.3s ease'
                  }}
                >
                  {(importing || (!preview && file)) ? (
                    <>
                      <Loader size={24} className="animate-spin" />
                      Analyse du fichier...
                    </>
                  ) : (
                    <>
                      <Zap size={24} />
                      Lancer l'Importation
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Maintenance Zone */}
        {(user?.role === 'ADMINISTRATEUR_SITE' || (user?.role === 'SUPER ADMIN' && activeSiteId)) && !importing && (
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
                  <h4 style={{ fontSize: 18, fontWeight: 900, color: 'white', marginBottom: 4, margin: 0 }}>Maintenance des Cartes Locales</h4>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, fontWeight: 500, margin: 0 }}>Supprime temporairement les cartes de ce site stockées sur cet ordinateur. Utile pour libérer de l'espace ou forcer un ré-import complet.</p>
                </div>
              </div>
              <button 
                className="btn" 
                disabled={cardCount === 0 || isPurging}
                onClick={async () => {
                  const isConfirmed = await confirmService.confirm({
                    title: "Purge des cartes locales",
                    message: "Êtes-vous sûr de vouloir purger toutes les fiches locales de ce PC ? Cette action est définitive.",
                    isDanger: true,
                    requirePassword: true,
                    actionName: "[SYSTÈME] Purge locale de cartes"
                  });
                  if (isConfirmed) {
                    // Bypass la vérification du texte : le confirmService a déjà validé le mot de passe
                    await executePurge();
                  }
                }}
                style={{ 
                  background: (cardCount === 0 || isPurging) ? 'rgba(255,255,255,0.05)' : 'rgba(231, 76, 60, 0.1)', 
                  color: (cardCount === 0 || isPurging) ? 'var(--text-muted)' : 'var(--accent-red)', 
                  padding: '14px 28px', borderRadius: 16, fontWeight: 800, 
                  border: (cardCount === 0 || isPurging) ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(231, 76, 60, 0.2)',
                  cursor: (cardCount === 0 || isPurging) ? 'not-allowed' : 'pointer',
                  opacity: (cardCount === 0 || isPurging) ? 0.5 : 1
                }}
              >
                Purger les cartes locales de ce PC
              </button>
            </div>
          </div>
        )}
        <button
          disabled={isEmergencyPurging || isPurging}
          onClick={async () => {
            const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
            if (!siteIdToUse) {
              toast.error("Impossible de déterminer le site pour la purge d'urgence.");
              return;
            }
            const isConfirmed = await confirmService.confirm({
              title: "Réparer & Forcer la Synchronisation",
              message: "Cette action réinitialise l'index de recherche locale FTS5 et vide la file d'attente Outbox locale pour ce site. Vos données cloud de Supabase restent en parfaite sécurité.",
              isDanger: true,
              requirePassword: true,
              actionName: "[SYSTÈME] Réparation et forçage de la synchronisation locale"
            });
            if (isConfirmed) {
              // Bypass la vérification du texte : le confirmService a déjà validé le mot de passe
              await executeEmergencyPurge();
            }
          }}
          style={{
            marginTop: '20px',
            background: (isEmergencyPurging || isPurging) ? 'rgba(255,255,255,0.05)' : '#8B0000',
            color: (isEmergencyPurging || isPurging) ? 'var(--text-muted)' : '#FFF',
            border: (isEmergencyPurging || isPurging) ? '1px solid rgba(255,255,255,0.05)' : '2px solid #FF0000',
            padding: '12px 24px',
            borderRadius: '8px',
            fontWeight: 'bold',
            cursor: (isEmergencyPurging || isPurging) ? 'not-allowed' : 'pointer',
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            opacity: (isEmergencyPurging || isPurging) ? 0.5 : 1
          }}
        >
          {isEmergencyPurging ? (
            <>
              <Loader className="animate-spin" size={18} />
              Réparation en cours...
            </>
          ) : (
            "🔴 Réparer & Forcer la Synchronisation Locale"
          )}
        </button>
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
              Êtes-vous sûr de vouloir vider les cartes locales de ce site ? Vos comptes utilisateurs et les données distantes sur Supabase ne seront pas affectés.
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
                onClick={() => { if (!isPurging) { setShowPurgeModal(false); setPurgeConfirmText(''); } }}
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
                  cursor: (purgeConfirmText !== 'CONFIRMER' || isPurging) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8
                }}
                onClick={handlePurge}
              >
                {isPurging && <Loader className="animate-spin" size={16} />}
                {isPurging ? `Purge: ${purgeProgress}%` : 'Purger'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emergency Purge Modal */}
      {showEmergencyPurgeModal && (
        <div className="modal-overlay animate-fade-in" style={{ 
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24
        }}>
          <div className="premium-glass animate-slide-up" style={{ 
            width: '100%', maxWidth: 500, padding: 48, borderRadius: 40, 
            border: '1px solid rgba(239, 68, 68, 0.4)', background: 'rgba(15, 5, 5, 0.98)',
            boxShadow: '0 24px 50px rgba(239, 68, 68, 0.15)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
              <div style={{ 
                width: 96, height: 96, borderRadius: 32, background: 'rgba(239, 68, 68, 0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444'
              }}>
                <ShieldAlert size={56} />
              </div>
            </div>
            <h3 style={{ textAlign: 'center', marginBottom: 16, fontSize: 24, color: 'white', fontWeight: 950, letterSpacing: '-0.5px' }}>
              Réparer & Forcer la Synchronisation Locale
            </h3>
            <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 1.6, marginBottom: 32, fontWeight: 500 }}>
              Cette action répare la structure locale des cartes de ce PC en réinitialisant l'index FTS5 et en vidant la file d'attente de synchronisation locale pour ce site. Vos comptes utilisateurs et les données cloud de Supabase restent en parfaite sécurité.
            </p>
            
            <div style={{ marginBottom: 32 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 900, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', marginBottom: 12, textAlign: 'center', letterSpacing: 1 }}>
                Saisissez <span style={{ color: '#ef4444' }}>RÉPARER</span>
              </label>
              <input 
                className="form-input" 
                type="text" 
                placeholder="---"
                value={emergencyPurgeConfirmText}
                onChange={e => setEmergencyPurgeConfirmText(e.target.value.toUpperCase())}
                style={{ 
                  textAlign: 'center', fontSize: 20, fontWeight: 950, letterSpacing: 6, 
                  background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(239, 68, 68, 0.2)',
                  borderRadius: 20, height: 64, color: 'white', width: '100%', outline: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 16 }}>
              <button 
                className="btn btn-outline" 
                disabled={isEmergencyPurging}
                style={{ flex: 1, borderRadius: 20, padding: '18px', cursor: isEmergencyPurging ? 'not-allowed' : 'pointer' }} 
                onClick={() => { if (!isEmergencyPurging) { setShowEmergencyPurgeModal(false); setEmergencyPurgeConfirmText(''); } }}
              >
                Annuler
              </button>
              <button 
                className="btn" 
                disabled={emergencyPurgeConfirmText !== 'RÉPARER' || isEmergencyPurging}
                style={{ 
                  flex: 1, 
                  borderRadius: 20, 
                  background: (emergencyPurgeConfirmText === 'RÉPARER' && !isEmergencyPurging) ? '#ef4444' : 'rgba(255,255,255,0.05)', 
                  color: 'white', 
                  fontWeight: 900, 
                  border: 'none',
                  cursor: (emergencyPurgeConfirmText !== 'RÉPARER' || isEmergencyPurging) ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8
                }}
                onClick={handleEmergencyPurge}
              >
                {isEmergencyPurging && <Loader className="animate-spin" size={16} />}
                {isEmergencyPurging ? 'Réparation...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL ACTION REQUISE : PERSONNALISER LE CENTRE */}
      {showFixCentreModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5, 7, 15, 0.85)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          animation: 'fadeIn 0.3s'
        }}>
          <div className="premium-glass" style={{
            background: '#131722',
            width: '90%',
            maxWidth: 450,
            borderRadius: 24,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 32px 64px -12px rgba(0, 0, 0, 0.6)',
            overflow: 'hidden',
            padding: 32,
            textAlign: 'center'
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, margin: '0 auto 20px',
              background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <ShieldAlert size={28} />
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 900, color: 'white', marginBottom: 12 }}>
              Personnalisation du Centre Requise
            </h3>

            <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6, marginBottom: 28 }}>
              Action requise : le nom de votre centre principal doit être personnalisé dans l'interface de gestion de l'infrastructure avant de pouvoir importer des données.
            </p>

            <div style={{ display: 'flex', gap: 12 }}>
              <button 
                className="btn-secondary" 
                style={{ flex: 1, height: 48, borderRadius: 14, fontWeight: 700, cursor: 'pointer' }}
                onClick={() => setShowFixCentreModal(false)}
              >
                Fermer
              </button>
              <button 
                className="btn btn-primary" 
                style={{ flex: 1, height: 48, borderRadius: 14, fontWeight: 800, cursor: 'pointer', justifyContent: 'center' }}
                onClick={() => {
                  setShowFixCentreModal(false);
                  navigate('/sites');
                }}
              >
                Personnaliser
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIGURATION DES CENTRES SECONDAIRES */}
      {showConfirmSetupModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5, 7, 15, 0.85)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          animation: 'fadeIn 0.3s'
        }}>
          <div className="premium-glass" style={{
            background: '#131722',
            width: '90%',
            maxWidth: 480,
            borderRadius: 24,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 32px 64px -12px rgba(0, 0, 0, 0.6)',
            overflow: 'hidden',
            padding: 32,
            textAlign: 'center'
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, margin: '0 auto 20px',
              background: 'rgba(255, 230, 0, 0.1)', color: '#FFE600',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Layers size={28} />
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 900, color: 'white', marginBottom: 12 }}>
              Configuration des Centres
            </h3>

            <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              Avez-vous d'autres centres de distribution à ajouter (2 ou 3 centres) pour cette importation ? <br />
              Si oui, veuillez les créer dans l'onglet **Infrastructure** avant de continuer.<br /><br />
              Sinon, les centres et les cartes seront affectés selon la configuration de vos centres :
            </p>

            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              borderRadius: 16,
              padding: 16,
              textAlign: 'left',
              marginBottom: 28,
              maxHeight: 150,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}>
              {existingCentres.map((c: any) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'white' }}>{c.nom}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 6 }}>
                    N°{c.numero} {c.prefixe_rangement ? `(${c.prefixe_rangement})` : ''}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button 
                className="btn-secondary" 
                style={{ flex: 1, height: 48, borderRadius: 14, fontWeight: 700, cursor: 'pointer' }}
                onClick={() => {
                  setShowConfirmSetupModal(false);
                  navigate('/sites');
                }}
              >
                Créer mes centres
              </button>
              <button 
                className="btn btn-primary" 
                style={{ 
                  flex: 1, 
                  height: 48, 
                  borderRadius: 14, 
                  fontWeight: 800, 
                  cursor: 'pointer', 
                  justifyContent: 'center',
                  background: 'linear-gradient(135deg, #FFE600 0%, #E6C300 100%)',
                  color: 'black',
                  border: 'none'
                }}
                onClick={executeImport}
              >
                Poursuivre l'import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay de blocage pendant l'importation et la purge */}
      {(isImporting || isPurging || isEmergencyPurging) && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5, 7, 15, 0.9)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          cursor: 'not-allowed',
          pointerEvents: 'auto'
        }}>
          <div style={{
            background: 'rgba(23, 23, 37, 0.8)',
            padding: 48,
            borderRadius: 24,
            border: '1px solid rgba(255, 255, 255, 0.1)',
            textAlign: 'center',
            maxWidth: 450,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 24,
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
          }}>
            <Loader className="animate-spin" size={48} color={isPurging || isEmergencyPurging ? 'var(--accent-red)' : 'var(--accent-primary)'} />
            <div>
              <h3 style={{ fontSize: 22, fontWeight: 900, color: 'white', marginBottom: 8 }}>
                {isPurging || isEmergencyPurging ? 'Purge des données en cours...' : 'Importation en cours...'}
              </h3>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 1.6 }}>
                {isPurging || isEmergencyPurging 
                  ? "Veuillez patienter pendant la réinitialisation de la base de données locale. Ne fermez pas l'application."
                  : "Veuillez patienter pendant l'injection et la réindexation. Pour éviter tout dysfonctionnement, ne fermez pas l'application."}
              </p>
            </div>
            <div style={{ width: '100%', background: 'rgba(255,255,255,0.05)', borderRadius: 10, height: 12, overflow: 'hidden' }}>
              <div style={{
                background: isPurging || isEmergencyPurging ? 'var(--accent-red)' : 'var(--accent-primary)',
                width: `${isPurging || isEmergencyPurging ? purgeProgress : progress}%`,
                height: '100%',
                transition: 'width 0.3s ease-out'
              }} />
            </div>
            <span style={{ fontSize: 18, fontWeight: 900, color: 'white' }}>
              {isPurging || isEmergencyPurging ? purgeProgress : progress}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
