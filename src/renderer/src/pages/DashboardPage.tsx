import { useEffect, useState } from 'react';
import { 
  CreditCard, 
  Package, 
  Truck, 
  AlertTriangle, 
  BarChart3, 
  Activity,
  Trash2,
  Database,
  ShieldAlert,
  Globe,
  Users,
  Key,
  RefreshCw,
  Power,
  ChevronRight,
  Plus,
  MapPin
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { toast } from 'react-hot-toast';

interface Stats {
  total: number;
  en_stock: number;
  distribuees: number;
  absentes: number;
  doublons_stricts: number;
  sans_num_secu: number;
  sans_rangement: number;
  dates_invalides: number;
  distribParJour: { jour: string; count: number }[];
  distribParCentre: { centre: string; count: number }[];
}

interface GlobalStats {
  total_sites: number;
  active_sites: number;
  total_cartes: number;
  total_agents: number;
}

interface SiteSummary {
  id: number;
  nom: string;
  code_site: string;
  code?: string;
  is_active: number;
  total_centres: number;
  total_cartes: number;
  admin_login: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [resetPassModal, setResetPassModal] = useState<{ isOpen: boolean, site: SiteSummary | null, newPass: string }>({ isOpen: false, site: null, newPass: '' });
  const [confirmStatusModal, setConfirmStatusModal] = useState<{ isOpen: boolean, site: SiteSummary | null }>({ isOpen: false, site: null });
  const [newSite, setNewSite] = useState({
    nom: '',
    code: '',
    max_centres: 4,
    adminNom: '',
    adminLogin: '',
    adminPass: ''
  });
  const { user, activeSiteId } = useAuthStore();
  
  // États pour le bulk upload initial
  const [bulkProgress, setBulkProgress] = useState<number>(-1);
  const [isBulkUploading, setIsBulkUploading] = useState<boolean>(false);

  // États pour la Synchronisation Forcée Globale Super Admin
  const [isForceSyncing, setIsForceSyncing] = useState<boolean>(false);
  const [forceSyncResult, setForceSyncResult] = useState<{ success: boolean; counts: { sites: number; centres: number; users: number } } | null>(null);

  // État pour la Synchronisation Forcée du Site Admin
  const [isSiteSyncing, setIsSiteSyncing] = useState<boolean>(false);

  const handleForceSiteSync = async () => {
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      toast.error("Aucun site actif sélectionné pour la synchronisation.");
      return;
    }

    setIsSiteSyncing(true);
    const toastId = toast.loading('☁️ Synchronisation forcée des données du site...');

    try {
      const res = await (window.api.sync as any).forceSite(Number(siteIdToUse));
      if (res.success) {
        toast.success(
          `✅ Synchronisation du site réussie ! ${res.counts.users} agent(s) et ${res.counts.cards} carte(s) traités.`,
          { id: toastId, duration: 6000 }
        );
        if (stats) loadStats(); // Recharger les stats locales
      } else {
        toast.error(`Sync partielle : ${res.errors.join(', ')}`, { id: toastId, duration: 8000 });
      }
    } catch (err: any) {
      toast.error(`Échec synchronisation site : ${err.message || err}`, { id: toastId });
    } finally {
      setIsSiteSyncing(false);
    }
  };

  useEffect(() => {
    // Écouter la progression du bulk upload
    const unsubscribe = window.api.sync.onBulkProgress((progress: number) => {
      setBulkProgress(progress);
      if (progress >= 100) {
        setIsBulkUploading(false);
        setBulkProgress(-1);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const isGovernanceView = user?.role === 'SUPER ADMIN' && !activeSiteId;

  useEffect(() => {
    if (isGovernanceView) {
      loadGlobalData();
    } else {
      loadStats();
    }
  }, [activeSiteId, isGovernanceView]);

  const loadGlobalData = async () => {
    try {
      setLoading(true);
      const [gStats, sList] = await Promise.all([
        window.api.stats.getGlobal(),
        window.api.hierarchy.getSitesSummary()
      ]);
      setGlobalStats(gStats);
      setSites(sList);
    } catch (e) {
      console.error(e);
      toast.error("Erreur lors du chargement des données globales.");
    } finally {
      setLoading(false);
    }
  };

  // États pour l'Opérateur de Saisie
  const [operatorTodayCount, setOperatorTodayCount] = useState<number>(0);
  const [operatorRecentSaisies, setOperatorRecentSaisies] = useState<any[]>([]);

  // États pour la Supervision Saisie de l'Admin
  const [siteSaisiesStats, setSiteSaisiesStats] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'system' | 'supervision'>('system');

  const loadStats = async () => {
    try {
      setLoading(true);
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      
      if (user?.role === 'OPERATEUR_SAISIE') {
        const [todayCount, recents] = await Promise.all([
          window.api.stats.getAgentToday(user.id_user),
          window.api.stats.getAgentRecentSaisies(user.id_user, 15)
        ]);
        setOperatorTodayCount(todayCount);
        setOperatorRecentSaisies(recents);
      } else {
        const data = await window.api.stats.get(siteIdToUse || undefined);
        setStats(data);
        
        if (siteIdToUse && (user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'SUPER ADMIN')) {
          const saisiesToday = await window.api.stats.getSiteSaisieToday(siteIdToUse);
          setSiteSaisiesStats(saisiesToday);
        }
      }
    } catch (e) { 
      console.error(e); 
    } finally { 
      setLoading(false); 
    }
  };

  const handleStartBulkUpload = async () => {
    if (isBulkUploading) return;
    
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      toast.error("Veuillez d'abord sélectionner un site actif.");
      return;
    }

    const confirm = window.confirm(
      "Êtes-vous sûr de vouloir lancer la synchronisation de masse vers le Cloud ? Cette opération peut prendre plusieurs minutes si vous avez des milliers de cartes en attente."
    );
    if (!confirm) return;

    setIsBulkUploading(true);
    setBulkProgress(0);
    const toastId = toast.loading("Initialisation du transfert de masse...");

    try {
      const res = await window.api.sync.startBulk(Number(siteIdToUse));
      if (res.success) {
        toast.success(res.message, { id: toastId });
        if (stats) loadStats(); // Recharger les statistiques locales
      } else {
        toast.error(res.message, { id: toastId });
      }
    } catch (err: any) {
      toast.error(`Échec du transfert : ${err.message || err}`, { id: toastId });
    } finally {
      setIsBulkUploading(false);
      setBulkProgress(-1);
    }
  };

  // État pour la modal de confirmation personnalisée "Plein Soleil"
  const [showSyncConfirmModal, setShowSyncConfirmModal] = useState<boolean>(false);

  const handleForceGlobalSync = async () => {
    setIsForceSyncing(true);
    setForceSyncResult(null);
    setShowSyncConfirmModal(false);
    const toastId = toast.loading('☁️ Synchronisation forcée en cours...');
    try {
      const result = await (window.api.sync as any).forceGlobal();
      if (result.success) {
        setForceSyncResult(result);
        toast.success(
          `✅ Sync réussi ! ${result.counts.sites} site(s), ${result.counts.centres} centre(s), ${result.counts.users} user(s) envoyés.`,
          { id: toastId, duration: 6000 }
        );
      } else {
        toast.error(`Sync partielle : ${result.errors.join(', ')}`, { id: toastId, duration: 8000 });
      }
    } catch (err: any) {
      toast.error(`Échec sync forcée : ${err.message || err}`, { id: toastId });
    } finally {
      setIsForceSyncing(false);
    }
  };

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      await window.api.hierarchy.createSite({
        nom: newSite.nom,
        code: newSite.code,
        max_centres: newSite.max_centres,
        admin: {
          nom: newSite.adminNom,
          login: newSite.adminLogin,
          password_hash: newSite.adminPass
        }
      });
      toast.success("Nouveau site déployé avec succès !");
      setShowCreateModal(false);
      setNewSite({ nom: '', code: '', max_centres: 4, adminNom: '', adminLogin: '', adminPass: '' });
      loadGlobalData();
    } catch (e: any) {
      toast.error("Erreur : " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetAdminPass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPassModal.site || !resetPassModal.newPass) return;
    try {
      setLoading(true);
      await window.api.hierarchy.resetAdminPassword(resetPassModal.site.id, resetPassModal.newPass);
      toast.success("Mot de passe réinitialisé avec succès.");
      setResetPassModal({ isOpen: false, site: null, newPass: '' });
    } catch (e) {
      toast.error("Erreur lors de la réinitialisation.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSiteStatus = async () => {
    if (!confirmStatusModal.site) return;
    try {
      setLoading(true);
      const newStatus = confirmStatusModal.site.is_active ? 0 : 1;
      await window.api.hierarchy.updateSite(confirmStatusModal.site.id, { is_active: newStatus });
      toast.success(`Site ${confirmStatusModal.site.nom} mis à jour.`);
      setConfirmStatusModal({ isOpen: false, site: null });
      loadGlobalData();
    } catch (e) {
      toast.error("Erreur lors de la mise à jour.");
    } finally {
      setLoading(false);
    }
  };

  const handleClearDatabase = async () => {
    const confirmed = window.confirm("ATTENTION : Êtes-vous absolument sûr de vouloir VIDER TOUTES LES CARTES ? Cette action est irréversible.");
    if (!confirmed) return;
    try {
      setLoading(true);
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const result = await window.api.maintenance.clearDatabaseCartes(siteIdToUse || undefined);
      if (result.success) {
        toast.success(`${result.count} cartes supprimées.`);
        loadStats();
      }
    } catch (e) {
      toast.error("Erreur lors du vidage de la base.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) return (
    <div className="dashboard-premium animate-fade-in" style={{ padding: '0 24px' }}>
      <div className="kpi-grid">
        {[1,2,3,4].map(i => <div key={i} className="skeleton skeleton-kpi" style={{ height: 140, borderRadius: 16 }} />)}
      </div>
      <div className="skeleton skeleton-chart" style={{ marginTop: 24, height: 400, borderRadius: 16 }} />
    </div>
  );

  if (isGovernanceView) {
    const gs = globalStats || { total_sites: 0, active_sites: 0, total_cartes: 0, total_agents: 0 };
    return (
      <div className="dashboard-premium animate-fade-in">
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <div className="premium-card premium-glass">
            <div className="kpi-premium-icon" style={{ background: 'linear-gradient(135deg, #6c63ff, #4834d4)' }}>
              <Globe size={28} color="white" />
            </div>
            <div>
              <div className="kpi-value-lg">{gs.total_sites}</div>
              <div className="kpi-label-muted">Sites Déployés</div>
            </div>
          </div>
          
          <div className="premium-card premium-glass">
            <div className="kpi-premium-icon" style={{ background: 'linear-gradient(135deg, #27ae60, #2ecc71)' }}>
              <Power size={28} color="white" />
            </div>
            <div>
              <div className="kpi-value-lg">{gs.active_sites}</div>
              <div className="kpi-label-muted">Sites Actifs</div>
            </div>
          </div>
          
          <div className="premium-card premium-glass">
            <div className="kpi-premium-icon" style={{ background: 'linear-gradient(135deg, #f39c12, #e67e22)' }}>
              <CreditCard size={28} color="white" />
            </div>
            <div>
              <div className="kpi-value-lg">{gs.total_cartes.toLocaleString('fr')}</div>
              <div className="kpi-label-muted">Cartes Globales</div>
            </div>
          </div>
          
          <div className="premium-card premium-glass">
            <div className="kpi-premium-icon" style={{ background: 'linear-gradient(135deg, #3498db, #2980b9)' }}>
              <Users size={28} color="white" />
            </div>
            <div>
              <div className="kpi-value-lg">{gs.total_agents}</div>
              <div className="kpi-label-muted">Agents Réseau</div>
            </div>
          </div>
        </div>

        {/* ─── BOUTON PLEIN SOLEIL : SYNCHRONISATION FORCÉE DU RÉSEAU ─── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 8,
        }}>
          <button
            id="btn-force-global-sync"
            onClick={() => setShowSyncConfirmModal(true)}
            disabled={isForceSyncing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 28px',
              borderRadius: 14,
              border: '2px solid #B8A800',
              background: isForceSyncing ? '#B8A800' : '#FFE600',
              color: '#1A1400',
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: '0.02em',
              cursor: isForceSyncing ? 'not-allowed' : 'pointer',
              boxShadow: isForceSyncing
                ? 'none'
                : '0 4px 24px rgba(255, 230, 0, 0.45), 0 2px 8px rgba(0,0,0,0.35)',
              transition: 'all 0.2s ease',
              opacity: isForceSyncing ? 0.75 : 1,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              if (!isForceSyncing) {
                (e.currentTarget as HTMLButtonElement).style.background = '#FFF176';
                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 32px rgba(255,230,0,0.65), 0 2px 8px rgba(0,0,0,0.4)';
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isForceSyncing) {
                (e.currentTarget as HTMLButtonElement).style.background = '#FFE600';
                (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 24px rgba(255,230,0,0.45), 0 2px 8px rgba(0,0,0,0.35)';
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)';
              }
            }}
          >
            {isForceSyncing ? (
              <>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1A1400" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ animation: 'spin 1s linear infinite' }}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                Synchronisation en cours...
              </>
            ) : (
              <>
                {/* Cloud Upload SVG */}
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1A1400" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="16 16 12 12 8 16" />
                  <line x1="12" y1="12" x2="12" y2="21" />
                  <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
                </svg>
                Synchronisation Forcée du Réseau
              </>
            )}
          </button>

          {/* Indicateur de résultat inline */}
          {forceSyncResult && !isForceSyncing && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 20px',
              background: 'rgba(39,174,96,0.12)',
              border: '1px solid rgba(39,174,96,0.35)',
              borderRadius: 12,
              color: '#2ecc71',
              fontSize: 13,
              fontWeight: 600,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>
                ✅ {forceSyncResult.counts.sites} site(s) &bull; {forceSyncResult.counts.centres} centre(s) &bull; {forceSyncResult.counts.users} admin(s) envoyés sur Supabase
              </span>
            </div>
          )}
        </div>
        {/* ─── FIN BOUTON PLEIN SOLEIL ─── */}

        <div className="premium-card premium-glass" style={{ padding: 0 }}>
          <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(108, 99, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(108, 99, 255, 0.2)' }}>
                <Globe size={20} color="var(--accent-primary)" />
              </div>
              <div>
                <span className="card-title" style={{ fontSize: 16, marginBottom: 2 }}>Gestion des Sites</span>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Gouvernance et déploiement de l'infrastructure</div>
              </div>
            </div>
            <button 
              className="btn-primary" 
              style={{ 
                padding: '10px 20px', 
                borderRadius: 12, 
                display: 'flex', 
                alignItems: 'center', 
                gap: 8,
                boxShadow: '0 4px 15px rgba(108, 99, 255, 0.3)',
                fontWeight: 700
              }}
              onClick={() => setShowCreateModal(true)}
            >
              <Plus size={18} /> Nouveau Site
            </button>
          </div>
          
          <div className="card-body" style={{ padding: 0 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 24 }}>Infrastructure / Site</th>
                  <th>Administrateur</th>
                  <th>Centres</th>
                  <th>Total Cartes</th>
                  <th>État / Statut</th>
                  <th style={{ textAlign: 'right', paddingRight: 24, width: 220 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.id}>
                    <td style={{ paddingLeft: 24, paddingTop: 16, paddingBottom: 16 }}>
                      <div style={{ fontWeight: 700, color: 'white', fontSize: 14 }}>{site.nom}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{site.code_site || site.code}</div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                          {site.admin_login?.substring(0, 2).toUpperCase() || '??'}
                        </div>
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {site.admin_login || <i style={{ color: 'var(--text-muted)', opacity: 0.5 }}>Non assigné</i>}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                        {site.total_centres}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
                      {site.total_cartes.toLocaleString('fr')}
                    </td>
                    <td>
                      <span className={`badge ${site.is_active ? 'badge-success' : 'badge-danger'}`} style={{ padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
                        {site.is_active ? 'ACTIF' : 'SUSPENDU'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', paddingRight: 24, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button 
                          title="Réinitialiser le mot de passe"
                          onClick={() => setResetPassModal({ isOpen: true, site, newPass: '' })}
                          style={{
                            background: 'rgba(108, 99, 255, 0.15)',
                            border: '1px solid rgba(108, 99, 255, 0.3)',
                            color: '#a5a0ff',
                            padding: '8px 14px',
                            borderRadius: '10px',
                            display: 'flex', alignItems: 'center', gap: '8px',
                            cursor: 'pointer',
                            fontSize: '12px', fontWeight: 700,
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => { 
                            e.currentTarget.style.background = 'rgba(108, 99, 255, 0.25)'; 
                            e.currentTarget.style.transform = 'translateY(-2px)'; 
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(108, 99, 255, 0.2)'; 
                          }}
                          onMouseLeave={(e) => { 
                            e.currentTarget.style.background = 'rgba(108, 99, 255, 0.15)'; 
                            e.currentTarget.style.transform = 'translateY(0)'; 
                            e.currentTarget.style.boxShadow = 'none'; 
                          }}
                        >
                          <Key size={14} /> Mdp.
                        </button>
                        <button 
                          title={site.is_active ? "Suspendre l'infrastructure" : "Activer l'infrastructure"}
                          onClick={() => setConfirmStatusModal({ isOpen: true, site })}
                          style={{
                            background: site.is_active ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                            border: `1px solid ${site.is_active ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                            color: site.is_active ? '#fca5a5' : '#6ee7b7',
                            padding: '8px 14px',
                            borderRadius: '10px',
                            display: 'flex', alignItems: 'center', gap: '8px',
                            cursor: 'pointer',
                            fontSize: '12px', fontWeight: 700,
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => { 
                            e.currentTarget.style.background = site.is_active ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)'; 
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = site.is_active ? '0 4px 12px rgba(239, 68, 68, 0.2)' : '0 4px 12px rgba(16, 185, 129, 0.2)';
                          }}
                          onMouseLeave={(e) => { 
                            e.currentTarget.style.background = site.is_active ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)'; 
                            e.currentTarget.style.transform = 'translateY(0)'; 
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                        >
                          {site.is_active ? <Power size={14} /> : <RefreshCw size={14} />}
                          {site.is_active ? "Suspendre" : "Activer"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {sites.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                      Aucun site n'est encore déployé.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>      {/* Modal de création de site - Design Fidèle à la Capture */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(8, 10, 20, 0.9)', backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{
            background: '#0f111a', 
            border: '1px solid #1e2235',
            width: '100%', maxWidth: 520, 
            borderRadius: 28,
            boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.7)',
            padding: '32px'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)'
                }}>
                  <Plus size={24} color="white" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'white', letterSpacing: '-0.01em' }}>Déploiement Nouveau Site</h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b' }}>Configurez les paramètres de la zone géographique</p>
                </div>
              </div>
              <button 
                onClick={() => setShowCreateModal(false)}
                style={{ background: '#1e2235', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 8, borderRadius: 12 }}
              >
                <Plus size={20} style={{ transform: 'rotate(45deg)' }} />
              </button>
            </div>
            
            <form onSubmit={handleCreateSite} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>NOM DE LA COMMUNE / VILLE</label>
                <input 
                  required type="text" placeholder="Ex: PLATEAU"
                  style={{ 
                    background: '#08090f', border: '1px solid #1e2235', borderRadius: 12, 
                    padding: '14px 18px', color: 'white', outline: 'none', fontSize: 14
                  }}
                  value={newSite.nom}
                  onChange={e => setNewSite({...newSite, nom: e.target.value})}
                />
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>CODE SYSTÈME (2-5 CAR.)</label>
                  <input 
                    required type="text" placeholder="Ex: PLT"
                    style={{ 
                      background: '#08090f', border: '1px solid #1e2235', borderRadius: 12, 
                      padding: '14px 18px', color: 'white', outline: 'none', fontSize: 14, textTransform: 'uppercase'
                    }}
                    value={newSite.code}
                    onChange={e => setNewSite({...newSite, code: e.target.value})}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>QUOTA DE CENTRES</label>
                  <input 
                    required type="number" min="1" max="10"
                    style={{ 
                      background: '#08090f', border: '1px solid #1e2235', borderRadius: 12, 
                      padding: '14px 18px', color: 'white', outline: 'none', fontSize: 14
                    }}
                    value={newSite.max_centres}
                    onChange={e => setNewSite({...newSite, max_centres: parseInt(e.target.value)})}
                  />
                </div>
              </div>

              {/* Configuration Administrateur Box */}
              <div style={{ 
                marginTop: 10, padding: '24px', background: 'rgba(30, 41, 59, 0.2)', 
                borderRadius: 20, border: '1px dashed #334155', display: 'flex', flexDirection: 'column', gap: 16
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <ShieldAlert size={18} color="#6366f1" />
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#6366f1', letterSpacing: '0.05em' }}>
                    CONFIGURATION ADMINISTRATEUR
                  </span>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>NOM COMPLET DU RESPONSABLE</label>
                  <input 
                    required type="text" placeholder="Ex: Koffi Kouassi"
                    style={{ 
                      background: '#08090f', border: '1px solid #1e2235', borderRadius: 12, 
                      padding: '14px 18px', color: 'white', outline: 'none', fontSize: 14
                    }}
                    value={newSite.adminNom || ''}
                    onChange={e => setNewSite({...newSite, adminNom: e.target.value})}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>IDENTIFIANT (LOGIN)</label>
                    <input 
                      required type="text" placeholder="admin_plateau"
                      style={{ 
                        background: '#08090f', border: '1px solid #1e2235', borderRadius: 12, 
                        padding: '14px 18px', color: 'white', outline: 'none', fontSize: 14
                      }}
                      value={newSite.adminLogin}
                      onChange={e => setNewSite({...newSite, adminLogin: e.target.value})}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>MOT DE PASSE INITIAL</label>
                    <input 
                      required type="password" placeholder="••••••••"
                      style={{ 
                        background: '#08090f', border: '1px solid #1e2235', borderRadius: 12, 
                        padding: '14px 18px', color: 'white', outline: 'none', fontSize: 14
                      }}
                      value={newSite.adminPass}
                      onChange={e => setNewSite({...newSite, adminPass: e.target.value})}
                    />
                  </div>
                </div>
              </div>

              {/* Footer Buttons */}
              <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
                <button 
                  type="button" onClick={() => setShowCreateModal(false)}
                  style={{ 
                    flex: 1, padding: '16px', background: '#1e2235', 
                    border: '1px solid #334155', borderRadius: 16, 
                    color: 'white', fontWeight: 700, cursor: 'pointer', fontSize: 14
                  }}
                >
                  Annuler
                </button>
                <button 
                  type="submit" disabled={loading}
                  style={{ 
                    flex: 1.5, padding: '16px', 
                    background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                    border: 'none', borderRadius: 16, 
                    color: 'white', fontWeight: 800, cursor: 'pointer', fontSize: 14,
                    boxShadow: '0 8px 20px rgba(79, 70, 229, 0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10
                  }}
                >
                  {loading ? (
                    <RefreshCw size={20} className="animate-spin" />
                  ) : (
                    'DÉPLOYER LE SITE'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Reset Password */}
      {resetPassModal.isOpen && resetPassModal.site && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(8, 10, 20, 0.9)', backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="animate-slide-up" style={{
            background: '#0f111a', border: '1px solid #1e2235',
            width: '100%', maxWidth: 400, borderRadius: 24, padding: '32px',
            boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.7)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(99, 102, 241, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Key size={24} color="#818cf8" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white' }}>Nouveau Mot de Passe</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b' }}>Pour {resetPassModal.site.nom} ({resetPassModal.site.admin_login})</p>
              </div>
            </div>
            
            <form onSubmit={handleResetAdminPass} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <input 
                autoFocus required type="password" placeholder="Saisir le nouveau mot de passe"
                style={{ background: '#08090f', border: '1px solid #1e2235', borderRadius: 12, padding: '14px 18px', color: 'white', outline: 'none', fontSize: 14 }}
                value={resetPassModal.newPass}
                onChange={e => setResetPassModal({...resetPassModal, newPass: e.target.value})}
              />
              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <button type="button" onClick={() => setResetPassModal({ isOpen: false, site: null, newPass: '' })} style={{ flex: 1, padding: '14px', background: '#1e2235', border: 'none', borderRadius: 12, color: 'white', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}>Annuler</button>
                <button type="submit" disabled={loading} style={{ flex: 1, padding: '14px', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', border: 'none', borderRadius: 12, color: 'white', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)' }}>{loading ? '...' : 'Valider'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirm Status */}
      {/* Modal Confirm Status */}
      {confirmStatusModal.isOpen && confirmStatusModal.site && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(8, 10, 20, 0.9)', backdropFilter: 'blur(10px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="animate-slide-up" style={{
            background: '#0f111a', border: '1px solid #1e2235',
            width: '100%', maxWidth: 400, borderRadius: 24, padding: '32px',
            boxShadow: '0 30px 60px -12px rgba(0, 0, 0, 0.7)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: confirmStatusModal.site.is_active ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={24} color={confirmStatusModal.site.is_active ? "#ef4444" : "#10b981"} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white' }}>Confirmation requise</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#64748b' }}>Voulez-vous {confirmStatusModal.site.is_active ? 'suspendre' : 'activer'} ce site ?</p>
              </div>
            </div>
            
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
              Le site <strong style={{ color: 'white' }}>{confirmStatusModal.site.nom}</strong> {confirmStatusModal.site.is_active ? "ne pourra plus se connecter et synchroniser ses données." : "sera à nouveau autorisé à se connecter et synchroniser."}
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setConfirmStatusModal({ isOpen: false, site: null })} style={{ flex: 1, padding: '14px', background: '#1e2235', border: 'none', borderRadius: 12, color: 'white', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' }}>Annuler</button>
              <button onClick={handleToggleSiteStatus} disabled={loading} style={{ flex: 1, padding: '14px', background: confirmStatusModal.site.is_active ? '#ef4444' : '#10b981', border: 'none', borderRadius: 12, color: 'white', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s', boxShadow: confirmStatusModal.site.is_active ? '0 4px 15px rgba(239, 68, 68, 0.3)' : '0 4px 15px rgba(16, 185, 129, 0.3)' }}>{loading ? '...' : 'Confirmer'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Custom Plein Soleil - Synchronisation Forcée Globale */}
      {showSyncConfirmModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1010,
          background: 'rgba(8, 10, 20, 0.92)', backdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div className="animate-slide-up" style={{
            background: '#1A1400', border: '3px solid #FFE600',
            width: '100%', maxWidth: 450, borderRadius: 28, padding: '36px',
            boxShadow: '0 30px 70px -10px rgba(0, 0, 0, 0.95), 0 0 40px rgba(255, 230, 0, 0.15)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: 'rgba(255, 230, 0, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255, 230, 0, 0.3)' }}>
                {/* Cloud Alert Icon */}
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FFE600" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#FFE600', letterSpacing: '0.02em' }}>SYNCHRONISATION FORCÉE</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#A09874', fontWeight: 600 }}>Action Super-Admin Globale</p>
              </div>
            </div>
            
            <p style={{ color: '#E0DBBC', fontSize: 14, marginBottom: 28, lineHeight: 1.6 }}>
              Cette action va pousser et écraser (upsert) <strong style={{ color: 'white' }}>l'intégralité des sites, des centres et des utilisateurs</strong> de la base locale directement sur Supabase.
            </p>

            <div style={{
              background: 'rgba(255, 230, 0, 0.05)',
              border: '1px solid rgba(255, 230, 0, 0.15)',
              borderRadius: 14,
              padding: 16,
              marginBottom: 28,
              fontSize: 13,
              color: '#FFE600',
              lineHeight: 1.5,
              fontWeight: 500
            }}>
              ⚠️ À utiliser pour synchroniser d'anciens sites/centres créés en local lors de vos tests précédents.
            </div>

            <div style={{ display: 'flex', gap: 14 }}>
              <button 
                onClick={() => setShowSyncConfirmModal(false)} 
                style={{ 
                  flex: 1, padding: '14px', 
                  background: '#2B230C', border: '1px solid #5C4F23', borderRadius: 14, 
                  color: '#E0DBBC', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                  fontSize: 14
                }}
              >
                Annuler
              </button>
              <button 
                onClick={handleForceGlobalSync} 
                style={{ 
                  flex: 1.5, padding: '14px', 
                  background: '#FFE600', border: 'none', borderRadius: 14, 
                  color: '#1A1400', fontWeight: 900, cursor: 'pointer', transition: 'all 0.2s',
                  boxShadow: '0 6px 20px rgba(255, 230, 0, 0.35)',
                  fontSize: 14
                }}
              >
                Confirmer l'envoi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

  // OPERATOR VIEW
  if (user?.role === 'OPERATEUR_SAISIE') {
    return (
      <div className="dashboard-premium animate-fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Welcoming header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 900, color: 'white', margin: 0 }}>TABLEAU DE BORD OPÉRATEUR</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>Suivi quotidien de vos performances de saisie de fiches.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.15)', padding: '10px 16px', borderRadius: 14 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffd700' }} className="animate-pulse" />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#ffd700' }}>SESSION ACTIVE</span>
          </div>
        </div>

        {/* Big Productive Counter */}
        <div className="premium-card premium-glass" style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '32px', background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.05) 0%, rgba(255, 215, 0, 0.01) 100%)', border: '1px solid rgba(255, 215, 0, 0.2)' }}>
          <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, #eccc68 0%, #ffd700 100%)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(255, 215, 0, 0.2)' }}>
            <Activity size={32} />
          </div>
          <div>
            <div style={{ fontSize: 36, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{operatorTodayCount}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#ffd700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Mes saisies aujourd'hui</div>
          </div>
        </div>

        {/* 15 Recent Actions Table */}
        <div className="premium-card premium-glass" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 16 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>Dernières fiches saisies (Max 15)</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Mise à jour en temps réel</span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>NOMS & PRÉNOMS</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>N° CMU</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>DATE DE NAISSANCE</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>RANGEMENT</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>STATUT</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>DATE SAISIE</th>
                </tr>
              </thead>
              <tbody>
                {operatorRecentSaisies.map((c) => (
                  <tr key={c.id_carte} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '14px 16px', fontWeight: 700, color: 'white' }}>{c.noms} {c.prenoms}</td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{c.num_secu || '—'}</td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{c.date_de_naissance || '—'}</td>
                    <td style={{ padding: '14px 16px', color: '#ffd700', fontWeight: 600 }}>{c.rangement || '—'}</td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', padding: '3px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>
                        {c.statut}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {new Date(c.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                  </tr>
                ))}
                {operatorRecentSaisies.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Vous n'avez pas encore saisi de cartes aujourd'hui.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // OPERATIONAL VIEW (Original)
  const s = stats || { total: 0, en_stock: 0, distribuees: 0, absentes: 0, doublons_stricts: 0, sans_num_secu: 0, sans_rangement: 0, dates_invalides: 0, distribParJour: [], distribParCentre: [] };
  const distributionRate = s.total > 0 ? Math.round((s.distribuees / s.total) * 100) : 0;
  
  const kpis = [
    { label: 'Total Cartes', value: (s.total || 0).toLocaleString('fr'), icon: CreditCard, color: '#3498db', gradient: 'linear-gradient(135deg, #3498db, #2980b9)' },
    { label: 'En Stock', value: (s.en_stock || 0).toLocaleString('fr'), icon: Package, color: '#f39c12', gradient: 'linear-gradient(135deg, #f39c12, #e67e22)' },
    { label: 'Distribuées', value: (s.distribuees || 0).toLocaleString('fr'), icon: Truck, color: '#27ae60', gradient: 'linear-gradient(135deg, #27ae60, #2ecc71)' },
    { label: 'Dates Non Conformes', value: (s.dates_invalides || 0).toLocaleString('fr'), icon: ShieldAlert, color: '#e74c3c', gradient: 'linear-gradient(135deg, #e74c3c, #c0392b)' },
    { label: 'Sans Rangement', value: (s.sans_rangement || 0).toLocaleString('fr'), icon: MapPin, color: '#9b59b6', gradient: 'linear-gradient(135deg, #9b59b6, #8e44ad)' }
  ];
 
  return (
    <div className="dashboard-premium animate-fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Switcher Tab for Administrateur */}
      {(user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'SUPER ADMIN') && (
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.05)', gap: 24, marginBottom: 8 }}>
          <button 
            onClick={() => setActiveTab('system')}
            style={{ padding: '12px 4px', background: 'transparent', border: 'none', borderBottom: activeTab === 'system' ? '2px solid #ffd700' : '2px solid transparent', color: activeTab === 'system' ? 'white' : 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
          >
            Indicateurs Système
          </button>
          <button 
            onClick={() => setActiveTab('supervision')}
            style={{ padding: '12px 4px', background: 'transparent', border: 'none', borderBottom: activeTab === 'supervision' ? '2px solid #ffd700' : '2px solid transparent', color: activeTab === 'supervision' ? 'white' : 'var(--text-muted)', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }}
          >
            Suivi de la Saisie (Opérateurs)
          </button>
        </div>
      )}

      {activeTab === 'supervision' ? (
        /* Supervision View for administrators */
        <div className="premium-card premium-glass" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'white' }}>Performance journalière des opérateurs de saisie</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Total des saisies effectuées aujourd'hui par chaque agent.</p>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }}>
                  <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>IDENTIFIANT</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>NOM COMPLET</th>
                  <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>SAISIES DU JOUR</th>
                </tr>
              </thead>
              <tbody>
                {siteSaisiesStats.map((agent) => (
                  <tr key={agent.id_user} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '14px 16px', fontWeight: 700, color: 'white' }}>{agent.login}</td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{agent.nom_user} {agent.prenom_user}</td>
                    <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 900, color: agent.total_saisies > 0 ? '#ffd700' : 'var(--text-muted)', fontSize: 15 }}>
                      {agent.total_saisies} fiches
                    </td>
                  </tr>
                ))}
                {siteSaisiesStats.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      Aucun opérateur de saisie n'est encore configuré sur ce site.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Regular KPIs and alerts */
        <>
          {/* Alertes & Anomalies (Affiché uniquement s'il y a des problèmes) */}
          {(s.doublons_stricts > 0 || s.sans_num_secu > 0 || s.dates_invalides > 0 || s.sans_rangement > 0) && (
            <div className="premium-card premium-glass" style={{ border: '1px solid rgba(231, 76, 60, 0.4)', background: 'rgba(231, 76, 60, 0.05)', padding: '20px 24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <AlertTriangle size={28} color="var(--accent-red)" className="animate-pulse" style={{ flexShrink: 0 }} />
                  <div>
                    <h3 style={{ color: 'var(--accent-red)', margin: 0, fontSize: 16, fontWeight: 700 }}>Attention Requise : Anomalies Détectées</h3>
                    <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>Des incohérences de données nécessitent une vérification par l'administrateur.</p>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingLeft: 44 }}>
                  {s.doublons_stricts > 0 && (
                    <div className="badge-alert" style={{ margin: 0 }}>
                      Doublons Stricts : {s.doublons_stricts.toLocaleString('fr')}
                    </div>
                  )}
                  {s.sans_num_secu > 0 && (
                    <div className="badge-alert" style={{ background: 'rgba(243, 156, 18, 0.15)', borderColor: 'rgba(243, 156, 18, 0.3)', color: 'var(--accent-orange)', margin: 0 }}>
                      Sans Num Sécu : {s.sans_num_secu.toLocaleString('fr')}
                    </div>
                  )}
                  {s.dates_invalides > 0 && (
                    <div className="badge-alert" style={{ background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171', margin: 0 }}>
                      Dates Invalides : {s.dates_invalides.toLocaleString('fr')}
                    </div>
                  )}
                  {s.sans_rangement > 0 && (
                    <div className="badge-alert" style={{ background: 'rgba(155, 89, 182, 0.15)', borderColor: 'rgba(155, 89, 182, 0.3)', color: '#c084fc', margin: 0 }}>
                      Sans Rangement : {s.sans_rangement.toLocaleString('fr')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Taux de Distribution Main KPI */}
          <div className="premium-card premium-glass" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
            <div>
              <h2 style={{ fontSize: 20, color: 'var(--text-white)', marginBottom: 8, fontWeight: 700 }}>Progression de la Distribution</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Taux d'achèvement par rapport au total des cartes reçues sur ce site.</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="kpi-value-lg" style={{ color: distributionRate > 50 ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
                {distributionRate}%
              </div>
            </div>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
              <div className="progress-premium-container" style={{ margin: 0, height: 6, borderRadius: 0 }}>
                <div className="progress-premium-fill" style={{ width: `${distributionRate}%`, background: distributionRate > 50 ? 'var(--accent-green)' : 'var(--accent-orange)' }} />
              </div>
            </div>
          </div>

          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {kpis.map((kpi, i) => {
              const Icon = kpi.icon;
              return (
                <div key={i} className="premium-card premium-glass">
                  <div className="kpi-premium-icon" style={{ background: kpi.gradient }}>
                    <Icon size={24} color="white" />
                  </div>
                  <div>
                    <div className="kpi-value-lg">{kpi.value}</div>
                    <div className="kpi-label-muted">{kpi.label}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div className="premium-card premium-glass">
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 16, marginBottom: 16 }}>
                <span style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Activity size={20} color="var(--accent-primary)" /> État du Système Local
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div style={{ padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
                  <h4 style={{ color: 'var(--text-secondary)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Base de données</h4>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>Connecté (SQLite)</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Site : {activeSiteId || 'Non défini'}</p>
                </div>
                <div style={{ padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
                  <h4 style={{ color: 'var(--text-secondary)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Session Active</h4>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>{user?.login}</p>
                  <p style={{ fontSize: 12, color: 'var(--accent-secondary)' }}>{user?.role}</p>
                </div>
              </div>
            </div>

            {/* Section Initialisation Cloud / Bulk Sync */}
            {(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE') && (activeSiteId || user?.site_id) && (
              <div className="premium-card premium-glass" style={{ border: '1px solid rgba(99, 102, 241, 0.3)', background: 'rgba(99, 102, 241, 0.05)' }}>
                <div style={{ borderBottom: '1px solid rgba(99, 102, 241, 0.1)', paddingBottom: 16, marginBottom: 16 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Globe size={20} /> Initialisation Cloud (Mass Upload)
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    Recommandé lors du premier déploiement ou après un import de masse. Pousse l'ensemble des cartes modifiées locales vers le cloud par blocs optimisés.
                  </p>

                  {bulkProgress >= 0 && (
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px', color: 'var(--text-muted)' }}>
                        <span>Progression du transfert...</span>
                        <span>{bulkProgress}%</span>
                      </div>
                      <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${bulkProgress}%`, background: 'var(--accent-primary)', transition: 'width 0.2s ease-in-out' }} />
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <button 
                      onClick={handleStartBulkUpload} 
                      disabled={isBulkUploading}
                      className="btn-primary" 
                      style={{ 
                        padding: '12px 24px', 
                        borderRadius: 12, 
                        fontWeight: 700,
                        backgroundColor: isBulkUploading ? 'var(--bg-secondary)' : 'var(--accent-primary)',
                        cursor: isBulkUploading ? 'not-allowed' : 'pointer',
                        boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <RefreshCw size={18} style={{ animation: isBulkUploading ? 'spin 1.5s linear infinite' : 'none' }} />
                      {isBulkUploading ? 'TRANSFERT EN COURS...' : 'POUSSER LES DONNÉES LOCALES'}
                    </button>

                    <button 
                      onClick={handleForceSiteSync} 
                      disabled={isSiteSyncing}
                      className="btn-plein-soleil" 
                      style={{ 
                        padding: '12px 24px', 
                        borderRadius: 12, 
                        fontWeight: 700,
                        backgroundColor: isSiteSyncing ? '#555555' : '#FFE600',
                        color: isSiteSyncing ? '#ffffff' : '#000000',
                        border: '1px solid #FFE600',
                        cursor: isSiteSyncing ? 'not-allowed' : 'pointer',
                        boxShadow: '0 4px 15px rgba(255, 230, 0, 0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'all 0.2s ease-in-out'
                      }}
                    >
                      <Globe size={18} style={{ animation: isSiteSyncing ? 'spin 1.5s linear infinite' : 'none' }} />
                      {isSiteSyncing ? 'SYNCHRONISATION EN COURS...' : 'SYNCHRONISER LES DONNÉES DU SITE'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {user?.role === 'SUPER ADMIN' && activeSiteId && (
              <div className="premium-card premium-glass" style={{ border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.05)' }}>
                <div style={{ borderBottom: '1px solid rgba(239, 68, 68, 0.1)', paddingBottom: 16, marginBottom: 16 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ShieldAlert size={20} /> Zone de Maintenance (Site Actif)
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                    La réinitialisation supprimera <strong>définitivement</strong> toutes les cartes liées à ce site. Les centres et les agents seront conservés.
                  </p>
                  <button 
                    onClick={handleClearDatabase} 
                    className="btn-danger" 
                    style={{ padding: '12px 24px', alignSelf: 'flex-start', borderRadius: 12, fontWeight: 700, boxShadow: '0 4px 15px rgba(239, 68, 68, 0.3)' }}
                  >
                    <Trash2 size={18} /> PURGER LES CARTES DU SITE
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
