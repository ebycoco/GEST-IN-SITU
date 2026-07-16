import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CreditCard, 
  Package, 
  Truck, 
  AlertTriangle, 
  Activity, 
  Trash2, 
  Database, 
  Globe, 
  RefreshCw, 
  ShieldAlert, 
  MapPin, 
  Info,
  Eye,
  EyeOff,
  GitMerge,
  LayoutDashboard,
  FileText,
  Search,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface SiteAdminViewProps {
  stats: any;
  siteSaisiesStats: any[];
  siteQualiteStats: any[];
  siteLogistiqueStats: any[];
  dirtyCartesCount: number;
  dirtyUsersCount: number;
  cloudCartesCount: number;
  totalCloudCartesCount?: number;
  detailedSyncStats: { cleanCount: number, probableCount: number, strictCount: number, invalidCount: number } | null;
  isOnline: boolean;
  user: any;
  activeSiteId: number | null;
  loadStats: (silent?: boolean, supervisionFilters?: { centreId?: number; agentId?: number; dateStr?: string }) => Promise<void>;
  isSiteSyncing: boolean;
  isSyncingAgents: boolean;
  isPullingCards?: boolean;
  isBulkUploading?: boolean;
  bulkProgress?: number;
  downstreamProgress?: number;
  handleForceSiteSync: () => Promise<void>;
  handleForceAgentsSync: () => Promise<void>;
  handlePullSiteCards?: () => Promise<void>;
  handleStartBulkUpload?: (forceProbable?: boolean, forceInvalid?: boolean) => Promise<any>;
  isClearingCloud?: boolean;
  purgeCloudProgress?: number;
  handleClearCloudDatabase?: () => Promise<void>;
  isBackgroundPulling?: boolean;
  downstreamInfo?: { progress: number; merged: number; total: number } | null;
}

export function SiteAdminView({
  stats,
  siteSaisiesStats,
  siteQualiteStats,
  siteLogistiqueStats,
  dirtyCartesCount,
  dirtyUsersCount,
  cloudCartesCount,
  totalCloudCartesCount = 0,
  detailedSyncStats,
  isOnline,
  user,
  activeSiteId,
  loadStats,
  isSiteSyncing,
  isSyncingAgents,
  isPullingCards = false,
  isBulkUploading = false,
  bulkProgress = -1,
  downstreamProgress = -1,
  purgeCloudProgress = -1,
  handleForceSiteSync,
  handleForceAgentsSync,
  handlePullSiteCards = async () => {},
  handleStartBulkUpload = async () => ({ success: false, message: "" }),
  isClearingCloud = false,
  handleClearCloudDatabase = async () => {},
  isBackgroundPulling = false,
  downstreamInfo = null,
}: SiteAdminViewProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'system' | 'supervision'>('system');
  const [centres, setCentres] = React.useState<any[]>([]);
  const [selectedCentreId, setSelectedCentreId] = React.useState<string>(
    user?.role === 'ADMIN_CENTRE' ? String(user.centre_id) : ''
  );
  
  // Nouveaux filtres de pilotage de terrain
  const [selectedAgentId, setSelectedAgentId] = React.useState<string>('');
  const [selectedDate, setSelectedDate] = React.useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [siteAgents, setSiteAgents] = React.useState<any[]>([]);

  React.useEffect(() => {
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (siteIdToUse) {
      window.api.hierarchy.getCentres(siteIdToUse).then(setCentres).catch(console.error);
      window.api.users.getAll(siteIdToUse).then(setSiteAgents).catch(console.error);
    }
  }, [activeSiteId, user]);

  // Déclencheur de chargement réactif des statistiques avec filtres
  React.useEffect(() => {
    if (activeTab === 'supervision') {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      if (siteIdToUse) {
        const centreId = user?.role === 'ADMIN_CENTRE' 
          ? Number(user.centre_id) 
          : (selectedCentreId ? Number(selectedCentreId) : undefined);
        const agentId = selectedAgentId ? Number(selectedAgentId) : undefined;
        const dateStr = selectedDate || undefined;

        loadStats(true, { centreId, agentId, dateStr }).catch(console.error);
      }
    }
  }, [activeTab, selectedCentreId, selectedAgentId, selectedDate, activeSiteId, user]);

  // Filtrer les agents affichés dans le sélecteur d'agent en fonction du centre sélectionné
  const filteredAgentsForSelect = React.useMemo(() => {
    const centreToFilter = user?.role === 'ADMIN_CENTRE' ? user.centre_id : (selectedCentreId ? Number(selectedCentreId) : null);
    if (centreToFilter) {
      return siteAgents.filter(a => a.centre_id === centreToFilter);
    }
    return siteAgents;
  }, [siteAgents, selectedCentreId, user]);

  const filteredSaisies = React.useMemo(() => {
    if (user?.role === 'ADMIN_CENTRE') {
      return siteSaisiesStats.filter(agent => agent.centre_id === user.centre_id);
    }
    if (selectedCentreId) {
      return siteSaisiesStats.filter(agent => agent.centre_id === Number(selectedCentreId));
    }
    return siteSaisiesStats;
  }, [siteSaisiesStats, selectedCentreId, user]);

  const filteredQualite = React.useMemo(() => {
    if (user?.role === 'ADMIN_CENTRE') {
      return siteQualiteStats.filter(agent => agent.centre_id === user.centre_id);
    }
    if (selectedCentreId) {
      return siteQualiteStats.filter(agent => agent.centre_id === Number(selectedCentreId));
    }
    return siteQualiteStats;
  }, [siteQualiteStats, selectedCentreId, user]);

  const filteredLogistique = React.useMemo(() => {
    if (user?.role === 'ADMIN_CENTRE') {
      return siteLogistiqueStats.filter(agent => agent.centre_id === user.centre_id);
    }
    if (selectedCentreId) {
      return siteLogistiqueStats.filter(agent => agent.centre_id === Number(selectedCentreId));
    }
    return siteLogistiqueStats;
  }, [siteLogistiqueStats, selectedCentreId, user]);

  const [supervisionTab, setSupervisionTab] = useState<'saisie' | 'qualite' | 'logistique'>('saisie');
  const [isQuickAccessVisible, setIsQuickAccessVisible] = useState(false);

  const [loading, setLoading] = useState(false);
  const [syncAlert, setSyncAlert] = useState<{
    status: 'BLOCKED_STRICT' | 'BLOCKED_PROBABLE' | 'BLOCKED_INVALID';
    count: number;
    message: string;
  } | null>(null);

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    isDanger?: boolean;
    requireInput?: string;
    isPassword?: boolean;
    confirmText?: string;
    onConfirm: (inputVal: string) => void;
  } | null>(null);
  const [confirmInputVal, setConfirmInputVal] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const openConfirmModal = (config: {
    title: string;
    message: string;
    isDanger?: boolean;
    requireInput?: string;
    isPassword?: boolean;
    confirmText?: string;
    onConfirm: (inputVal: string) => void;
  }) => {
    setConfirmInputVal('');
    setShowConfirmPassword(false);
    setConfirmModal({
      isOpen: true,
      ...config
    });
  };

  // Nettoyer l'état d'alerte lors du démontage du composant
  React.useEffect(() => {
    return () => {
      setSyncAlert(null);
      setConfirmModal(null);
    };
  }, []);

  const handleStartBulkUploadClick = async (forceProbable = false, forceInvalid = false) => {
    if (isBulkUploading) return;
    
    setSyncAlert(null);
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      toast.error("Veuillez d'abord sélectionner un site actif.");
      return;
    }

    const triggerUpload = async () => {
      try {
        const res = await handleStartBulkUpload(forceProbable, forceInvalid);
        if (!res.success && res.status) {
          setSyncAlert({
            status: res.status,
            count: res.count || 0,
            message: res.message
          });
        }
      } catch (err: any) {
        toast.error(`Échec du transfert : ${err.message || err}`);
      }
    };

    if (!forceProbable && !forceInvalid) {
      openConfirmModal({
        title: "Transfert de Masse Cloud",
        message: "Êtes-vous sûr de vouloir lancer la synchronisation de masse vers le Cloud ? Cette opération peut prendre plusieurs minutes si vous avez beaucoup de cartes en attente.",
        onConfirm: triggerUpload
      });
    } else {
      await triggerUpload();
    }
  };

  const handleClearDatabase = async () => {
    openConfirmModal({
      title: "Purger la Base Locale",
      message: "ATTENTION : Veuillez saisir votre mot de passe administrateur pour VIDER TOUTES LES CARTES de ce PC. Cette action est définitive et irréversible.",
      isDanger: true,
      isPassword: true,
      confirmText: "Vérifier et Purger",
      onConfirm: async (inputVal: string) => {
        try {
          setLoading(true);
          const isCorrect = await window.api.hierarchy.verifyPassword(inputVal, "Purge de la base locale de cartes", user?.login);
          if (!isCorrect) {
            toast.error("❌ Mot de passe administrateur incorrect. Action annulée.");
            setLoading(false);
            return;
          }

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
      }
    });
  };

  const handleClearCloudDatabaseClick = () => {
    openConfirmModal({
      title: "Purge Cloud Supabase",
      message: "🛑 ATTENTION CLOUD : Veuillez saisir votre mot de passe administrateur pour VIDER TOUTES LES CARTES de Supabase pour ce site.",
      isDanger: true,
      isPassword: true,
      confirmText: "Vérifier et Purger Cloud",
      onConfirm: async (inputVal: string) => {
        console.log("[SiteAdminView][DEBUG] Tentative de vérification du mot de passe pour la purge Cloud...");
        try {
          setLoading(true);
          const isCorrect = await window.api.hierarchy.verifyPassword(inputVal, "Purge cloud Supabase", user?.login);
          if (!isCorrect) {
            toast.error("❌ Mot de passe administrateur incorrect. Action annulée.");
            setLoading(false);
            return;
          }

          // Fermer la modal de confirmation uniquement après validation correcte du mot de passe
          setConfirmModal(null);
          setConfirmInputVal('');

          if (handleClearCloudDatabase) {
            await handleClearCloudDatabase();
          }
        } catch (e) {
          toast.error("Erreur lors de la purge cloud.");
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const s = stats || { total: 0, en_stock: 0, distribuees: 0, absentes: 0, doublons_stricts: 0, doublons_probables: 0, sans_num_secu: 0, sans_rangement: 0, sans_nom: 0, sans_prenom: 0, dates_invalides: 0, distribParJour: [], distribParCentre: [] };
  const totalAnomalies = (s.doublons_stricts || 0) + (s.doublons_probables || 0) + (s.dates_invalides || 0) + (s.sans_num_secu || 0) + (s.sans_rangement || 0) + (s.sans_nom || 0) + (s.sans_prenom || 0);
  const autoClearableAnomalies = (s.dates_invalides || 0) + (s.sans_num_secu || 0) + (s.sans_rangement || 0) + (s.sans_nom || 0) + (s.sans_prenom || 0);
  const distributionRate = s.total > 0 ? Math.round((s.distribuees / s.total) * 100) : 0;
  
  const cleanCount = detailedSyncStats?.cleanCount || 0;
  const probableCount = detailedSyncStats?.probableCount || 0;
  const strictCount = detailedSyncStats?.strictCount || 0;
  const invalidCount = detailedSyncStats?.invalidCount || 0;
  const totalSyncableCards = cleanCount + probableCount + strictCount + invalidCount;

  let uploadBtnLabel = 'ENVOYER LES CARTES VERS LE CLOUD';
  if (totalSyncableCards > 0) {
    const parts: string[] = [];
    if (cleanCount > 0) parts.push(`${cleanCount.toLocaleString('fr')} Parfaites`);
    if (probableCount > 0) parts.push(`${probableCount.toLocaleString('fr')} Probables`);
    if (strictCount > 0) parts.push(`${strictCount.toLocaleString('fr')} Stricts`);
    if (invalidCount > 0) parts.push(`${invalidCount.toLocaleString('fr')} Invalides`);
    uploadBtnLabel += ` (${parts.join(', ')})`;
  }
  const kpis = [
    { label: 'Total Cartes', value: (s.total || 0).toLocaleString('fr'), icon: CreditCard, color: '#3498db', gradient: 'linear-gradient(135deg, #3498db, #2980b9)', tabKey: null },
    { label: 'En Stock', value: (s.en_stock || 0).toLocaleString('fr'), icon: Package, color: '#f39c12', gradient: 'linear-gradient(135deg, #f39c12, #e67e22)', tabKey: null },
    { label: 'Distribuées', value: (s.distribuees || 0).toLocaleString('fr'), icon: Truck, color: '#27ae60', gradient: 'linear-gradient(135deg, #27ae60, #2ecc71)', tabKey: null },
    { label: 'Dates Non Conformes', value: (s.dates_invalides || 0).toLocaleString('fr'), icon: ShieldAlert, color: '#e74c3c', gradient: 'linear-gradient(135deg, #e74c3c, #c0392b)', tabKey: 'DATES_INVALIDES' },
    { label: 'Sans Rangement', value: (s.sans_rangement || 0).toLocaleString('fr'), icon: MapPin, color: '#9b59b6', gradient: 'linear-gradient(135deg, #9b59b6, #8e44ad)', tabKey: 'SANS_RANGEMENT' },
    { label: 'Doublons Probables', value: (s.doublons_probables || 0).toLocaleString('fr'), icon: AlertTriangle, color: '#f97316', gradient: 'linear-gradient(135deg, #f97316, #d97706)', tabKey: 'DOUBLONS_PROBABLES' },
    { label: 'Doublons Stricts', value: (s.doublons_stricts || 0).toLocaleString('fr'), icon: GitMerge, color: '#eab308', gradient: 'linear-gradient(135deg, #eab308, #ca8a04)', tabKey: 'DOUBLONS' },
    { label: 'Sans Nom', value: (s.sans_nom || 0).toLocaleString('fr'), icon: ShieldAlert, color: '#ec4899', gradient: 'linear-gradient(135deg, #ec4899, #be185d)', tabKey: 'SANS_NOM' },
    { label: 'Sans Prénom', value: (s.sans_prenom || 0).toLocaleString('fr'), icon: ShieldAlert, color: '#14b8a6', gradient: 'linear-gradient(135deg, #14b8a6, #0f766e)', tabKey: 'SANS_PRENOM' }
  ];

  return (
    <div className="dashboard-premium animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* SECTION : ACCÈS RAPIDES (Command Center Launcher) */}
      <div style={{ marginBottom: 8 }}>
        <h2 
          onClick={() => setIsQuickAccessVisible(!isQuickAccessVisible)}
          style={{ 
            fontSize: 16, 
            fontWeight: 700, 
            color: 'var(--text-primary)', 
            marginBottom: isQuickAccessVisible ? 16 : 8, 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8,
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <LayoutDashboard size={18} color="var(--accent-primary)" /> 
          Lancement Rapide
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
            {isQuickAccessVisible ? <ChevronUp size={20} color="var(--text-muted)" /> : <ChevronDown size={20} color="var(--text-muted)" />}
          </div>
        </h2>
        
        {isQuickAccessVisible && (
          <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {[
              { label: 'Cartes CMU', path: '/cartes', icon: CreditCard, color: '#3b82f6', desc: 'Gestion du stock et détails' },
              { label: 'Nouvelle Saisie', path: '/agent-saisie/nouvelle', icon: FileText, color: '#10b981', desc: 'Saisie opérateur In-Situ' },
              { label: 'Recherche CMU', path: '/verification/recherche', icon: Search, color: '#8b5cf6', desc: 'Recherche active et logs' },
              { label: 'Monitoring Sync', path: '/sync/status', icon: Activity, color: '#f59e0b', desc: 'État du réseau Supabase' }
            ].map(tile => (
              <div 
                key={tile.path}
                onClick={() => navigate(tile.path)}
                className="glass-card"
                style={{ padding: 20, cursor: 'pointer', transition: 'all 0.2s', display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid rgba(255,255,255,0.05)' }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderColor = tile.color; e.currentTarget.style.boxShadow = `0 8px 24px ${tile.color}20`; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 12, background: `${tile.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <tile.icon size={20} color={tile.color} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'white', marginBottom: 4 }}>{tile.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tile.desc}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: 8, flexWrap: 'wrap', gap: 16 }}>
        <div style={{ display: 'flex', gap: 24 }}>
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
            Pilotage des Activités de Terrain
          </button>
        </div>

        <button
          onClick={() => {
            const centreId = user?.role === 'ADMIN_CENTRE' 
              ? Number(user.centre_id) 
              : (selectedCentreId ? Number(selectedCentreId) : undefined);
            const agentId = selectedAgentId ? Number(selectedAgentId) : undefined;
            const dateStr = selectedDate || undefined;
            loadStats(false, activeTab === 'supervision' ? { centreId, agentId, dateStr } : undefined);
            toast.success("Tableau de bord actualisé");
          }}
          className="btn"
          style={{ 
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, fontSize: 13,
            background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', color: 'white', cursor: 'pointer', transition: 'all 0.2s'
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
          onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
        >
          <RefreshCw size={16} />
          Actualiser
        </button>
      </div>

      {activeTab === 'supervision' ? (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* En-tête avec sélecteur de centre + sous-onglets de rôle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {(() => {
                const ROLE_MAPPING = [
                  {
                    key: 'saisie' as const,
                    roleName: 'OPERATEUR_SAISIE',
                    label: '✏️ Performance Saisie',
                    data: filteredSaisies,
                    description: "Nombre de fiches saisies aujourd'hui par chaque opérateur de saisie.",
                    colHeader: "SAISIES DU JOUR",
                    noDataText: "Aucun opérateur de saisie pour ce périmètre.",
                    colorAccent: '#ffd700',
                    suffix: 'fiche(s)'
                  },
                  {
                    key: 'qualite' as const,
                    roleName: 'OPERATEUR_QUALITE',
                    label: '🛡️ Contrôle & Conformité',
                    data: filteredQualite,
                    description: "Nombre d'actions enregistrées aujourd'hui par chaque opérateur de qualité & assainissement.",
                    colHeader: "ACTIONS DU JOUR",
                    noDataText: "Aucun opérateur qualité pour ce périmètre.",
                    colorAccent: '#a78bfa',
                    suffix: 'action(s)'
                  },
                  {
                    key: 'logistique' as const,
                    roleName: 'OPERATEUR_LOGISTIQUE',
                    label: '🚚 Distribution & Logistique',
                    data: filteredLogistique,
                    description: "Nombre de cartes distribuées aujourd'hui par chaque opérateur logistique / inventaire.",
                    colHeader: "DISTRIBUTIONS DU JOUR",
                    noDataText: "Aucun opérateur logistique / inventaire pour ce périmètre.",
                    colorAccent: '#34d399',
                    suffix: 'carte(s)'
                  },
                  {
                    key: 'distributeur' as const,
                    roleName: 'DISTRIBUTEUR',
                    label: '🤝 Distributeur',
                    data: [] as any[], // Réservé pour évolution future
                    description: "Activités de distribution enregistrées aujourd'hui.",
                    colHeader: "DISTRIBUTIONS DU JOUR",
                    noDataText: "Aucun distributeur actif sur ce périmètre.",
                    colorAccent: '#60a5fa',
                    suffix: 'distribution(s)'
                  },
                  {
                    key: 'superviseur' as const,
                    roleName: 'SUPERVISEUR',
                    label: '👁️ Superviseur',
                    data: [] as any[], // Réservé pour évolution future
                    description: "Actions de supervision et validations effectuées aujourd'hui.",
                    colHeader: "ACTIONS DU JOUR",
                    noDataText: "Aucun superviseur actif sur ce périmètre.",
                    colorAccent: '#f472b6',
                    suffix: 'validation(s)'
                  }
                ];

                // Rendre les onglets configurables
                return (
                  <>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {ROLE_MAPPING.map((item) => (
                        <button
                          key={item.key}
                          onClick={() => setSupervisionTab(item.key as any)}
                          style={{
                            padding: '7px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'all 0.2s',
                            borderBottom: supervisionTab === item.key ? '2px solid #ffd700' : '2px solid transparent',
                            color: supervisionTab === item.key ? 'white' : 'var(--text-muted)',
                          }}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', width: '100%', justifyContent: 'flex-end', marginTop: 12 }}>
              {/* Filtre Centre : Masqué pour l'ADMIN_CENTRE */}
              {user?.role !== 'ADMIN_CENTRE' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Centre :</span>
                  <select
                    value={selectedCentreId}
                    onChange={(e) => {
                      setSelectedCentreId(e.target.value);
                      setSelectedAgentId(''); // Réinitialiser l'agent sélectionné lors du changement de centre
                    }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: 10,
                      color: 'white',
                      padding: '6px 12px',
                      fontSize: 12,
                      outline: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="" style={{ background: '#181a26' }}>-- Tous les centres --</option>
                    {centres.map(c => (
                      <option key={c.id} value={c.id} style={{ background: '#181a26' }}>{c.nom}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Filtre Agent */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Agent :</span>
                <select
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 10,
                    color: 'white',
                    padding: '6px 12px',
                    fontSize: 12,
                    outline: 'none',
                    cursor: 'pointer',
                    minWidth: 160
                  }}
                >
                  <option value="" style={{ background: '#181a26' }}>-- Tous les agents --</option>
                  {filteredAgentsForSelect.map(a => (
                    <option key={a.id_user} value={a.id_user} style={{ background: '#181a26' }}>
                      {a.nom_user} {a.prenom_user} (@{a.login})
                    </option>
                  ))}
                </select>
              </div>

              {/* Filtre Date */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Date :</span>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 10,
                    color: 'white',
                    padding: '5px 12px',
                    fontSize: 12,
                    outline: 'none',
                    cursor: 'pointer'
                  }}
                />
                {(selectedAgentId || selectedCentreId || selectedDate !== new Date().toISOString().split('T')[0]) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (user?.role !== 'ADMIN_CENTRE') setSelectedCentreId('');
                      setSelectedAgentId('');
                      setSelectedDate(new Date().toISOString().split('T')[0]);
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 10,
                      color: 'var(--text-muted)',
                      padding: '5px 10px',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    Réinitialiser
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Rendu dynamique des données selon l'onglet configuré */}
          {(() => {
            const ROLE_MAPPING = [
              {
                key: 'saisie',
                data: filteredSaisies,
                description: "Nombre de fiches saisies aujourd'hui par chaque opérateur de saisie.",
                colHeader: "SAISIES DU JOUR",
                noDataText: "Aucun opérateur de saisie pour ce périmètre.",
                colorAccent: '#ffd700',
                suffix: 'fiche(s)',
                countKey: 'total_saisies'
              },
              {
                key: 'qualite',
                data: filteredQualite,
                description: "Nombre d'actions enregistrées aujourd'hui par chaque opérateur de contrôle & conformité.",
                colHeader: "ACTIONS DU JOUR",
                noDataText: "Aucun opérateur de contrôle & conformité pour ce périmètre.",
                colorAccent: '#a78bfa',
                suffix: 'action(s)',
                countKey: 'total_actions'
              },
              {
                key: 'logistique',
                data: filteredLogistique,
                description: "Nombre de cartes distribuées aujourd'hui par chaque opérateur de distribution & logistique.",
                colHeader: "DISTRIBUTIONS DU JOUR",
                noDataText: "Aucun opérateur de distribution & logistique pour ce périmètre.",
                colorAccent: '#34d399',
                suffix: 'carte(s)',
                countKey: 'total_distributions'
              },
              {
                key: 'distributeur',
                data: [] as any[], // Réservé pour évolution
                description: "Nombre de distributions effectuées aujourd'hui par les distributeurs.",
                colHeader: "DISTRIBUTIONS DU JOUR",
                noDataText: "Aucun distributeur actif sur ce périmètre.",
                colorAccent: '#60a5fa',
                suffix: 'distribution(s)',
                countKey: 'total_distributions'
              },
              {
                key: 'superviseur',
                data: [] as any[], // Réservé pour évolution
                description: "Nombre d'actions de supervision validées aujourd'hui.",
                colHeader: "ACTIONS DU JOUR",
                noDataText: "Aucun superviseur actif sur ce périmètre.",
                colorAccent: '#f472b6',
                suffix: 'validation(s)',
                countKey: 'total_actions'
              }
            ];

            const activeRole = ROLE_MAPPING.find(r => r.key === supervisionTab);
            if (!activeRole) return null;

            return (
              <div style={{ overflowX: 'auto' }}>
                <p style={{ margin: '0 0 12px 0', fontSize: 12, color: 'var(--text-muted)' }}>{activeRole.description}</p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }}>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>IDENTIFIANT</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>NOM COMPLET</th>
                      <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>{activeRole.colHeader}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRole.data.map((agent: any) => {
                      const countValue = agent[activeRole.countKey] || 0;
                      return (
                        <tr key={agent.id_user} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                          <td style={{ padding: '14px 16px', fontWeight: 700, color: 'white' }}>{agent.login}</td>
                          <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{agent.nom_user} {agent.prenom_user}</td>
                          <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 900, color: countValue > 0 ? activeRole.colorAccent : 'var(--text-muted)', fontSize: 15 }}>
                            {countValue} {activeRole.suffix}
                          </td>
                        </tr>
                      );
                    })}
                    {activeRole.data.length === 0 && (
                      <tr><td colSpan={3} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>{activeRole.noDataText}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}

        </div>

      ) : (
        <>
          {(s.doublons_stricts > 0 || s.doublons_probables > 0 || s.sans_num_secu > 0 || s.dates_invalides > 0 || s.sans_rangement > 0 || s.sans_nom > 0 || s.sans_prenom > 0) && (
            <div className="glass-card" style={{ border: '1px solid rgba(231, 76, 60, 0.4)', background: 'rgba(231, 76, 60, 0.05)', padding: '20px 24px' }}>
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
                  {s.doublons_probables > 0 && (
                    <div className="badge-alert" style={{ background: 'rgba(249, 115, 22, 0.15)', borderColor: 'rgba(249, 115, 22, 0.3)', color: '#f97316', margin: 0 }}>
                      Doublons Probables : {s.doublons_probables.toLocaleString('fr')}
                    </div>
                  )}
                  {s.sans_num_secu > 0 && (
                    <div className="badge-alert" onClick={() => navigate('/qualite?anomalie=sans_num_secu')} style={{ cursor: 'pointer', background: 'rgba(243, 156, 18, 0.15)', borderColor: 'rgba(243, 156, 18, 0.3)', color: 'var(--accent-orange)', margin: 0 }}>
                      Sans Num Sécu : {s.sans_num_secu.toLocaleString('fr')}
                    </div>
                  )}
                  {s.dates_invalides > 0 && (
                    <div className="badge-alert" onClick={() => navigate('/qualite?anomalie=dates_invalides')} style={{ cursor: 'pointer', background: 'rgba(239, 68, 68, 0.15)', borderColor: 'rgba(239, 68, 68, 0.3)', color: '#f87171', margin: 0 }}>
                      Dates Invalides : {s.dates_invalides.toLocaleString('fr')}
                    </div>
                  )}
                  {s.sans_rangement > 0 && (
                    <span onClick={() => navigate('/logistique?anomalie=sans_rangement')} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(155, 89, 182, 0.2)', color: '#9b59b6', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                      Sans Rangement : {s.sans_rangement.toLocaleString('fr')}
                    </span>
                  )}
                  {s.sans_nom > 0 && (
                    <span onClick={() => navigate('/qualite?anomalie=sans_nom')} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(236, 72, 153, 0.2)', color: '#ec4899', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                      Sans Nom : {s.sans_nom.toLocaleString('fr')}
                    </span>
                  )}
                  {s.sans_prenom > 0 && (
                    <span onClick={() => navigate('/qualite?anomalie=sans_prenom')} style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(20, 184, 166, 0.2)', color: '#14b8a6', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                      Sans Prénom : {s.sans_prenom.toLocaleString('fr')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="glass-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between', position: 'relative', overflow: 'hidden', padding: 24, paddingBottom: 30 }}>
            <div style={{ flex: '1 1 min-content' }}>
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

          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24 }}>
            {kpis.map((kpi, i) => {
              const Icon = kpi.icon;
              return (
                <div 
                  key={i} 
                  className={`glass-card ${kpi.tabKey ? 'clickable-kpi' : ''}`}
                  onClick={() => {
                    if (kpi.tabKey) navigate(`/qualite?tab=${kpi.tabKey}`);
                  }}
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: 20, padding: 24, borderRadius: 16,
                    cursor: kpi.tabKey ? 'pointer' : 'default',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (kpi.tabKey) {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.2)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (kpi.tabKey) {
                      e.currentTarget.style.transform = 'none';
                      e.currentTarget.style.boxShadow = 'none';
                    }
                  }}
                >
                  <div className="kpi-premium-icon" style={{ background: kpi.gradient, width: 54, height: 54, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={24} color="white" />
                  </div>
                  <div>
                    <div className="kpi-value-lg" style={{ fontSize: 28, fontWeight: 900, color: 'white' }}>{kpi.value}</div>
                    <div className="kpi-label-muted" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{kpi.label}</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="glass-card" style={{ padding: '24px 32px', border: '1px solid rgba(255, 215, 0, 0.15)', background: 'rgba(10, 14, 39, 0.3)', borderRadius: 16 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: '#ffd700', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 16px 0' }}>
              <Info size={20} /> GUIDE DE COMPRÉHENSION DES KPI LOGISTIQUES
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24 }}>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#ef4444', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  🛑 Doublon Strict
                </h4>
                <p style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.5, margin: 0 }}>
                  Fiches présentes en base de données qui sont des copies conformes à 100% (mêmes nom, prénom, date/lieu de naissance, contact, n° CMU et statut). Issues de doubles saisies ou d'anciennes anomalies du listing, elles doivent être purgées via la page d'Assainissement.
                </p>
              </div>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#f97316', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  ⚠️ Doublon Probable
                </h4>
                <p style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.5, margin: 0 }}>
                  Cartes partageant la même identité civile (Nom, Prénom, Date de naissance) mais possédant des données de contact, de n° CMU ou de lieu de naissance divergentes. Elles coexistent temporairement pour préserver les nouvelles coordonnées en attendant arbitrage.
                </p>
              </div>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#a855f7', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  📦 Sans Rangement
                </h4>
                <p style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.5, margin: 0 }}>
                  Cartes physiques reçues sur le site mais n'ayant pas encore été assignées à une boîte ou un casier physique via l'écran Logistique. Elles restent indisponibles pour la distribution tant qu'elles ne sont pas classées.
                </p>
              </div>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: '#ec4899', margin: '0 0 6px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  👤 Sans Nom / Prénom
                </h4>
                <p style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.6)', lineHeight: 1.5, margin: 0 }}>
                  Cartes dont le champ Nom ou Prénom est vide. Ces informations sont cruciales pour l'identification et doivent être renseignées via la page Qualité.
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
            <div className="glass-card" style={{ padding: 24, borderRadius: 16 }}>
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 16, marginBottom: 16 }}>
                <span style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, color: 'white' }}>
                  <Activity size={20} color="var(--accent-primary)" /> État du Système Local
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
                <div style={{ padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
                  <h4 style={{ color: 'var(--text-secondary)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, margin: 0 }}>Base de données</h4>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'white', margin: '4px 0 0 0' }}>Connecté (SQLite)</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0 0' }}>Site : {activeSiteId || user?.site_id || 'Non défini'}</p>
                </div>
                <div style={{ padding: 16, background: 'rgba(0,0,0,0.2)', borderRadius: 12 }}>
                  <h4 style={{ color: 'var(--text-secondary)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, margin: 0 }}>Session Active</h4>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'white', margin: '4px 0 0 0' }}>{user?.login}</p>
                  <p style={{ fontSize: 12, color: 'var(--accent-secondary)', margin: '2px 0 0 0' }}>{user?.role}</p>
                </div>
              </div>
            </div>

            {user?.role === 'ADMIN_CENTRE' && user?.site_id && (
              <div className="glass-card" style={{ border: '1px solid rgba(52, 211, 153, 0.3)', background: 'rgba(52, 211, 153, 0.04)', padding: 24, borderRadius: 16 }}>
                <div style={{ borderBottom: '1px solid rgba(52, 211, 153, 0.15)', paddingBottom: 16, marginBottom: 16 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#34d399', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <RefreshCw size={20} /> Synchronisation Cloud — Centre
                  </span>
                  <p style={{ margin: '6px 0 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                    Envoyez vos modifications locales vers le serveur, ou récupérez les mises à jour du Cloud pour votre centre.
                  </p>
                </div>

                {bulkProgress >= 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px', color: 'var(--text-muted)' }}>
                      <span>Transfert en cours...</span>
                      <span>{bulkProgress}%</span>
                    </div>
                    <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${bulkProgress}%`, background: '#34d399', transition: 'width 0.2s ease-in-out' }} />
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleStartBulkUploadClick(false, false)}
                    disabled={isBulkUploading || !isOnline || totalSyncableCards === 0}
                    style={{
                      flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      padding: '11px 18px', borderRadius: 12, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                      background: (isBulkUploading || !isOnline || totalSyncableCards === 0) ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg, #34d399, #059669)',
                      color: (isBulkUploading || !isOnline || totalSyncableCards === 0) ? 'var(--text-muted)' : 'white',
                      opacity: (isBulkUploading || !isOnline || totalSyncableCards === 0) ? 0.5 : 1,
                      transition: 'all 0.2s',
                      boxShadow: (isBulkUploading || !isOnline || totalSyncableCards === 0) ? 'none' : '0 4px 12px rgba(52, 211, 153, 0.25)',
                    }}
                  >
                    <RefreshCw size={16} style={{ animation: isBulkUploading ? 'spin 1.5s linear infinite' : 'none' }} />
                    {isBulkUploading ? 'ENVOI...' : `↑ Envoyer${totalSyncableCards > 0 ? ` (${totalSyncableCards.toLocaleString('fr')})` : ''}`}
                  </button>

                  <button
                    onClick={() => handlePullSiteCards()}
                    disabled={isPullingCards || isBackgroundPulling || !isOnline}
                    style={{
                      flex: 1, minWidth: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      padding: '11px 18px', borderRadius: 12, border: '1px solid rgba(52, 211, 153, 0.3)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                      background: 'transparent',
                      color: (isPullingCards || isBackgroundPulling || !isOnline) ? 'var(--text-muted)' : '#34d399',
                      opacity: (isPullingCards || isBackgroundPulling || !isOnline) ? 0.5 : 1,
                      transition: 'all 0.2s',
                    }}
                  >
                    <RefreshCw size={16} style={{ animation: (isPullingCards || isBackgroundPulling) ? 'spin 1.5s linear infinite' : 'none' }} />
                    {isBackgroundPulling ? 'TÉLÉCHARGEMENT...' : isPullingCards ? 'RÉCUPÉRATION...' : '↓ Récupérer du Cloud'}
                  </button>
                </div>

                {!isOnline && (
                  <p style={{ margin: '10px 0 0 0', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                    ⚠️ Hors ligne — Reconnectez-vous pour synchroniser.
                  </p>
                )}
              </div>
            )}

            {(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE') && (activeSiteId || user?.site_id) && (
              <div className="glass-card" style={{ border: '1px solid rgba(99, 102, 241, 0.3)', background: 'rgba(99, 102, 241, 0.05)', padding: 24, borderRadius: 16 }}>
                <div style={{ borderBottom: '1px solid rgba(99, 102, 241, 0.1)', paddingBottom: 16, marginBottom: 16 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Globe size={20} /> Initialisation Cloud (Mass Upload)
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>
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

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <button 
                        onClick={() => handleStartBulkUploadClick(false, false)} 
                        disabled={isBulkUploading || !isOnline || totalSyncableCards === 0}
                        className="btn-primary" 
                        style={{ 
                          padding: '12px 24px', 
                          borderRadius: 12, 
                          fontWeight: 700,
                          backgroundColor: (isBulkUploading || !isOnline || totalSyncableCards === 0) ? 'var(--bg-secondary)' : 'var(--accent-primary)',
                          cursor: (isBulkUploading || !isOnline || totalSyncableCards === 0) ? 'not-allowed' : 'pointer',
                          opacity: (isBulkUploading || !isOnline || totalSyncableCards === 0) ? 0.5 : 1,
                          boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          border: 'none',
                          textAlign: 'center'
                        }}
                      >
                        <RefreshCw size={18} style={{ flexShrink: 0, animation: isBulkUploading ? 'spin 1.5s linear infinite' : 'none' }} />
                        {isBulkUploading ? 'TRANSFERT EN COURS...' : uploadBtnLabel}
                      </button>
                      <p style={{ margin: '6px 0 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        Transmet au serveur en ligne (Supabase) toutes les nouvelles cartes CMU importées ou créées sur ce PC.
                      </p>
                    </div>

                    {stats && autoClearableAnomalies > 0 && (
                      <div>
                        <button
                          onClick={() => {
                            const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
                            if (!siteIdToUse) {
                              toast.error("Veuillez d'abord sélectionner un site actif.");
                              return;
                            }
                            openConfirmModal({
                              title: "Validation de l'Assainissement Global",
                              message: "Veuillez saisir votre mot de passe administrateur pour valider le nettoyage et l'assainissement de toutes les anomalies locales de ce site.",
                              isDanger: true,
                              isPassword: true,
                              confirmText: "Vérifier et Assainir",
                              onConfirm: async (inputVal: string) => {
                                try {
                                  setLoading(true);
                                  // Vérifier le mot de passe administrateur en arrière-plan
                                  const isCorrect = await window.api.hierarchy.verifyPassword(inputVal, undefined, user?.login);
                                  if (!isCorrect) {
                                    toast.error("❌ Mot de passe administrateur incorrect. Action annulée.");
                                    setLoading(false);
                                    return;
                                  }

                                  let totalDeleted = 0;
                                  // Supprimer les incohérences pour les 3 types
                                  const res1 = await window.api.qualite.supprimerIncoherences({ type_incoherence: 'DATES_INVALIDES', site_id: siteIdToUse });
                                  const res2 = await window.api.qualite.supprimerIncoherences({ type_incoherence: 'SANS_SECU', site_id: siteIdToUse });
                                  const res3 = await window.api.qualite.supprimerIncoherences({ type_incoherence: 'SANS_RANGEMENT', site_id: siteIdToUse });
                                  
                                  totalDeleted = (res1?.deleted || 0) + (res2?.deleted || 0) + (res3?.deleted || 0);
                                  toast.success(`✅ Assainissement global terminé. ${totalDeleted} anomalie(s) nettoyée(s).`);
                                  loadStats();
                                } catch (err: any) {
                                  console.error(err);
                                  toast.error("Erreur lors de l'assainissement : " + (err.message || err));
                                } finally {
                                  setLoading(false);
                                }
                              }
                            });
                          }}
                          disabled={isBulkUploading || loading}
                          className="btn"
                          title="Nettoyer les fiches erronées après transfert"
                          style={{
                            padding: '12px 24px',
                            borderRadius: 12,
                            fontWeight: 700,
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            color: '#f87171',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            cursor: (isBulkUploading || loading) ? 'not-allowed' : 'pointer',
                            opacity: (isBulkUploading || loading) ? 0.5 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            width: 'fit-content'
                          }}
                        >
                          <Trash2 size={18} />
                          Assainir tout ({autoClearableAnomalies})
                        </button>
                        <p style={{ margin: '6px 0 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                          Lance un nettoyage automatique pour fusionner les doublons stricts et corriger les incohérences avant l'envoi cloud.
                        </p>
                      </div>
                    )}

                    {syncAlert && (
                      <div className="glass-card" style={{ border: '1px solid rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.05)', padding: '16px 20px', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ color: 'white', fontSize: 13, lineHeight: 1.5 }}>
                          {syncAlert.status === 'BLOCKED_STRICT' && (
                            <>
                              <strong>⚠️ Doublons Stricts détectés :</strong> {syncAlert.message}
                              <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Les doublons stricts doivent être résolus avant de pouvoir synchroniser.</p>
                            </>
                          )}
                          {syncAlert.status === 'BLOCKED_PROBABLE' && (
                            <>
                              <strong>⚠️ Doublons Probables détectés :</strong> {syncAlert.count} cartes partagent le même état civil mais des informations divergentes. Voulez-vous forcer l'envoi de ces cartes ou les examiner ?
                            </>
                          )}
                          {syncAlert.status === 'BLOCKED_INVALID' && (
                            <>
                              <strong>⚠️ Dates Non Conformes détectées :</strong> {syncAlert.count} cartes possèdent des dates de naissance invalides. Vous devez obligatoirement corriger ces erreurs de saisie avant de pouvoir les envoyer sur le cloud.
                            </>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                          {syncAlert.status === 'BLOCKED_STRICT' && (
                            <button 
                              onClick={() => navigate('/qualite')} 
                              className="btn-danger"
                              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: '#ef4444', color: 'white' }}
                            >
                              Corriger les anomalies (Assainissement)
                            </button>
                          )}
                          {syncAlert.status === 'BLOCKED_PROBABLE' && (
                            <button 
                              onClick={() => handleStartBulkUploadClick(true, false)} 
                              className="btn-plein-soleil"
                              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: '#ffd700', color: 'black' }}
                            >
                              Forcer l'envoi (+Probables)
                            </button>
                          )}
                          {syncAlert.status === 'BLOCKED_INVALID' && (
                            <button 
                              onClick={() => navigate('/qualite')} 
                              className="btn-danger"
                              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none', background: '#ef4444', color: 'white' }}
                            >
                              Aller corriger (Assainissement)
                            </button>
                          )}
                          <button 
                            onClick={() => setSyncAlert(null)} 
                            className="btn-outline"
                            style={{ padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'white' }}
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <button 
                        onClick={handlePullSiteCards} 
                        disabled={isPullingCards || isBackgroundPulling || cloudCartesCount === 0}
                        className="btn-outline" 
                        style={{ 
                          padding: '12px 24px', 
                          borderRadius: 12, 
                          fontWeight: 700,
                          cursor: (isPullingCards || isBackgroundPulling || cloudCartesCount === 0) ? 'not-allowed' : 'pointer',
                          opacity: (isPullingCards || isBackgroundPulling || cloudCartesCount === 0) ? 0.5 : 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          background: 'rgba(255, 255, 255, 0.03)',
                          color: 'white',
                          flex: '1 1 auto',
                          textAlign: 'center'
                        }}
                      >
                        <Database size={18} style={{ flexShrink: 0, animation: isPullingCards ? 'spin 1.5s linear infinite' : 'none' }} />
                        {isPullingCards ? 'RÉCUPÉRATION EN COURS...' : `RÉCUPÉRER LES CARTES DEPUIS LE CLOUD${cloudCartesCount > 0 ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
                      </button>
                      <p style={{ margin: '6px 0 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        Télécharge et fusionne avec votre base locale toutes les cartes modifiées ou enregistrées sur le Cloud pour ce site.
                      </p>
                    </div>

                    <div>
                      <button 
                        onClick={handleForceAgentsSync} 
                        disabled={isSyncingAgents || !isOnline || dirtyUsersCount === 0}
                        className="btn-plein-soleil" 
                        style={{ 
                          padding: '12px 24px', 
                          borderRadius: 12, 
                          fontWeight: 700,
                          backgroundColor: (isSyncingAgents || !isOnline || dirtyUsersCount === 0) ? '#555555' : '#FFE600',
                          color: (isSyncingAgents || !isOnline || dirtyUsersCount === 0) ? '#ffffff' : '#000000',
                          border: '1px solid #FFE600',
                          cursor: (isSyncingAgents || !isOnline || dirtyUsersCount === 0) ? 'not-allowed' : 'pointer',
                          opacity: (isSyncingAgents || !isOnline || dirtyUsersCount === 0) ? 0.5 : 1,
                          boxShadow: '0 4px 15px rgba(255, 230, 0, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          transition: 'all 0.2s ease-in-out',
                          flex: '1 1 auto',
                          textAlign: 'center'
                        }}
                      >
                        <Globe size={18} style={{ flexShrink: 0, animation: isSyncingAgents ? 'spin 1.5s linear infinite' : 'none' }} />
                        {isSyncingAgents ? 'SYNCHRONISATION EN COURS...' : `SYNCHRONISER LES COMPTES AGENTS${dirtyUsersCount > 0 ? ` (${dirtyUsersCount} agent(s))` : ''}`}
                      </button>
                      <p style={{ margin: '6px 0 0 0', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        Met à jour et envoie sur le serveur en ligne la liste des comptes utilisateurs, agents de saisie et distributeurs de ce site.
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    {isOnline ? (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                        🌐 Une connexion Internet stable est requise pour effectuer les synchronisations Supabase Cloud.
                      </p>
                    ) : (
                      <p style={{ fontSize: 12, color: '#ef4444', margin: 0, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        ❌ Connexion Internet absente — les synchronisations Cloud sont temporairement désactivées.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {user?.role === 'SUPER ADMIN' && activeSiteId && (
              <div className="glass-card" style={{ border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.05)', padding: 24, borderRadius: 16 }}>
                <div style={{ borderBottom: '1px solid rgba(239, 68, 68, 0.1)', paddingBottom: 16, marginBottom: 16 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ShieldAlert size={20} /> Zone de Maintenance (Site Actif)
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <p style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>
                    La réinitialisation supprimera <strong>définitivement</strong> toutes les cartes liées à ce site. Les centres et les agents seront conservés.
                  </p>
                  <button 
                    onClick={handleClearDatabase} 
                    className="btn-danger" 
                    style={{ padding: '12px 24px', alignSelf: 'flex-start', borderRadius: 12, fontWeight: 700, boxShadow: '0 4px 15px rgba(239, 68, 68, 0.3)', cursor: 'pointer' }}
                  >
                    <Trash2 size={18} /> PURGER LES CARTES DU SITE
                  </button>
                </div>
              </div>
            )}

            {(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE') && (activeSiteId || user?.site_id) && (
              <div className="glass-card" style={{ border: '1px solid rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.02)', padding: 24, borderRadius: 16 }}>
                <div style={{ borderBottom: '1px solid rgba(239, 68, 68, 0.15)', paddingBottom: 16, marginBottom: 16 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ShieldAlert size={20} /> Zone de Danger Cloud (Supabase)
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <p style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, margin: 0 }}>
                    Cette opération supprimera <strong>définitivement</strong> toutes les cartes associées à ce site sur le serveur Supabase Cloud. L'action est irréversible et n'affectera pas vos données locales.
                  </p>
                  <button 
                    onClick={handleClearCloudDatabaseClick} 
                    disabled={isClearingCloud || !isOnline || totalCloudCartesCount === 0 || totalCloudCartesCount === -1}
                    className="btn-danger" 
                    style={{ 
                      padding: '12px 24px', 
                      alignSelf: 'flex-start', 
                      borderRadius: 12, 
                      fontWeight: 700, 
                      boxShadow: '0 4px 15px rgba(239, 68, 68, 0.3)', 
                      cursor: (isClearingCloud || !isOnline || totalCloudCartesCount === 0 || totalCloudCartesCount === -1) ? 'not-allowed' : 'pointer',
                      opacity: (isClearingCloud || !isOnline || totalCloudCartesCount === 0 || totalCloudCartesCount === -1) ? 0.5 : 1
                    }}
                  >
                    <Trash2 size={18} /> 
                    {totalCloudCartesCount === -1 
                      ? 'PURGER LES CARTES CLOUD' 
                      : `PURGER LES CARTES CLOUD (${totalCloudCartesCount.toLocaleString('fr')} CARTES)`
                    }
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {/* Bouclier global anti-clics et curseur de chargement — seulement si PAS en arrière-plan */}
      {(isSiteSyncing || isSyncingAgents || isPullingCards || isBulkUploading || loading || isClearingCloud) && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 99999,
          backgroundColor: 'rgba(5, 7, 12, 0.6)',
          backdropFilter: 'blur(4px)',
          cursor: 'not-allowed',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 16,
          pointerEvents: 'all'
        }}>
          <div style={{ position: 'relative', width: 64, height: 64 }}>
            <div style={{ 
              border: '4px solid rgba(255,255,255,0.1)', 
              borderTop: '4px solid #FFE600', 
              borderRadius: '50%', 
              width: '100%', 
              height: '100%', 
              animation: 'spin 1s linear infinite' 
            }} />
            {isBulkUploading && bulkProgress >= 0 && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 800,
                color: '#eab308'
              }}>
                {bulkProgress}%
              </div>
            )}
            {isPullingCards && downstreamProgress >= 0 && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 800,
                color: '#60a5fa'
              }}>
                {downstreamProgress}%
              </div>
            )}
            {isClearingCloud && purgeCloudProgress >= 0 && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 800,
                color: '#ef4444'
              }}>
                {purgeCloudProgress}%
              </div>
            )}
          </div>
          <span style={{ color: 'white', fontWeight: 700, fontSize: 14, letterSpacing: '0.5px' }}>
            {isSiteSyncing ? 'Synchronisation du site en cours...' : 
             isSyncingAgents ? 'Synchronisation des comptes agents...' :
             isPullingCards && downstreamProgress >= 0 ? `Récupération des cartes... (${downstreamProgress}%)` :
             isPullingCards ? 'Récupération des cartes...' :
             isBulkUploading ? `Transfert de masse vers le Cloud... (${bulkProgress >= 0 ? bulkProgress : 0}%)` :
             isClearingCloud ? `Purge du cloud en cours... (${purgeCloudProgress >= 0 ? purgeCloudProgress : 0}%)` :
             'Opération en cours...'}
          </span>
        </div>
      )}

      {/* Bannière de téléchargement en arrière-plan — non bloquante, discrète */}
      {isBackgroundPulling && downstreamInfo && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          background: 'rgba(10, 15, 28, 0.92)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(96, 165, 250, 0.35)',
          borderRadius: 14,
          padding: '14px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minWidth: 280,
          boxShadow: '0 8px 32px rgba(96, 165, 250, 0.15)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#60a5fa', display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
              Téléchargement en cours
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#93c5fd' }}>
              {downstreamInfo.progress}%
            </span>
          </div>
          <div style={{ background: 'rgba(96, 165, 250, 0.1)', borderRadius: 6, height: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${downstreamInfo.progress}%`,
              background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
              borderRadius: 6,
              transition: 'width 0.6s ease'
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
            {downstreamInfo.merged.toLocaleString('fr')} / {downstreamInfo.total > 0 ? downstreamInfo.total.toLocaleString('fr') : '...'} cartes reçues
          </span>
        </div>
      )}
      {/* Modale de Confirmation Premium / Glassmorphic */}
      {confirmModal && confirmModal.isOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 100000,
          backgroundColor: 'rgba(5, 7, 12, 0.75)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20
        }}>
          <div className="glass-card animate-scale-up" style={{
            maxWidth: 480,
            width: '100%',
            border: confirmModal.isDanger ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 215, 0, 0.4)',
            boxShadow: confirmModal.isDanger ? '0 10px 40px rgba(239, 68, 68, 0.15)' : '0 10px 40px rgba(255, 215, 0, 0.15)',
            borderRadius: 20,
            padding: 32,
            display: 'flex',
            flexDirection: 'column',
            gap: 20
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <ShieldAlert size={32} color={confirmModal.isDanger ? '#ef4444' : '#ffd700'} />
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'white' }}>{confirmModal.title}</h3>
            </div>
            
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {confirmModal.message}
            </p>

            {confirmModal.requireInput && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                  Veuillez saisir <strong style={{ color: '#ef4444' }}>{confirmModal.requireInput}</strong> pour confirmer :
                </label>
                <input
                  type="text"
                  placeholder={confirmModal.requireInput}
                  autoComplete="off"
                  value={confirmInputVal}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 10,
                    padding: '10px 14px',
                    color: 'white',
                    fontSize: 14,
                    fontWeight: 700,
                    outline: 'none',
                    textAlign: 'center'
                  }}
                  onChange={(e) => setConfirmInputVal(e.target.value)}
                />
              </div>
            )}

            {confirmModal.isPassword && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                  Mot de passe Administrateur :
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={confirmInputVal}
                    style={{
                      width: '100%',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: 10,
                      padding: '10px 42px 10px 14px',
                      color: 'white',
                      fontSize: 14,
                      fontWeight: 700,
                      outline: 'none',
                      textAlign: 'center',
                      boxSizing: 'border-box'
                    }}
                    onChange={(e) => setConfirmInputVal(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'transparent',
                      border: 'none',
                      color: 'rgba(255, 255, 255, 0.4)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 0,
                      transition: 'color 0.2s'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.85)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255, 255, 255, 0.4)')}
                    tabIndex={-1}
                    title={showConfirmPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button
                disabled={
                  confirmModal.requireInput 
                    ? confirmInputVal !== confirmModal.requireInput 
                    : (confirmModal.isPassword ? confirmInputVal.trim() === '' : false)
                }
                onClick={() => {
                  confirmModal.onConfirm(confirmInputVal);
                  if (!confirmModal.isPassword) {
                    setConfirmModal(null);
                  }
                }}
                className={confirmModal.isDanger ? 'btn-danger' : 'btn-plein-soleil'}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: 10,
                  fontWeight: 700,
                  border: 'none',
                  opacity: (confirmModal.requireInput && confirmInputVal !== confirmModal.requireInput) ? 0.5 : 1,
                  cursor: (confirmModal.requireInput && confirmInputVal !== confirmModal.requireInput) ? 'not-allowed' : 'pointer'
                }}
              >
                {confirmModal.confirmText || 'Confirmer'}
              </button>
              <button
                onClick={() => setConfirmModal(null)}
                className="btn-outline"
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: 10,
                  fontWeight: 700,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  background: 'transparent',
                  color: 'white',
                  cursor: 'pointer'
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
