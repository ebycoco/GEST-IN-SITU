import React, { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, MapPin, Building2, Save, X, Lock, Unlock, AlertTriangle, ShieldCheck, ChevronRight, Activity, Database, CloudDownload, CloudUpload, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { useCacheStore } from '../stores/cacheStore';
import { confirmService } from '../components/confirmService';

interface Site { 
  id: number; 
  nom: string; 
  code: string; 
  max_centres: number; 
  is_active: number; 
  created_at: string; 
  expiry_date: string | null;
  is_permanent: number;
}

export default function SitesPage() {
  const userContext = useAuthStore(s => s.user);
  const [centres, setCentres] = useState<any[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  // Modals state
  const [showCentreModal, setShowCentreModal] = useState(false);
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [editingCentre, setEditingCentre] = useState<any>(null);
  const [confirmModal, setConfirmModal] = useState<{ type: 'DELETE' | 'BAN' | 'ACTIVATE', site: Site } | null>(null);
  
  const [activeTab, setActiveTab] = useState<'SITES' | 'CENTRES'>(userContext?.role === 'SUPER ADMIN' ? 'SITES' : 'CENTRES');
  
  // Forms state
  const [centreFormData, setCentreFormData] = useState({ nom: '', numero: '', lieu: '', site_id: '', prefixe_rangement: '' });
  const [siteFormData, setSiteFormData] = useState({ 
    nom: '', 
    code: '', 
    max_centres: 4,
    adminNom: '',
    adminLogin: '',
    adminPassword: '',
    expiry_date: '',
    is_permanent: false
  });
  const [adminPassword, setAdminPassword] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  
  const [isPullingCentres, setIsPullingCentres] = useState(false);
  const [isPushingCentres, setIsPushingCentres] = useState(false);

  useEffect(() => { 
    setCurrentPage(1);
    const cache = useCacheStore.getState().sitesCache;
    let hasCache = false;
    if (cache.cachedAt && cache.list.length > 0) {
      setSites(cache.list);
      setLoading(false);
      hasCache = true;
    }
    loadData(hasCache);
  }, [userContext?.site_id, activeTab]);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const s = await window.api.hierarchy.getSites();
      setSites(s);
      useCacheStore.getState().setSitesCache(s);
      const c = await window.api.hierarchy.getCentres(userContext?.role === 'SUPER ADMIN' ? undefined : userContext?.site_id);
      setCentres(c);
    } catch (e) { console.error(e); }
    finally { if (!silent) setLoading(false); }
  };

  const handleCreateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteFormData.adminLogin || !siteFormData.adminPassword) {
      toast.error('Veuillez configurer le compte administrateur');
      return;
    }
    try {
      await window.api.hierarchy.createSite({
        nom: siteFormData.nom,
        code: siteFormData.code,
        max_centres: siteFormData.max_centres,
        expiry_date: siteFormData.is_permanent ? null : (siteFormData.expiry_date || null),
        is_permanent: siteFormData.is_permanent ? 1 : 0,
        admin: {
          nom: siteFormData.adminNom || `Admin ${siteFormData.nom}`,
          login: siteFormData.adminLogin,
          password_hash: siteFormData.adminPassword // Le backend s'occupe du hachage
        }
      });
      toast.success('Site et Administrateur créés avec succès');
      setShowSiteModal(false);
      setSiteFormData({ 
        nom: '', 
        code: '', 
        max_centres: 4,
        adminNom: '',
        adminLogin: '',
        adminPassword: '',
        expiry_date: '',
        is_permanent: false
      });
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUpdateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSite) return;
    try {
      await window.api.hierarchy.updateSite(editingSite.id, {
        nom: editingSite.nom,
        code: editingSite.code,
        max_centres: editingSite.max_centres,
        expiry_date: editingSite.is_permanent ? null : (editingSite.expiry_date || null),
        is_permanent: editingSite.is_permanent ? 1 : 0,
        is_active: editingSite.is_active
      });
      toast.success('Modifications enregistrées');
      setEditingSite(null);
      loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCreateCentre = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSiteId = userContext?.role === 'SUPER ADMIN' ? parseInt(centreFormData.site_id) : userContext?.site_id;
    
    if (!finalSiteId) {
      toast.error('Veuillez sélectionner un site d\'abord.');
      return;
    }

    if (!centreFormData.numero || !centreFormData.numero.trim()) {
      toast.error('❌ Le numéro de centre est obligatoire.');
      return;
    }
    const num = parseInt(centreFormData.numero) || 0;
    if (num < 1 || num > 4) {
      toast.error('❌ Le numéro de centre doit être compris entre 1 et 4.');
      return;
    }

    const isPrincipal = num === 1 || (centreFormData.nom && centreFormData.nom.toUpperCase().includes('PRINCIPAL'));
    if (!isPrincipal && (!centreFormData.prefixe_rangement || !centreFormData.prefixe_rangement.trim())) {
      toast.error('❌ Le préfixe de rangement est obligatoire pour les centres secondaires.');
      return;
    }

    try {
      await window.api.hierarchy.createCentre({
        site_id: finalSiteId,
        nom: centreFormData.nom,
        numero: num,
        // @ts-ignore
        lieu: centreFormData.lieu,
        prefixe_rangement: centreFormData.prefixe_rangement || undefined
      });
      toast.success('Centre créé avec succès');
      setShowCentreModal(false);
      setCentreFormData({ nom: '', numero: '', lieu: '', site_id: '', prefixe_rangement: '' });
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la création du centre');
    }
  };

  const handleUpdateCentre = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCentre) return;

    if (!editingCentre.numero || !editingCentre.numero.toString().trim()) {
      toast.error('❌ Le numéro de centre est obligatoire.');
      return;
    }
    const num = parseInt(editingCentre.numero) || 0;
    if (num < 1 || num > 4) {
      toast.error('❌ Le numéro de centre doit être compris entre 1 et 4.');
      return;
    }

    const isPrincipal = num === 1 || (editingCentre.nom && editingCentre.nom.toUpperCase().includes('PRINCIPAL'));
    if (!isPrincipal && (!editingCentre.prefixe_rangement || !editingCentre.prefixe_rangement.trim())) {
      toast.error('❌ Le préfixe de rangement est obligatoire pour les centres secondaires.');
      return;
    }

    try {
      await window.api.hierarchy.updateCentre(editingCentre.id, {
        nom: editingCentre.nom,
        numero: num,
        prefixe_rangement: editingCentre.prefixe_rangement || null
      });
      toast.success('Centre modifié avec succès');
      setEditingCentre(null);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Erreur lors de la modification du centre');
    }
  };

  const handleDeleteCentre = async (id: number) => {
    const centreToDel = centres.find(c => c.id === id);
    const isConfirmed = await confirmService.confirm({
      title: "Supprimer le centre",
      message: "Voulez-vous vraiment supprimer ce centre ?",
      isDanger: true,
      requirePassword: true,
      actionName: `Suppression du centre ${centreToDel?.nom || id}`
    });
    if (!isConfirmed) return;

    try {
      await window.api.hierarchy.deleteCentre(id);
      toast.success("Centre supprimé avec succès");
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de la suppression du centre");
    }
  };

  const handleSecureAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmModal || !adminPassword) return;

    setIsVerifying(true);
    try {
      const isValid = await window.api.hierarchy.verifyPassword(adminPassword);
      if (!isValid) {
        toast.error('Accès refusé : Mot de passe incorrect');
        return;
      }

      const { type, site } = confirmModal;
      
      if (type === 'DELETE') {
        await window.api.hierarchy.deleteSite(site.id);
        toast.success(`Infrastructure ${site.nom} purgée avec succès`);
      } else if (type === 'BAN') {
        await window.api.hierarchy.updateSite(site.id, { is_active: 0 });
        toast.success(`Accès révoqué pour le site ${site.nom}`);
      } else if (type === 'ACTIVATE') {
        await window.api.hierarchy.updateSite(site.id, { is_active: 1 });
        toast.success(`Accès restauré pour le site ${site.nom}`);
      }

      setConfirmModal(null);
      setAdminPassword('');
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Une erreur est survenue lors de l\'opération');
    } finally {
      setIsVerifying(false);
    }
  };

  const handlePullCentres = async () => {
    if (!userContext?.site_id) return;
    setIsPullingCentres(true);
    try {
      const result = await window.api.hierarchy.pullCentres(userContext.site_id, userContext);
      if (result.success) {
        toast.success(result.message || `${result.count} centres téléchargés avec succès.`);
        loadData();
      } else {
        toast.error(result.message || 'Erreur lors du téléchargement des centres.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Une erreur est survenue lors du téléchargement.');
    } finally {
      setIsPullingCentres(false);
    }
  };

  const handlePushCentres = async () => {
    if (!userContext?.site_id) return;
    setIsPushingCentres(true);
    try {
      const result = await window.api.hierarchy.forceCentres(userContext.site_id, userContext);
      if (result.success) {
        toast.success(result.message || `${result.count} centres envoyés au Cloud avec succès.`);
        loadData();
      } else {
        toast.error(result.message || 'Erreur lors de l\'envoi des centres.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Une erreur est survenue lors de l\'envoi.');
    } finally {
      setIsPushingCentres(false);
    }
  };

  if (userContext?.role !== 'SUPER ADMIN' && userContext?.role !== 'ADMINISTRATEUR_SITE') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ padding: 40, textAlign: 'center', maxWidth: 400 }}>
          <Lock size={48} color="var(--accent-red)" style={{ marginBottom: 20 }} />
          <h3 style={{ marginBottom: 12 }}>Accès Restreint</h3>
          <p style={{ color: 'var(--text-muted)' }}>Cette section est réservée exclusivement à l'administration du système.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', padding: '24px 32px' }}>
      
      {/* Header Professionnel */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ background: 'linear-gradient(135deg, var(--accent-primary) 0%, #6366f1 100%)', width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)' }}>
              <Database size={18} color="white" />
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>Infrastructures Réseau</h2>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 48 }}>Gestion centrale des sites géographiques et des quotas de centres.</p>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          {userContext?.role === 'SUPER ADMIN' ? (
            <div className="tabs-premium">
              <button className={activeTab === 'SITES' ? 'active' : ''} onClick={() => setActiveTab('SITES')}>
                <MapPin size={16} /> Sites
              </button>
              <button className={activeTab === 'CENTRES' ? 'active' : ''} onClick={() => setActiveTab('CENTRES')}>
                <Building2 size={16} /> Centres
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255, 215, 0, 0.05)', border: '1px solid rgba(255, 215, 0, 0.2)', padding: '6px 16px', borderRadius: 12, gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ffd700' }}>
                Centres créés : {centres.filter(c => c.site_id === userContext?.site_id).length} / {(() => {
                  const s = sites.find(x => x.id === userContext?.site_id);
                  return s ? s.max_centres : 4;
                })()}
              </span>
            </div>
          )}
          
          {userContext?.role !== 'SUPER ADMIN' && activeTab === 'CENTRES' && (
            <>
              <button 
                className="btn btn-secondary" 
                onClick={handlePullCentres}
                disabled={isPullingCentres || loading}
                title="Télécharger les centres depuis le Cloud"
              >
                <CloudDownload size={18} className={isPullingCentres ? 'animate-bounce' : ''} />
                Télécharger les centres
              </button>
              
              <button 
                className="btn btn-primary"
                style={{ background: 'var(--accent-primary)' }}
                onClick={handlePushCentres}
                disabled={isPushingCentres || loading}
                title="Envoyer les centres vers le Cloud"
              >
                <CloudUpload size={18} className={isPushingCentres ? 'animate-bounce' : ''} />
                Envoyer les centres
              </button>
              <button className="btn btn-outline" style={{ width: 44, height: 44, padding: 0, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} onClick={() => loadData()}>
                <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
              </button>
            </>
          )}

          <button 
            className="btn btn-primary btn-lg" 
            disabled={userContext?.role !== 'SUPER ADMIN' && centres.filter(c => c.site_id === userContext?.site_id).length >= (sites.find(x => x.id === userContext?.site_id)?.max_centres || 4)}
            onClick={() => activeTab === 'SITES' ? setShowSiteModal(true) : setShowCentreModal(true)}
          >
            <Plus size={18} /> {activeTab === 'SITES' ? 'Nouveau Site' : 'Nouveau Centre'}
          </button>
        </div>
      </div>

      {/* Statistiques Rapides */}
      <div style={{ display: 'grid', gridTemplateColumns: userContext?.role === 'SUPER ADMIN' ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)', gap: 20 }}>
        {userContext?.role === 'SUPER ADMIN' && (
          <div className="stat-card-mini">
            <div className="icon"><MapPin size={16} /></div>
            <div className="content">
              <span className="label">Sites Total</span>
              <span className="value">{sites.length}</span>
            </div>
          </div>
        )}
        <div className="stat-card-mini">
          <div className="icon"><Building2 size={16} /></div>
          <div className="content">
            <span className="label">Centres Actifs</span>
            <span className="value">{centres.length}</span>
          </div>
        </div>
        <div className="stat-card-mini">
          <div className="icon"><Activity size={16} /></div>
          <div className="content">
            <span className="label">
              {userContext?.role === 'SUPER ADMIN' ? 'Disponibilité Réseau' : `Disponibilité : ${(() => {
                const s = sites.find(x => x.id === userContext?.site_id);
                return s ? s.nom : 'Mon Site';
              })()}`}
            </span>
            <span className="value" style={{ color: 'var(--accent-green)' }}>100%</span>
          </div>
        </div>
      </div>

      {/* Main Content Table */}
      <div className="card card-premium" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {activeTab === 'SITES' ? (
            <>
              <div className="table-container" style={{ overflowX: 'auto', width: '100%' }}>
              <table className="table-premium">
                <thead>
                  <tr>
                    <th>ÉTAT SYSTÈME</th>
                    <th>IDENTIFIANT</th>
                    <th>DÉSIGNATION DU SITE</th>
                    <th>CAPACITÉ</th>
                    <th>DÉPLOIEMENT</th>
                    <th>LICENCE</th>
                    <th style={{ textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(s => (
                    <tr key={s.id} className={!s.is_active ? 'row-inactive' : ''}>
                      <td>
                        <div className={`status-badge ${s.is_active ? 'active' : 'banned'}`}>
                          <div className="pulse-dot" />
                          {s.is_active ? 'OPÉRATIONNEL' : 'ACCÈS RÉVOQUÉ'}
                        </div>
                      </td>
                      <td><code className="code-tag">{s.code}</code></td>
                      <td><span style={{ fontWeight: 700, fontSize: 14 }}>{s.nom}</span></td>
                      <td>
                         <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="progress-bar-mini"><div style={{ width: '60%' }} /></div>
                            <span style={{ fontSize: 12 }}>{s.max_centres} Centres</span>
                         </div>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{new Date(s.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td>
                        {s.is_permanent === 1 ? (
                          <span style={{ color: 'var(--accent-green)', fontSize: 12, fontWeight: 600 }}>PERMANENTE</span>
                        ) : s.expiry_date ? (
                          <span style={{ color: new Date(s.expiry_date) < new Date() ? 'var(--accent-red)' : 'var(--text-muted)', fontSize: 12 }}>
                            {new Date(s.expiry_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Non définie</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button className="btn-action" onClick={() => setEditingSite(s)} title="Paramètres"><Edit size={14} /></button>
                          {s.is_active ? (
                            <button className="btn-action ban" onClick={() => setConfirmModal({ type: 'BAN', site: s })} title="Révoquer l'accès"><Lock size={14} /></button>
                          ) : (
                            <button className="btn-action activate" onClick={() => setConfirmModal({ type: 'ACTIVATE', site: s })} title="Restaurer l'accès"><Unlock size={14} /></button>
                          )}
                          <button className="btn-action delete" onClick={() => setConfirmModal({ type: 'DELETE', site: s })} title="Suppression irréversible"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          ) : (
            <>
              <div className="table-container" style={{ overflowX: 'auto', width: '100%' }}>
              <table className="table-premium">
                <thead>
                  <tr>
                    <th>RÉFÉRENCE</th>
                    <th>NOM DU CENTRE</th>
                    <th>LOCALISATION GÉOGRAPHIQUE</th>
                    <th>PRÉFIXE CSV</th>
                    <th>SITE DE RATTACHEMENT</th>
                    <th style={{ textAlign: 'right' }}>STATUT</th>
                  </tr>
                </thead>
                <tbody>
                  {centres.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(c => (
                    <tr key={c.sync_id || c.id}>
                      <td><span className="id-badge">ID-{c.numero.toString().padStart(2, '0')}</span></td>
                      <td style={{ fontWeight: 700 }}>{c.nom}</td>
                      <td>{c.lieu || 'Zone non définie'}</td>
                      <td>
                        {c.prefixe_rangement ? (
                          <code className="code-tag" style={{ color: '#FFD700', border: '1px solid #FFD700' }}>
                            {c.prefixe_rangement}
                          </code>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Aucun</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <MapPin size={12} color="var(--accent-primary)" />
                          <span className="badge-site">{c.site_nom || 'SITE PRINCIPAL'}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                            <span className="status-badge active">EN SERVICE</span>
                            <button className="btn-action" onClick={() => setEditingCentre(c)} title="Modifier le Centre"><Edit size={14} /></button>
                            {!(c.numero === 1 || (c.nom && c.nom.toUpperCase().includes('PRINCIPAL'))) && (
                              <button className="btn-action" style={{ color: 'var(--accent-red)' }} onClick={() => handleDeleteCentre(c.id)} title="Supprimer ce centre"><Trash2 size={14} /></button>
                            )}
                          </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>

        {/* ZONE PAGINATION SITES / CENTRES */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', background: 'rgba(255, 255, 255, 0.01)', borderTop: '1px solid rgba(255, 255, 255, 0.05)', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Affichage de <strong>{(activeTab === 'SITES' ? sites : centres).length > 0 ? ((currentPage - 1) * itemsPerPage) + 1 : 0}</strong> à <strong>{Math.min(currentPage * itemsPerPage, (activeTab === 'SITES' ? sites : centres).length)}</strong> sur <strong>{(activeTab === 'SITES' ? sites : centres).length}</strong> éléments
          </span>
          {Math.ceil((activeTab === 'SITES' ? sites : centres).length / itemsPerPage) > 1 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button 
                className="btn-secondary" 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} 
                disabled={currentPage === 1} 
                style={{ padding: '8px 16px', fontSize: 13, opacity: currentPage === 1 ? 0.5 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, background: 'rgba(255,255,255,0.02)', color: 'white' }}
              >
                Précédent
              </button>
              <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 13, fontWeight: 600, color: 'white' }}>
                Page {currentPage} sur {Math.ceil((activeTab === 'SITES' ? sites : centres).length / itemsPerPage)}
              </span>
              <button 
                className="btn-secondary" 
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil((activeTab === 'SITES' ? sites : centres).length / itemsPerPage)))} 
                disabled={currentPage === Math.ceil((activeTab === 'SITES' ? sites : centres).length / itemsPerPage)} 
                style={{ padding: '8px 16px', fontSize: 13, opacity: currentPage === Math.ceil((activeTab === 'SITES' ? sites : centres).length / itemsPerPage) ? 0.5 : 1, cursor: currentPage === Math.ceil((activeTab === 'SITES' ? sites : centres).length / itemsPerPage) ? 'not-allowed' : 'pointer', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, background: 'rgba(255,255,255,0.02)', color: 'white' }}
              >
                Suivant
              </button>
            </div>
          )}
        </div>
      </div>

      {/* MODAL MODIFICATION PARAMÈTRES */}
      {editingSite && (
        <div className="modal-overlay-premium">
          <div className="modal-content-premium" style={{ maxWidth: 450 }}>
            <div className="modal-header">
              <div className="icon-wrapper primary"><Edit size={24} /></div>
              <div className="title-group">
                <h3>Paramètres de l'Infrastructure</h3>
                <p>Modification du site : <strong>{editingSite.nom}</strong></p>
              </div>
              <button className="close-btn" onClick={() => setEditingSite(null)}><X size={20} /></button>
            </div>
            
            <form onSubmit={handleUpdateSite} className="modal-body">
              <div className="input-group-premium">
                <label>Nom du Site (Lecture seule)</label>
                <input className="input-p" type="text" value={editingSite.nom} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
              </div>
              
              <div className="input-group-premium" style={{ marginTop: 20 }}>
                <label>Statut du Site</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', width: '100%' }}>
                    <input 
                      type="checkbox" 
                      checked={editingSite.is_active === 1}
                      onChange={e => setEditingSite({ ...editingSite, is_active: e.target.checked ? 1 : 0 })}
                      style={{ width: 18, height: 18, accentColor: editingSite.is_active ? 'var(--accent-green)' : 'var(--accent-red)' }}
                    />
                    <span style={{ fontSize: 14, fontWeight: 600, color: editingSite.is_active ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                      {editingSite.is_active ? 'SITE OPÉRATIONNEL (Accès Autorisé)' : 'SITE BLOQUÉ (Accès Suspendu)'}
                    </span>
                  </label>
                </div>
              </div>

              <div className="input-group-premium" style={{ marginTop: 20 }}>
                <label>Quota maximum de centres</label>
                <div className="input-wrapper">
                  <Building2 size={16} className="field-icon" />
                  <input 
                    className="input-p" 
                    type="number" 
                    value={editingSite.max_centres} 
                    onChange={e => setEditingSite({ ...editingSite, max_centres: parseInt(e.target.value) })} 
                    min={1} 
                    required 
                  />
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>Définit le nombre de centres physiques autorisés pour ce site.</p>
              </div>

              <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, color: 'var(--accent-primary)' }}>
                  <ShieldCheck size={18} />
                  <span style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Configuration Licence</span>
                </div>
                
                <div className="input-group-premium" style={{ marginBottom: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={editingSite.is_permanent === 1}
                      onChange={e => setEditingSite({ ...editingSite, is_permanent: e.target.checked ? 1 : 0 })}
                      style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)' }}
                    />
                    <span style={{ fontSize: 14 }}>Licence Permanente (Illimitée)</span>
                  </label>
                </div>

                {editingSite.is_permanent === 0 && (
                  <div className="input-group-premium">
                    <label>Date d'expiration</label>
                    <input 
                      className="input-p" 
                      type="date" 
                      value={editingSite.expiry_date ? editingSite.expiry_date.split('T')[0] : ''}
                      onChange={e => setEditingSite({ ...editingSite, expiry_date: e.target.value ? new Date(e.target.value).toISOString() : null })}
                      required
                    />
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setEditingSite(null)}>Annuler</button>
                <button type="submit" className="btn-execute btn-primary">ENREGISTRER</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMATION SÉCURISÉE (LOOK PREMIUM) */}
      {confirmModal && (
        <div className="modal-overlay-premium">
          <div className={`modal-content-premium ${confirmModal.type === 'DELETE' ? 'danger' : 'secure'}`}>
            <div className="modal-header">
              <div className="icon-wrapper">
                {confirmModal.type === 'DELETE' ? <AlertTriangle size={24} /> : <ShieldCheck size={24} />}
              </div>
              <div className="title-group">
                <h3>Action de Haute Sécurité</h3>
                <p>Authentification requise pour continuer</p>
              </div>
              <button className="close-btn" onClick={() => { setConfirmModal(null); setAdminPassword(''); }}><X size={20} /></button>
            </div>

            <div className="modal-body">
              <div className="action-summary">
                <span className="label">Opération :</span>
                <span className={`value ${confirmModal.type === 'DELETE' ? 'text-red' : 'text-primary'}`}>
                  {confirmModal.type === 'DELETE' ? 'PURGE COMPLÈTE DU SITE' : confirmModal.type === 'BAN' ? 'RÉVOCATION D\'ACCÈS' : 'RESTAURATION D\'ACCÈS'}
                </span>
              </div>
              
              <div className="target-info">
                <MapPin size={14} />
                <span>Cible : <strong>{confirmModal.site.nom}</strong> ({confirmModal.site.code})</span>
              </div>

              {confirmModal.type === 'DELETE' && (
                <div className="warning-box">
                  <AlertTriangle size={16} />
                  <p><strong>ATTENTION :</strong> Cette action supprimera irréversiblement toutes les cartes, agents et centres liés à ce site.</p>
                </div>
              )}

              <form onSubmit={handleSecureAction} style={{ marginTop: 24 }}>
                <div className="input-group-premium">
                  <label>Vérification Administrateur</label>
                  <div className="input-wrapper">
                    <Lock size={16} className="field-icon" />
                    <input 
                      className="input-p"
                      type="password" 
                      value={adminPassword} 
                      onChange={e => setAdminPassword(e.target.value)} 
                      placeholder="Saisissez votre mot de passe maître"
                      autoFocus
                      required
                    />
                  </div>
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn-secondary" disabled={isVerifying} onClick={() => { setConfirmModal(null); setAdminPassword(''); }}>Abandonner</button>
                  <button type="submit" className={`btn-execute ${confirmModal.type === 'DELETE' ? 'btn-danger' : 'btn-primary'}`} disabled={isVerifying}>
                    {isVerifying ? 'VÉRIFICATION...' : confirmModal.type === 'DELETE' ? 'EXÉCUTER LA PURGE' : 'VALIDER L\'ACTION'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CRÉATION SITE */}
      {showSiteModal && (
        <div className="modal-overlay-premium">
          <div className="modal-content-premium" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <div className="icon-wrapper primary"><Plus size={24} /></div>
              <div className="title-group">
                <h3>Déploiement Nouveau Site</h3>
                <p>Configurez les paramètres de la zone géographique</p>
              </div>
              <button className="close-btn" onClick={() => setShowSiteModal(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateSite} className="modal-body">
              <div className="input-group-premium">
                <label>Nom de la Commune / Ville</label>
                <input className="input-p" type="text" value={siteFormData.nom} onChange={e => setSiteFormData({ ...siteFormData, nom: e.target.value.toUpperCase() })} placeholder="Ex: PLATEAU" required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div className="input-group-premium">
                  <label>Code Système (2-5 car.)</label>
                  <input className="input-p" type="text" value={siteFormData.code} onChange={e => setSiteFormData({ ...siteFormData, code: e.target.value.toUpperCase() })} placeholder="Ex: PLT" maxLength={5} required />
                </div>
                <div className="input-group-premium">
                  <label>Quota de Centres</label>
                  <input className="input-p" type="number" value={siteFormData.max_centres} onChange={e => setSiteFormData({ ...siteFormData, max_centres: parseInt(e.target.value) })} min={1} required />
                </div>
              </div>

              {/* SECTION LICENCE */}
              <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, color: 'var(--accent-primary)' }}>
                  <ShieldCheck size={18} />
                  <span style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Configuration Licence</span>
                </div>
                
                <div className="input-group-premium" style={{ marginBottom: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={siteFormData.is_permanent}
                      onChange={e => setSiteFormData({ ...siteFormData, is_permanent: e.target.checked })}
                      style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)' }}
                    />
                    <span style={{ fontSize: 14 }}>Licence Permanente (Illimitée)</span>
                  </label>
                </div>

                {!siteFormData.is_permanent && (
                  <div className="input-group-premium">
                    <label>Date d'expiration</label>
                    <input 
                      className="input-p" 
                      type="date" 
                      value={siteFormData.expiry_date ? siteFormData.expiry_date.split('T')[0] : ''}
                      onChange={e => setSiteFormData({ ...siteFormData, expiry_date: e.target.value ? new Date(e.target.value).toISOString() : '' })}
                      required
                    />
                  </div>
                )}
              </div>

              {/* SECTION ADMINISTRATEUR */}
              <div style={{ marginTop: 24, padding: 16, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px dashed rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, color: 'var(--accent-primary)' }}>
                  <ShieldCheck size={18} />
                  <span style={{ fontWeight: 700, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Configuration Administrateur</span>
                </div>
                
                <div className="input-group-premium">
                  <label>Nom complet du responsable</label>
                  <input 
                    className="input-p" 
                    type="text" 
                    value={siteFormData.adminNom} 
                    onChange={e => setSiteFormData({ ...siteFormData, adminNom: e.target.value })} 
                    placeholder="Ex: Koffi Kouassi" 
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
                  <div className="input-group-premium">
                    <label>Identifiant (Login)</label>
                    <input 
                      className="input-p" 
                      type="text" 
                      value={siteFormData.adminLogin} 
                      onChange={e => setSiteFormData({ ...siteFormData, adminLogin: e.target.value.toLowerCase() })} 
                      placeholder="admin_plateau" 
                      required 
                    />
                  </div>
                  <div className="input-group-premium">
                    <label>Mot de passe initial</label>
                    <input 
                      className="input-p" 
                      type="password" 
                      value={siteFormData.adminPassword} 
                      onChange={e => setSiteFormData({ ...siteFormData, adminPassword: e.target.value })} 
                      placeholder="••••••••" 
                      required 
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowSiteModal(false)}>Annuler</button>
                <button type="submit" className="btn-execute btn-primary">DÉPLOYER LE SITE</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CRÉATION CENTRE */}
      {showCentreModal && (
        <div className="modal-overlay-premium">
          <div className="modal-content-premium" style={{ maxWidth: 450 }}>
            <div className="modal-header">
              <div className="icon-wrapper primary"><Plus size={24} /></div>
              <div className="title-group">
                <h3>Nouveau Centre</h3>
                <p>Créer un nouveau centre de collecte</p>
              </div>
              <button className="close-btn" onClick={() => setShowCentreModal(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleCreateCentre} className="modal-body">
              {userContext?.role === 'SUPER ADMIN' && (
                <div className="input-group-premium">
                  <label>Site de Rattachement</label>
                  <select 
                    className="input-p" 
                    style={{ width: '100%', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, color: 'white', marginTop: 8 }}
                    value={centreFormData.site_id} 
                    onChange={e => setCentreFormData({...centreFormData, site_id: e.target.value})}
                    required
                  >
                    <option value="" style={{ color: 'black' }}>-- Sélectionner un Site --</option>
                    {sites.map(s => <option key={s.id} value={s.id} style={{ color: 'black' }}>{s.nom}</option>)}
                  </select>
                </div>
              )}
              <div className="input-group-premium" style={{ marginTop: 16 }}>
                <label>Nom du Centre</label>
                <input className="input-p" type="text" value={centreFormData.nom} onChange={e => setCentreFormData({...centreFormData, nom: e.target.value.toUpperCase()})} placeholder="Ex: CENTRE COMMUNAUTAIRE" required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
                <div className="input-group-premium">
                  <label>Numéro de Centre</label>
                  <input className="input-p" type="number" value={centreFormData.numero} onChange={e => setCentreFormData({...centreFormData, numero: e.target.value})} placeholder="Ex: 2" required />
                </div>
                <div className="input-group-premium">
                  <label>Lieu (Optionnel)</label>
                  <input className="input-p" type="text" value={centreFormData.lieu} onChange={e => setCentreFormData({...centreFormData, lieu: e.target.value.toUpperCase()})} placeholder="Quartier..." />
                </div>
              </div>
              <div className="input-group-premium" style={{ marginTop: 16 }}>
                <label>Préfixe de Rangement (Import CSV)</label>
                <input className="input-p" type="text" value={centreFormData.prefixe_rangement || ''} onChange={e => setCentreFormData({...centreFormData, prefixe_rangement: e.target.value.toUpperCase()})} placeholder="Ex: BOX FHB, PK18" />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                  Pour plusieurs préfixes, séparez-les par des virgules (ex: <code>BOX FHB, FHB, GESTION</code>).
                </span>
              </div>
              {userContext?.role !== 'SUPER ADMIN' && centres.filter(c => c.site_id === userContext?.site_id).length >= (sites.find(x => x.id === userContext?.site_id)?.max_centres || 4) && (
                <div style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: 12, borderRadius: 12, display: 'flex', gap: 10, color: '#ef4444', fontSize: 12, marginTop: 16, alignItems: 'flex-start' }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ margin: 0, lineHeight: 1.4 }}>
                    <strong>🚫 Limite atteinte :</strong> Vous avez atteint le quota maximal de centres autorisés pour votre site. Veuillez contacter le Super Administrateur.
                  </p>
                </div>
              )}
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowCentreModal(false)}>Annuler</button>
                <button 
                  type="submit" 
                  disabled={userContext?.role !== 'SUPER ADMIN' && centres.filter(c => c.site_id === userContext?.site_id).length >= (sites.find(x => x.id === userContext?.site_id)?.max_centres || 4)}
                  className="btn-execute btn-primary"
                >
                  CRÉER LE CENTRE
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL MODIFICATION CENTRE */}
      {editingCentre && (
        <div className="modal-overlay-premium">
          <div className="modal-content-premium" style={{ maxWidth: 450 }}>
            <div className="modal-header">
              <div className="icon-wrapper primary"><Edit size={24} /></div>
              <div className="title-group">
                <h3>Modifier le Centre</h3>
                <p>Mettre à jour les informations du centre</p>
              </div>
              <button className="close-btn" onClick={() => setEditingCentre(null)}><X size={20} /></button>
            </div>
            <form onSubmit={handleUpdateCentre} className="modal-body">
              <div className="input-group-premium">
                <label>Nom du Centre</label>
                <input className="input-p" type="text" value={editingCentre.nom} onChange={e => setEditingCentre({...editingCentre, nom: e.target.value.toUpperCase()})} required />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
                <div className="input-group-premium">
                  <label>Numéro de Centre</label>
                  <input className="input-p" type="number" value={editingCentre.numero} onChange={e => setEditingCentre({...editingCentre, numero: e.target.value})} required />
                </div>
                <div className="input-group-premium">
                  <label>Préfixe de Rangement</label>
                  <input className="input-p" type="text" value={editingCentre.prefixe_rangement || ''} onChange={e => setEditingCentre({...editingCentre, prefixe_rangement: e.target.value.toUpperCase()})} placeholder="Ex: BOX FHB, PK18" />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                    Séparez par des virgules pour plusieurs préfixes.
                  </span>
                </div>
              </div>
              <div className="input-group-premium" style={{ marginTop: 16 }}>
                <label>Lieu (Optionnel)</label>
                <input className="input-p" type="text" value={editingCentre.lieu || ''} onChange={e => setEditingCentre({...editingCentre, lieu: e.target.value.toUpperCase()})} placeholder="Ex: ABIDJAN, YAMOUSSOUKRO..." />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setEditingCentre(null)}>Annuler</button>
                <button type="submit" className="btn-execute btn-primary">ENREGISTRER</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Styles inline pour le look Premium si non présents dans index.css */}
      <style>{`
        .card-premium {
          background: rgba(18, 22, 33, 0.6) !important;
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.05) !important;
          box-shadow: 0 12px 40px rgba(0,0,0,0.3) !important;
        }
        .tabs-premium {
          background: rgba(255,255,255,0.03);
          padding: 4px;
          border-radius: 12px;
          display: flex;
          gap: 4px;
          border: 1px solid rgba(255,255,255,0.05);
        }
        .tabs-premium button {
          padding: 8px 16px;
          border-radius: 10px;
          border: none;
          background: transparent;
          color: var(--text-muted);
          font-size: 13px;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .tabs-premium button.active {
          background: rgba(255,255,255,0.08);
          color: white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        .stat-card-mini {
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 16px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .stat-card-mini .icon {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: rgba(255,255,255,0.05);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent-primary);
        }
        .stat-card-mini .label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; display: block; }
        .stat-card-mini .value { font-size: 18px; font-weight: 800; color: white; }
        
        .table-premium { width: 100%; border-collapse: collapse; }
        .table-premium th { text-align: left; padding: 16px 24px; font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .table-premium td { padding: 16px 24px; border-bottom: 1px solid rgba(255,255,255,0.03); vertical-align: middle; }
        .table-premium tr:hover { background: rgba(255,255,255,0.02); }
        .row-inactive { opacity: 0.5; }
        
        .status-badge { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px; border-radius: 20px; font-size: 10px; font-weight: 700; }
        .status-badge.active { background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2); }
        .status-badge.banned { background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); }
        .pulse-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse 2s infinite; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
        
        .code-tag { background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 6px; font-family: monospace; color: var(--accent-primary); border: 1px solid rgba(255,255,255,0.08); }
        .btn-action { width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .btn-action:hover { background: rgba(255,255,255,0.08); color: white; border-color: rgba(255,255,255,0.2); }
        .btn-action.delete:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.3); }
        .btn-action.ban:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.3); }
        .btn-action.activate:hover { background: rgba(16, 185, 129, 0.1); color: #10b981; border-color: rgba(16, 185, 129, 0.3); }

        /* MODAL PREMIUM */
        .modal-overlay-premium { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(5, 7, 15, 0.85); backdrop-filter: blur(12px); display: flex; align-items: center; justify-content: center; z-index: 9999; animation: fadeIn 0.3s; }
        .modal-content-premium { background: #131722; width: 95%; max-width: 450px; max-height: 90vh; border-radius: 24px; border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 32px 64px -12px rgba(0, 0, 0, 0.6); overflow-y: auto; overflow-x: hidden; position: relative; display: flex; flex-direction: column; }
        .modal-content-premium.danger { border-top: 4px solid #ef4444; }
        .modal-content-premium.secure { border-top: 4px solid var(--accent-primary); }
        
        .modal-header { padding: 32px 32px 20px; display: flex; gap: 20px; position: relative; }
        .icon-wrapper { width: 48px; height: 48px; border-radius: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .modal-content-premium.danger .icon-wrapper { background: rgba(239, 68, 68, 0.1); color: #ef4444; }
        .modal-content-premium.secure .icon-wrapper { background: rgba(79, 70, 229, 0.1); color: var(--accent-primary); }
        .icon-wrapper.primary { background: rgba(79, 70, 229, 0.1); color: var(--accent-primary); }
        
        .title-group { flex: 1; padding-right: 50px; }
        .title-group h3 { margin: 0 0 4px; font-size: 17px; font-weight: 800; color: white; line-height: 1.2; }
        .title-group p { margin: 0; font-size: 12px; color: var(--text-muted); }
        .close-btn { position: absolute; top: 20px; right: 20px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); color: var(--text-muted); cursor: pointer; padding: 8px; border-radius: 12px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; z-index: 10; }
        .close-btn:hover { background: rgba(239, 68, 68, 0.1); color: #ef4444; border-color: rgba(239, 68, 68, 0.2); transform: rotate(90deg); }
        
        .modal-body { padding: 0 32px 32px; }
        .action-summary { background: rgba(255,255,255,0.02); padding: 12px 16px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.05); }
        .action-summary .label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; font-weight: 700; }
        .action-summary .value { font-size: 13px; font-weight: 800; }
        .text-red { color: #ef4444; }
        .text-primary { color: var(--accent-primary); }
        
        .target-info { display: flex; align-items: center; gap: 8px; font-size: 13px; color: white; margin-bottom: 20px; padding-left: 4px; }
        .warning-box { background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.1); padding: 12px 16px; border-radius: 12px; display: flex; gap: 12px; color: #ef4444; font-size: 12px; line-height: 1.5; }
        
        .input-group-premium label { display: block; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; letter-spacing: 0.05em; }
        .input-wrapper { position: relative; }
        .field-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--text-muted); pointer-events: none; }
        
        .input-p { width: 100%; background: #0c0f17 !important; border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 12px !important; height: 48px; padding: 0 16px; color: white !important; font-size: 14px; transition: all 0.2s; }
        .input-p::placeholder { color: rgba(255,255,255,0.3); }
        .input-p:focus { border-color: var(--accent-primary) !important; outline: none; box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.1); }
        .input-wrapper .input-p { padding-left: 44px; }
        
        .modal-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 32px; }
        .btn-secondary { height: 48px; border-radius: 14px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: white; font-weight: 700; cursor: pointer; }
        .btn-secondary:hover { background: rgba(255,255,255,0.08); }
        .btn-execute { height: 48px; border-radius: 14px; border: none; color: white; font-weight: 800; cursor: pointer; transition: all 0.2s; font-size: 13px; letter-spacing: 0.02em; }
        .btn-execute.btn-primary { background: linear-gradient(135deg, var(--accent-primary) 0%, #6366f1 100%); box-shadow: 0 8px 20px rgba(79, 70, 229, 0.3); }
        .btn-execute.btn-danger { background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); box-shadow: 0 8px 20px rgba(239, 68, 68, 0.3); }
        .btn-execute:hover { transform: translateY(-2px); filter: brightness(1.1); }
        .btn-execute:active { transform: translateY(0); }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </div>
  );
}
