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
import { toast } from 'react-hot-toast';

interface GovernanceViewProps {
  globalStats: any;
  sites: any[];
  loadGlobalData: () => Promise<void>;
  isForceSyncing: boolean;
  forceSyncResult: any;
  handleForceGlobalSync: () => Promise<void>;
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
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 24, marginBottom: 24 }}>
        <div className="premium-card premium-glass" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 24, borderRadius: 16 }}>
          <div className="kpi-premium-icon" style={{ background: 'linear-gradient(135deg, #6c63ff, #4834d4)', width: 54, height: 54, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Globe size={28} color="white" />
          </div>
          <div>
            <div className="kpi-value-lg" style={{ fontSize: 28, fontWeight: 900, color: 'white' }}>{gs.total_sites}</div>
            <div className="kpi-label-muted" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sites Déployés</div>
          </div>
        </div>
        
        <div className="premium-card premium-glass" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 24, borderRadius: 16 }}>
          <div className="kpi-premium-icon" style={{ background: 'linear-gradient(135deg, #27ae60, #2ecc71)', width: 54, height: 54, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <PowerIcon size={28} color="white" />
          </div>
          <div>
            <div className="kpi-value-lg" style={{ fontSize: 28, fontWeight: 900, color: 'white' }}>{gs.active_sites}</div>
            <div className="kpi-label-muted" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sites Actifs</div>
          </div>
        </div>
        
        <div className="premium-card premium-glass" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 24, borderRadius: 16 }}>
          <div className="kpi-premium-icon" style={{ background: 'linear-gradient(135deg, #f39c12, #e67e22)', width: 54, height: 54, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <CreditCard size={28} color="white" />
          </div>
          <div>
            <div className="kpi-value-lg" style={{ fontSize: 28, fontWeight: 900, color: 'white' }}>{gs.total_cartes.toLocaleString('fr')}</div>
            <div className="kpi-label-muted" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Cartes Globales</div>
          </div>
        </div>
        
        <div className="premium-card premium-glass" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 24, borderRadius: 16 }}>
          <div className="kpi-premium-icon" style={{ background: 'linear-gradient(135deg, #3498db, #2980b9)', width: 54, height: 54, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Users size={28} color="white" />
          </div>
          <div>
            <div className="kpi-value-lg" style={{ fontSize: 28, fontWeight: 900, color: 'white' }}>{gs.total_agents}</div>
            <div className="kpi-label-muted" style={{ fontSize: 13, color: 'var(--text-muted)' }}>Agents Réseau</div>
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex',
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

      <div className="premium-card premium-glass" style={{ padding: 0, borderRadius: 16 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(108, 99, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(108, 99, 255, 0.2)' }}>
              <Globe size={20} color="var(--accent-primary)" />
            </div>
            <div>
              <span className="card-title" style={{ fontSize: 16, marginBottom: 2, fontWeight: 700, color: 'white' }}>Gestion des Sites</span>
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
              fontWeight: 700,
              cursor: 'pointer'
            }}
            onClick={() => setShowCreateModal(true)}
          >
            <Plus size={18} /> Nouveau Site
          </button>
        </div>
        
        <div className="card-body" style={{ padding: 0 }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }}>
                <th style={{ padding: '16px 24px', color: 'var(--text-muted)' }}>Infrastructure / Site</th>
                <th style={{ padding: '16px 12px', color: 'var(--text-muted)' }}>Administrateur</th>
                <th style={{ padding: '16px 12px', color: 'var(--text-muted)' }}>Centres</th>
                <th style={{ padding: '16px 12px', color: 'var(--text-muted)' }}>Total Cartes</th>
                <th style={{ padding: '16px 12px', color: 'var(--text-muted)' }}>État / Statut</th>
                <th style={{ textAlign: 'right', paddingRight: 24, width: 220, color: 'var(--text-muted)' }}>Actions</th>
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
      </div>

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

      {/* ─── TÂCHE 3 : PANNEAU DE CONFIGURATION DES VERSIONS SUPABASE ─── */}
      <VersionControlPanel />
      
      {/* Footer Signature */}
      <div style={{ textAlign: 'center', marginTop: 40, paddingBottom: 20, fontSize: 11, color: 'var(--text-muted)', opacity: 0.6 }}>
        GEST-IN-SITU v2.3.1 - © Ebychoco 2026 - Tous droits réservés
      </div>
    </div>
  );
}

function VersionControlPanel() {
  const [isActive, setIsActive] = useState(false);
  const [minVersion, setMinVersion] = useState('2.3.0');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (window.api?.app?.checkRemoteVersion) {
      window.api.app.checkRemoteVersion().then((res) => {
        if (res && res.success) {
          setIsActive(!!res.is_active);
          if (res.version_minimale) setMinVersion(res.version_minimale);
          if (res.url_telechargement) setDownloadUrl(res.url_telechargement);
        }
      }).catch(console.error).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const convertToDirectDownloadUrl = (url: string): string => {
    if (!url) return '';
    // Expression régulière pour capturer l'ID d'un lien Google Drive classique (/file/d/ID/...) ou court (/id=ID)
    const driveRegex = /(?:\/file\/d\/|id=)([\w-]+)/;
    const match = url.match(driveRegex);
    
    if (match && match[1]) {
      const fileId = match[1];
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    }
    // Si ce n'est pas un lien Google Drive standard, on laisse le lien d'origine inchangé
    return url.trim();
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const targetUrl = convertToDirectDownloadUrl(downloadUrl);
      setDownloadUrl(targetUrl);

      // Nous mettons à jour la configuration en temps réel sur Supabase
      if (window.api?.app && (window.api.app as any).updateRemoteVersion) {
        const res = await (window.api.app as any).updateRemoteVersion({
          is_active: isActive,
          version_minimale: minVersion.trim(),
          url_telechargement: targetUrl
        });
        if (res && res.success) {
          toast.success("Configuration Supabase enregistrée !");
        } else {
          toast.error("Échec d'enregistrement : " + (res?.error || "Inconnu"));
        }
      } else {
        toast.error("API updateRemoteVersion indisponible sur le client Electron.");
      }
    } catch (err: any) {
      toast.error("Erreur lors de la sauvegarde : " + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="premium-card premium-glass" style={{ padding: 24, borderRadius: 16, marginTop: 24 }}>
        <div style={{ color: 'white', fontSize: 14 }}>Chargement du panneau de contrôle Supabase...</div>
      </div>
    );
  }

  return (
    <div className="premium-card premium-glass" style={{ padding: 24, borderRadius: 16, marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'rgba(108, 99, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(108, 99, 255, 0.2)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'white' }}>Contrôle de Version Distante (Supabase)</h3>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bloquez les versions obsolètes sur le terrain et forcez les mises à jour</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 20, marginBottom: 20 }}>
        <div style={{ background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>STATUT DU BLOCAGE OBLIGATOIRE</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <input 
              type="checkbox" 
              checked={isActive} 
              onChange={(e) => setIsActive(e.target.checked)}
              style={{ width: 18, height: 18, cursor: 'pointer' }}
            />
            <span style={{ fontSize: 14, color: 'white', fontWeight: 500 }}>
              {isActive ? '🟢 Actif (Verrouillage strict des anciennes versions)' : '🔴 Inactif (Tout le monde peut se connecter)'}
            </span>
          </div>
        </div>

        <div style={{ background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>VERSION MINIMALE EXIGÉE</label>
          <input 
            type="text" 
            value={minVersion} 
            onChange={(e) => setMinVersion(e.target.value)}
            placeholder="Ex: 2.3.0"
            style={{ padding: '10px 14px', borderRadius: 8, background: '#0e1017', border: '1px solid #23273a', color: 'white', fontSize: 14 }}
          />
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.02)', padding: 16, borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>URL DE TÉLÉCHARGEMENT DE L'INSTALLATEUR</label>
        <input 
          type="text" 
          value={downloadUrl} 
          onChange={(e) => setDownloadUrl(e.target.value)}
          placeholder="Lien Google Drive, Dropbox, OneDrive, etc."
          style={{ width: '100%', padding: '10px 14px', borderRadius: 8, background: '#0e1017', border: '1px solid #23273a', color: 'white', fontSize: 14 }}
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 24px',
          borderRadius: 10,
          background: saving ? '#4f46e5' : 'var(--gradient-button)',
          border: 'none',
          color: 'white',
          fontWeight: 700,
          cursor: saving ? 'not-allowed' : 'pointer',
          boxShadow: '0 4px 14px rgba(108, 99, 255, 0.25)',
          transition: 'all 0.2s'
        }}
      >
        {saving ? 'Enregistrement...' : 'Enregistrer les modifications'}
      </button>
    </div>
  );
}

