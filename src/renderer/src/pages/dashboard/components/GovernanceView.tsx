import React, { useState, useEffect } from 'react';
import { 
  Globe, 
  Power, 
  CreditCard, 
  Users, 
  Plus, 
  Key, 
  Power as PowerIcon,
  RefreshCw,
  ShieldAlert,
  AlertTriangle
} from 'lucide-react';
import { useOnlineStatus } from '../../../hooks/useOnlineStatus';
import { toast } from 'react-hot-toast';

interface GovernanceViewProps {
  globalStats: any;
  sites: any[];
  loadGlobalData: () => Promise<void>;
  isForceSyncing: boolean;
  forceSyncResult: any;
  handleForceGlobalSync: () => Promise<void>;
  loading?: boolean;
}

export function GovernanceView({
  globalStats,
  sites,
  loadGlobalData,
  isForceSyncing,
  forceSyncResult,
  handleForceGlobalSync
}: GovernanceViewProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [resetPassModal, setResetPassModal] = useState<{ isOpen: boolean, site: any | null, newPass: string }>({ isOpen: false, site: null, newPass: '' });
  const [confirmStatusModal, setConfirmStatusModal] = useState<{ isOpen: boolean, site: any | null }>({ isOpen: false, site: null });
  const [showSyncConfirmModal, setShowSyncConfirmModal] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const isOnline = useOnlineStatus();
  const [newSite, setNewSite] = useState({
    nom: '',
    code: '',
    max_centres: 4,
    adminNom: '',
    adminLogin: '',
    adminPass: ''
  });

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

  const gs = globalStats || { total_sites: 0, active_sites: 0, total_cartes: 0, total_agents: 0 };

  return (
    <div className="dashboard-premium animate-fade-in">
      <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24, marginBottom: 32 }}>
        <div className="premium-glass" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 24, borderRadius: 20 }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(108, 99, 255, 0.2), rgba(72, 52, 212, 0.2))', border: '1px solid rgba(108, 99, 255, 0.3)', width: 58, height: 58, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Globe size={30} color="#818cf8" />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1 }}>{gs.total_sites}</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>Sites Déployés</div>
          </div>
        </div>
        
        <div className="premium-glass" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 24, borderRadius: 20 }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(39, 174, 96, 0.2), rgba(46, 204, 113, 0.2))', border: '1px solid rgba(46, 204, 113, 0.3)', width: 58, height: 58, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <PowerIcon size={30} color="#6ee7b7" />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1 }}>{gs.active_sites}</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>Sites Actifs</div>
          </div>
        </div>
        
        <div className="premium-glass" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 24, borderRadius: 20 }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(243, 156, 18, 0.2), rgba(230, 126, 34, 0.2))', border: '1px solid rgba(243, 156, 18, 0.3)', width: 58, height: 58, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <CreditCard size={30} color="#fcd34d" />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1 }}>{gs.total_cartes.toLocaleString('fr')}</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>Cartes Globales</div>
          </div>
        </div>
        
        <div className="premium-glass" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 24, borderRadius: 20 }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(52, 152, 219, 0.2), rgba(41, 128, 185, 0.2))', border: '1px solid rgba(52, 152, 219, 0.3)', width: 58, height: 58, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Users size={30} color="#7dd3fc" />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1 }}>{gs.total_agents}</div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>Agents Réseau</div>
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        marginBottom: 24,
      }}>
        <button
          id="btn-force-global-sync"
          onClick={() => setShowSyncConfirmModal(true)}
          disabled={isForceSyncing}
          style={{
            position: 'relative',
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
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1A1400" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 16 12 12 8 16" />
                <line x1="12" y1="12" x2="12" y2="21" />
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
              </svg>
              Synchronisation Forcée du Réseau
              <span style={{
                position: 'absolute',
                top: -4,
                right: -4,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: isOnline ? '#2ecc71' : '#e74c3c',
                border: '2px solid #FFE600'
              }}></span>
            </>
          )}
        </button>

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

      <div className="premium-glass" style={{ padding: 0, borderRadius: 20, overflow: 'hidden' }}>
        <div className="card-header" style={{ background: 'rgba(0,0,0,0.2)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', padding: '24px 28px', borderBottom: '1px solid rgba(255,255,255,0.05)', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, rgba(108, 99, 255, 0.15), rgba(72, 52, 212, 0.15))', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(108, 99, 255, 0.25)', flexShrink: 0 }}>
              <Globe size={22} color="#818cf8" />
            </div>
            <div>
              <span className="card-title" style={{ fontSize: 18, marginBottom: 4, fontWeight: 800, color: 'white', letterSpacing: '0.01em' }}>Gestion des Sites</span>
              <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>Gouvernance et déploiement de l'infrastructure</div>
            </div>
          </div>
          <button 
            className="btn-primary" 
            style={{ 
              padding: '12px 24px', 
              borderRadius: 14, 
              display: 'flex', 
              alignItems: 'center', 
              gap: 10,
              background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
              boxShadow: '0 8px 20px rgba(79, 70, 229, 0.35)',
              border: '1px solid rgba(255,255,255,0.1)',
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: '0.02em',
              transition: 'all 0.3s ease',
              cursor: 'pointer'
            }}
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={20} /> NOUVEAU SITE
          </button>
        </div>
        
        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table className="data-table data-table-premium" style={{ width: '100%', minWidth: '800px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'left', background: 'rgba(0,0,0,0.1)' }}>
                <th style={{ padding: '20px 28px', color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Infrastructure / Site</th>
                <th style={{ padding: '20px 16px', color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Administrateur</th>
                <th style={{ padding: '20px 16px', color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Centres</th>
                <th style={{ padding: '20px 16px', color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Cartes</th>
                <th style={{ padding: '20px 16px', color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>État / Statut</th>
                <th style={{ textAlign: 'right', padding: '20px 28px', width: 220, color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '16px 24px' }}>
                    <div style={{ fontWeight: 700, color: 'white', fontSize: 14 }}>{site.nom}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{site.code_site || site.code}</div>
                  </td>
                  <td style={{ padding: '16px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}>
                        {site.admin_login?.substring(0, 2).toUpperCase() || '??'}
                      </div>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        {site.admin_login || <i style={{ color: 'var(--text-muted)', opacity: 0.5 }}>Non assigné</i>}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '16px 12px' }}>
                    <span style={{ padding: '4px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
                      {site.total_centres}
                    </span>
                  </td>
                  <td style={{ padding: '16px 12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                    {site.total_cartes.toLocaleString('fr')}
                  </td>
                  <td style={{ padding: '16px 12px' }}>
                    <span className={`badge ${site.is_active ? 'badge-success' : 'badge-danger'}`} style={{ padding: '4px 12px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>
                      {site.is_active ? 'ACTIF' : 'SUSPENDU'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: 24, whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
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
                      >
                        <Key size={14} /> 
                      </button>
                      <button 
                        title={site.is_active ? "Suspendre l'infrastructure" : "Activer l'infrastructure"}
                        onClick={() => setConfirmStatusModal({ isOpen: true, site })}
                        style={{
                          background: site.is_active ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(220, 38, 38, 0.15))' : 'linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.15))',
                          border: `1px solid ${site.is_active ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
                          color: site.is_active ? '#fca5a5' : '#6ee7b7',
                          padding: '10px 18px',
                          borderRadius: '12px',
                          display: 'flex', alignItems: 'center', gap: '8px',
                          cursor: 'pointer',
                          fontSize: '12px', fontWeight: 800,
                          transition: 'all 0.2s ease',
                          boxShadow: site.is_active ? '0 4px 12px rgba(239, 68, 68, 0.1)' : '0 4px 12px rgba(16, 185, 129, 0.1)'
                        }}
                      >
                        {site.is_active ? <Power size={14} /> : <RefreshCw size={14} />}
                        {site.is_active ? "SUSPENDRE" : "ACTIVER"}
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
      </div>

      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(5, 7, 15, 0.8)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          animation: 'fadeIn 0.3s ease'
        }}>
          <div className="animate-scale-in" style={{
            background: 'rgba(15, 17, 26, 0.85)', 
            border: '1px solid rgba(255, 255, 255, 0.1)',
            width: '100%', maxWidth: 520, 
            borderRadius: 28,
            boxShadow: '0 40px 80px -20px rgba(0, 0, 0, 0.8), inset 0 0 0 1px rgba(255,255,255,0.05)',
            padding: '36px'
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
              <div style={{ display: 'flex', gap: 16 }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 16,
                  background: 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 8px 20px rgba(79, 70, 229, 0.4)'
                }}>
                  <Plus size={26} color="white" />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'white', letterSpacing: '-0.01em' }}>Déploiement Nouveau Site</h3>
                  <p style={{ margin: '6px 0 0 0', fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>Configurez les paramètres de la zone géographique</p>
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
                    value={newSite.adminNom}
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

      {resetPassModal.isOpen && resetPassModal.site && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(5, 7, 15, 0.8)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          animation: 'fadeIn 0.3s ease'
        }}>
          <div className="animate-scale-in" style={{
            background: 'rgba(15, 17, 26, 0.85)', border: '1px solid rgba(255, 255, 255, 0.1)',
            width: '100%', maxWidth: 420, borderRadius: 28, padding: '36px',
            boxShadow: '0 40px 80px -20px rgba(0, 0, 0, 0.8), inset 0 0 0 1px rgba(255,255,255,0.05)'
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

      {confirmStatusModal.isOpen && confirmStatusModal.site && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(5, 7, 15, 0.8)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          animation: 'fadeIn 0.3s ease'
        }}>
          <div className="animate-scale-in" style={{
            background: 'rgba(15, 17, 26, 0.85)', border: '1px solid rgba(255, 255, 255, 0.1)',
            width: '100%', maxWidth: 420, borderRadius: 28, padding: '36px',
            boxShadow: '0 40px 80px -20px rgba(0, 0, 0, 0.8), inset 0 0 0 1px rgba(255,255,255,0.05)'
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

      {showSyncConfirmModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1010,
          background: 'rgba(5, 7, 15, 0.92)', backdropFilter: 'blur(16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          animation: 'fadeIn 0.3s ease'
        }}>
          <div className="animate-scale-in" style={{
            background: 'linear-gradient(180deg, rgba(26, 20, 0, 0.95), rgba(15, 12, 0, 0.98))', 
            border: '2px solid rgba(255, 230, 0, 0.5)',
            width: '100%', maxWidth: 480, borderRadius: 32, padding: '40px',
            boxShadow: '0 40px 100px -20px rgba(0, 0, 0, 0.95), 0 0 60px rgba(255, 230, 0, 0.15), inset 0 0 0 1px rgba(255, 230, 0, 0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{ width: 54, height: 54, borderRadius: 16, background: 'rgba(255, 230, 0, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255, 230, 0, 0.3)' }}>
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
                onClick={async () => {
                  setShowSyncConfirmModal(false);
                  await handleForceGlobalSync();
                }} 
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

      {/* Footer Signature */}
      <div style={{ textAlign: 'center', marginTop: 40, paddingBottom: 20, fontSize: 11, color: 'var(--text-muted)', opacity: 0.6 }}>
        GEST-IN-SITU v2.3.1 - © Ebychoco 2026 - Tous droits réservés
      </div>
    </div>
  );
}



