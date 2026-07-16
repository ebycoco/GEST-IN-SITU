import React, { useState, useEffect, useMemo } from 'react';
import { 
  RefreshCw, Terminal, AlertTriangle, ShieldAlert, 
  Trash2, Download, Search, CheckCircle2, Lock, X, Play, Shield,
  Eye, EyeOff
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';

interface LogEntry {
  id: number;
  login_user: string;
  action: string;
  details: string;
  timestamp: string;
}

export default function MaintenancePage() {
  const user = useAuthStore((s) => s.user);
  const activeSiteId = useAuthStore((s) => s.activeSiteId);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [filterLevel, setFilterLevel] = useState<'ALL' | 'ERROR' | 'WARN'>('ALL');
  const [autoRefresh, setAutoRefresh] = useState(true);
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{ problemDescription?: string; detailedExplanation?: string; prompt?: string } | null>(null);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [totalLogsCount, setTotalLogsCount] = useState(0);
  const ITEMS_PER_PAGE = 10;
  
  // Local Logs Purge states
  const [isPurgeLogsModalOpen, setIsPurgeLogsModalOpen] = useState(false);
  const [logsPassword, setLogsPassword] = useState('');
  const [purgingLogs, setPurgingLogs] = useState(false);
  const [showLogsPassword, setShowLogsPassword] = useState(false);

  // Cloud Purge states (using requested exact variables)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [cloudPassword, setCloudPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ message: string; type: 'error' | 'success' | null }>({
    message: '',
    type: null
  });
  const [cloudCartesCount, setCloudCartesCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState(true);

  const fetchCloudCount = async () => {
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (siteIdToUse && window.api?.sync?.getTotalCloudCartesCount) {
      const count = await window.api.sync.getTotalCloudCartesCount(Number(siteIdToUse));
      setCloudCartesCount(count);
      setIsOnline(count !== -1);
    }
  };

  const fetchLogs = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (window.api?.maintenance?.getLogs) {
        const offset = (currentPage - 1) * ITEMS_PER_PAGE;
        const res = await window.api.maintenance.getLogs(ITEMS_PER_PAGE, offset, debouncedSearchTerm, filterLevel);
        setLogs(res.logs || []);
        setTotalLogsCount(res.total || 0);
        if (!silent) {
          toast.success("Logs de diagnostic actualisés.");
        }
      }
    } catch (err: any) {
      console.error("Échec de la récupération des logs:", err);
      toast.error("Impossible de charger les logs de diagnostic.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Initial load and filter/pagination changes
  useEffect(() => {
    fetchLogs(true);
    fetchCloudCount();
  }, [activeSiteId, currentPage, filterLevel, debouncedSearchTerm]);

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setCurrentPage(1); // Reset page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset page on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [filterLevel]);

  // Auto refresh interval every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogs(true);
      fetchCloudCount();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, activeSiteId]);

  const totalPages = Math.ceil(totalLogsCount / ITEMS_PER_PAGE) || 1;

  const handleAnalyzeLogs = async () => {
    setIsAnalyzing(true);
    setAnalysisResult(null);
    try {
      if (window.api?.maintenance?.analyzeUploadedLogs) {
        const res = await window.api.maintenance.analyzeUploadedLogs();
        if (res.success) {
          setAnalysisResult({
            problemDescription: res.problemDescription,
            detailedExplanation: res.detailedExplanation,
            prompt: res.prompt
          });
          toast.success("Analyse terminée !");
        } else if (res.error !== 'canceled') {
          toast.error(`Erreur d'analyse : ${res.error}`);
        }
      }
    } catch (err: any) {
      toast.error(`Échec de l'analyse : ${err.message || err}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handlePurgeLogsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logsPassword.trim()) {
      toast.error("Veuillez entrer votre mot de passe.");
      return;
    }

    setPurgingLogs(true);
    try {
      if (window.api?.maintenance?.clearLogs) {
        const res = await window.api.maintenance.clearLogs(logsPassword, user);
        if (res.success) {
          toast.success("Journaux de diagnostic purgés localement.");
          setLogsPassword('');
          setIsPurgeLogsModalOpen(false);
          await fetchLogs(true);
        }
      }
    } catch (err: any) {
      toast.error(`Échec de la purge locale : ${err.message || err}`);
    } finally {
      setPurgingLogs(false);
    }
  };

  const handleCloudPurgeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage({ message: '', type: null });
    
    if (!cloudPassword.trim()) {
      setStatusMessage({ message: "Veuillez entrer votre mot de passe administrateur.", type: 'error' });
      return;
    }

    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      setStatusMessage({ message: "Aucun site actif sélectionné pour cette opération.", type: 'error' });
      return;
    }

    setIsProcessing(true);
    try {
      // 1. Password check
      if (window.api?.hierarchy?.verifyPassword) {
        const isPasswordValid = await window.api.hierarchy.verifyPassword(cloudPassword, "Purge Cloud", user?.login);
        if (!isPasswordValid) {
          setStatusMessage({ message: "Mot de passe incorrect.", type: 'error' });
          return;
        }
      }

      // 2. Cloud delete
      if (window.api?.maintenance?.clearCloudCartes) {
        const res = await window.api.maintenance.clearCloudCartes(Number(siteIdToUse), user);
        if (res.success) {
          toast.success("✅ Purge Cloud Supabase effectuée avec succès !");
          setCloudPassword('');
          setStatusMessage({ message: '', type: null });
          setIsModalOpen(false); // Only close modal on SUCCESS
          await fetchLogs(true);
        } else {
          setStatusMessage({ 
            message: (res as any).error || "La purge a été refusée par le serveur cloud.", 
            type: 'error' 
          });
        }
      }
    } catch (err: any) {
      const errMsg = err.message || String(err);
      setStatusMessage({ message: errMsg, type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const getBadgeColor = (action: string, details: string) => {
    const act = action.toUpperCase();
    const det = (details || '').toUpperCase();
    if (act.includes('ERROR') || act.includes('ECHEC') || act.includes('FAILURE') || det.includes('ERROR')) {
      return { text: '#f87171', bg: 'rgba(248, 113, 113, 0.1)', border: 'rgba(248, 113, 113, 0.25)' };
    }
    if (act.includes('WARN') || act.includes('WARNING') || act.includes('ALERT') || det.includes('WARN')) {
      return { text: '#fbbf24', bg: 'rgba(251, 191, 36, 0.1)', border: 'rgba(251, 191, 36, 0.25)' };
    }
    if (act.includes('SUCCESS') || act.includes('OK') || act.includes('VERIF')) {
      return { text: '#34d399', bg: 'rgba(52, 211, 153, 0.1)', border: 'rgba(52, 211, 153, 0.25)' };
    }
    return { text: '#a78bfa', bg: 'rgba(167, 139, 250, 0.1)', border: 'rgba(167, 139, 250, 0.25)' };
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: '100vh', padding: '24px 32px 80px' }}>
      
      {/* Dynamic Style Injection for Soleil styling */}
      <style dangerouslySetInnerHTML={{ __html: `
        .glass-card-soleil {
          background: rgba(26, 31, 74, 0.45);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 24px;
          transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), 
                      box-shadow 0.25s cubic-bezier(0.4, 0, 0.2, 1), 
                      border-color 0.25s ease;
        }
        .glass-card-soleil:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3), 0 0 15px rgba(255, 255, 255, 0.03);
          border-color: rgba(255, 255, 255, 0.15);
        }
        .btn-action-soleil {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--text-primary);
          padding: 10px 16px;
          border-radius: 10px;
          font-weight: 600;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .btn-action-soleil:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.2);
        }
        .btn-action-soleil:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn-danger-soleil {
          background: rgba(239, 68, 68, 0.15);
          border: 1px solid rgba(239, 68, 68, 0.3);
          color: #f87171;
        }
        .btn-danger-soleil:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.25);
          border-color: rgba(239, 68, 68, 0.5);
        }
        .active-filter-soleil {
          background: rgba(255, 255, 255, 0.15) !important;
          border-color: rgba(255, 255, 255, 0.3) !important;
        }
      ` }} />

      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', background: 'linear-gradient(135deg, #fff 30%, #a78bfa 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            Diagnostic & Maintenance
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 4 }}>
            Surveillance en temps réel des journaux système et outils de maintenance technique de la base.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-action-soleil" onClick={() => fetchLogs()} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Actualiser
          </button>
          
          <button className="btn-action-soleil" onClick={handleAnalyzeLogs} disabled={isAnalyzing}>
            <Search size={16} className={isAnalyzing ? 'animate-pulse' : ''} />
            {isAnalyzing ? "Analyse..." : "Analyser Logs Externes"}
          </button>



          <button className="btn-action-soleil btn-danger-soleil" onClick={() => setIsPurgeLogsModalOpen(true)}>
            <Trash2 size={16} />
            Purger Logs Locaux
          </button>
        </div>
      </div>

      {/* Main Glass Panel */}
      <div className="glass-card-soleil" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        
        {analysisResult && (
          <div style={{ background: 'rgba(99, 102, 241, 0.05)', border: '1px solid rgba(99, 102, 241, 0.2)', borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldAlert size={20} color="#818cf8" />
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#fff' }}>Résultat de l'analyse des logs</h3>
            </div>
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', margin: '0 0 4px 0' }}>Description du problème</h4>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{analysisResult.problemDescription}</p>
            </div>
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', margin: '0 0 4px 0' }}>Explication détaillée</h4>
              <pre style={{ fontSize: 12, color: '#94a3b8', margin: 0, padding: 12, background: 'rgba(0,0,0,0.2)', borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 150, overflowY: 'auto' }}>
                {analysisResult.detailedExplanation}
              </pre>
            </div>
            {analysisResult.prompt && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
                <button 
                  className="btn-action-soleil" 
                  style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.1)' }}
                  onClick={() => setAnalysisResult(null)}
                >
                  <X size={16} />
                  Réinitialiser
                </button>
                <button 
                  className="btn-action-soleil" 
                  style={{ background: 'var(--gradient-primary)', color: 'white', border: 'none' }}
                  onClick={() => setIsPromptModalOpen(true)}
                >
                  <Terminal size={16} />
                  Générer un prompt d'assistance IA
                </button>
              </div>
            )}
          </div>
        )}

        {/* Filters and Search Bar */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between', alignItems: 'center' }}>
          
          {/* Level filters and auto refresh checkbox */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, background: 'rgba(255, 255, 255, 0.03)', padding: 4, borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <button 
                className={`btn-action-soleil ${filterLevel === 'ALL' ? 'active-filter-soleil' : ''}`} 
                style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'transparent' }}
                onClick={() => setFilterLevel('ALL')}
              >
                Tous
              </button>
              <button 
                className={`btn-action-soleil ${filterLevel === 'ERROR' ? 'active-filter-soleil' : ''}`} 
                style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: '#f87171' }}
                onClick={() => setFilterLevel('ERROR')}
              >
                <ShieldAlert size={14} style={{ marginRight: 4 }} />
                Erreurs (ERROR)
              </button>
              <button 
                className={`btn-action-soleil ${filterLevel === 'WARN' ? 'active-filter-soleil' : ''}`} 
                style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'transparent', color: '#fbbf24' }}
                onClick={() => setFilterLevel('WARN')}
              >
                <AlertTriangle size={14} style={{ marginRight: 4 }} />
                Alertes (WARN)
              </button>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={autoRefresh} 
                onChange={(e) => setAutoRefresh(e.target.checked)} 
                style={{ accentColor: '#a78bfa' }}
              />
              Rafraîchir automatiquement (10s)
            </label>
          </div>

          {/* Search box */}
          <div style={{ position: 'relative', minWidth: 260 }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="Rechercher par module, message, agent..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px 10px 38px',
                borderRadius: 10,
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#fff',
                fontSize: 13,
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = 'rgba(167, 139, 250, 0.4)'}
              onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.08)'}
            />
          </div>

        </div>

        {/* Logs Table */}
        <div style={{ overflowX: 'auto', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <th style={{ padding: '14px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Date & Heure</th>
                <th style={{ padding: '14px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Niveau/Module</th>
                <th style={{ padding: '14px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Agent</th>
                <th style={{ padding: '14px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>Message de diagnostic</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                      <Terminal size={32} style={{ opacity: 0.3 }} />
                      <span>Aucun log correspondant aux filtres.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const badge = getBadgeColor(log.action, log.details);
                  return (
                    <tr key={log.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.01)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '12px 16px', color: '#e2e8f0', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                        {log.timestamp ? new Date(log.timestamp).toLocaleString('fr-FR') : 'N/A'}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          color: badge.text,
                          backgroundColor: badge.bg,
                          border: `1px solid ${badge.border}`
                        }}>
                          {log.action}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#cbd5e1', fontWeight: 500 }}>
                        {log.login_user || 'system'}
                      </td>
                      <td style={{ padding: '12px 16px', color: '#94a3b8', wordBreak: 'break-all' }}>
                        {log.details || <span style={{ fontStyle: 'italic', opacity: 0.4 }}>Aucun détail disponible</span>}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button 
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', color: currentPage === 1 ? 'rgba(255,255,255,0.2)' : '#fff', border: 'none', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
          >
            Précédent
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: 13, alignSelf: 'center' }}>
            Page {currentPage} sur {totalPages > 0 ? totalPages : 1}
          </span>
          <button 
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage >= totalPages}
            style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', color: currentPage >= totalPages ? 'rgba(255,255,255,0.2)' : '#fff', border: 'none', cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer' }}
          >
            Suivant
          </button>
        </div>

        {/* Counter Footer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
          <span>Affichage de {logs.length} sur {totalLogsCount} logs filtrés</span>
          <span>Affichage de l'ensemble de l'historique des logs</span>
        </div>

      </div>

      {/* Cloud Purge Password Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 110000,
          backgroundColor: 'rgba(5, 7, 12, 0.75)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }}>
          <div className="glass-card-soleil animate-scale-up" style={{
            maxWidth: 460,
            width: '100%',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            boxShadow: '0 10px 40px rgba(239, 68, 68, 0.15)',
            padding: 28,
            display: 'flex',
            flexDirection: 'column',
            gap: 20
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Shield size={20} color="#f87171" />
                <h3 style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>Confirmation Purge Supabase</h3>
              </div>
              <button 
                onClick={() => { setIsModalOpen(false); setCloudPassword(''); setStatusMessage({ message: '', type: null }); }} 
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                disabled={isProcessing}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: '1.5' }}>
              Cette action supprimera définitivement toutes les cartes du site actuel sur <strong>Supabase Cloud</strong>. Saisissez votre mot de passe pour autoriser cette opération.
            </p>

            {statusMessage.message && (
              <div style={{
                background: statusMessage.type === 'error' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(52, 211, 153, 0.15)',
                border: statusMessage.type === 'error' ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(52, 211, 153, 0.3)',
                borderRadius: 8,
                padding: 12,
                color: statusMessage.type === 'error' ? '#f87171' : '#34d399',
                fontSize: 12.5,
                wordBreak: 'break-word',
                fontFamily: 'monospace'
              }}>
                <strong style={{ display: 'block', marginBottom: 4 }}>
                  {statusMessage.type === 'error' ? 'Erreur de purge :' : 'Succès :'}
                </strong>
                {statusMessage.message}
              </div>
            )}

            <form onSubmit={handleCloudPurgeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ position: 'relative' }}>
                <input 
                  type={showPassword ? "text" : "password"} 
                  placeholder="Mot de passe administrateur" 
                  value={cloudPassword}
                  onChange={(e) => setCloudPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 40px 10px 12px',
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#fff',
                    outline: 'none'
                  }}
                  autoFocus
                  disabled={isProcessing}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0
                  }}
                  disabled={isProcessing}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button 
                  type="button" 
                  className="btn-action-soleil" 
                  onClick={() => { setIsModalOpen(false); setCloudPassword(''); setStatusMessage({ message: '', type: null }); }}
                  disabled={isProcessing}
                >
                  Annuler
                </button>
                <button 
                  type="submit" 
                  className="btn-action-soleil btn-danger-soleil"
                  disabled={isProcessing}
                  style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', border: '1px solid rgba(239, 68, 68, 0.4)' }}
                >
                  {isProcessing ? "Vérification..." : "Vérifier et Purger Cloud"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Local Logs Purge Password Modal */}
      {isPurgeLogsModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 110000,
          backgroundColor: 'rgba(5, 7, 12, 0.75)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }}>
          <div className="glass-card-soleil animate-scale-up" style={{
            maxWidth: 440,
            width: '100%',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            boxShadow: '0 10px 40px rgba(239, 68, 68, 0.1)',
            padding: 28,
            display: 'flex',
            flexDirection: 'column',
            gap: 20
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Lock size={20} color="#f87171" />
                <h3 style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>Purge des logs locaux</h3>
              </div>
              <button 
                onClick={() => { setIsPurgeLogsModalOpen(false); setLogsPassword(''); }} 
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                disabled={purgingLogs}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: '1.5' }}>
              Cette opération videra définitivement le journal des événements local (`t_logs`). Veuillez entrer votre mot de passe pour confirmer cette action.
            </p>

            <form onSubmit={handlePurgeLogsSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ position: 'relative' }}>
                <input 
                  type={showLogsPassword ? "text" : "password"} 
                  placeholder="Mot de passe administrateur" 
                  value={logsPassword}
                  onChange={(e) => setLogsPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 40px 10px 12px',
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#fff',
                    outline: 'none'
                  }}
                  autoFocus
                  disabled={purgingLogs}
                />
                <button
                  type="button"
                  onClick={() => setShowLogsPassword(!showLogsPassword)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0
                  }}
                  disabled={purgingLogs}
                >
                  {showLogsPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                <button 
                  type="button" 
                  className="btn-action-soleil" 
                  onClick={() => { setIsPurgeLogsModalOpen(false); setLogsPassword(''); }}
                  disabled={purgingLogs}
                >
                  Annuler
                </button>
                <button 
                  type="submit" 
                  className="btn-action-soleil btn-danger-soleil"
                  disabled={purgingLogs}
                >
                  {purgingLogs ? "Purge..." : "Confirmer la Purge"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Prompt Modal */}
      {isPromptModalOpen && analysisResult?.prompt && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 110000, backgroundColor: 'rgba(5, 7, 12, 0.75)', backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="glass-card-soleil animate-scale-up" style={{
            maxWidth: 600, width: '100%', border: '1px solid rgba(99, 102, 241, 0.3)',
            boxShadow: '0 10px 40px rgba(99, 102, 241, 0.15)', padding: 28, display: 'flex', flexDirection: 'column', gap: 20
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Terminal size={20} color="#818cf8" />
                <h3 style={{ fontSize: 18, fontWeight: 600, color: '#fff' }}>Prompt pour l'agent IA</h3>
              </div>
              <button 
                onClick={() => setIsPromptModalOpen(false)} 
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>
            
            <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: '1.5', margin: 0 }}>
              Copiez ce prompt et collez-le dans votre discussion avec l'agent IA pour l'aider à résoudre le problème.
            </p>

            <textarea
              readOnly
              value={analysisResult.prompt}
              style={{
                width: '100%', height: 200, padding: 12, borderRadius: 8,
                background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff', fontSize: 12, fontFamily: 'monospace', resize: 'none'
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn-action-soleil" onClick={() => setIsPromptModalOpen(false)}>Fermer</button>
              <button 
                className="btn-action-soleil"
                style={{ background: 'rgba(52, 211, 153, 0.15)', color: '#34d399', borderColor: 'rgba(52, 211, 153, 0.3)' }}
                onClick={() => {
                  navigator.clipboard.writeText(analysisResult.prompt!);
                  toast.success("Prompt copié dans le presse-papiers !");
                  setIsPromptModalOpen(false);
                }}
              >
                <CheckCircle2 size={16} />
                Copier le prompt
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
