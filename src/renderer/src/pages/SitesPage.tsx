import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Edit, Trash2, MapPin, Building2, Save, X, Lock, Unlock, AlertTriangle, ShieldCheck, ChevronRight, Activity, Database, CloudDownload, CloudUpload, RefreshCw, Globe } from 'lucide-react';
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
  const [dirtyCentresCount, setDirtyCentresCount] = useState(0);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  // Modals state
  const [showCentreModal, setShowCentreModal] = useState(false);
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [editingCentre, setEditingCentre] = useState<any>(null);
  const [confirmModal, setConfirmModal] = useState<{ type: 'DELETE' | 'BAN' | 'ACTIVATE' | 'UPDATE', site: Site } | null>(null);
  
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

  const loadData = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const s = await window.api.hierarchy.getSites();
      setSites(s);
      useCacheStore.getState().setSitesCache(s);
      const c = await window.api.hierarchy.getCentres(userContext?.role === 'SUPER ADMIN' ? undefined : userContext?.site_id);
      setCentres(c);
      useCacheStore.getState().setCentresCache(c);
      
      if (userContext?.site_id) {
        try {
          const count = await window.api.stats.getUnsyncedCentresCount(userContext.site_id);
          setDirtyCentresCount(count);
        } catch (err) {
          console.error("Failed to get unsynced centres count", err);
        }
      }
    } catch (e) { console.error(e); }
    finally { 
      if (!silent) setLoading(false);
      useAuthStore.getState().setInitialDataLoading(false);
    }
  }, [userContext]);

  useEffect(() => { 
    setCurrentPage(1);
    const cache = useCacheStore.getState().sitesCache;
    const cacheCentres = useCacheStore.getState().centresCache;
    let hasCache = false;

    if (cache.cachedAt && cache.list.length > 0 && cacheCentres.cachedAt && cacheCentres.list.length > 0) {
      setSites(cache.list);
      setCentres(cacheCentres.list);
      setLoading(false);
      hasCache = true;
      useAuthStore.getState().setInitialDataLoading(false);
    }

    if (!hasCache) {
      loadData();
    }

    const handleDataUpdated = () => loadData(true);
    window.addEventListener('app:data-updated', handleDataUpdated);

    return () => window.removeEventListener('app:data-updated', handleDataUpdated);
  }, [userContext?.site_id, activeTab, loadData]);

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
      }, userContext);
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
      await loadData();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleUpdateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSite) return;
    setConfirmModal({ type: 'UPDATE', site: editingSite });
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
      await loadData();
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
        prefixe_rangement: editingCentre.prefixe_rangement || null,
        lieu: editingCentre.lieu || null,
        code: editingCentre.code || null
      });
      toast.success('Centre modifié avec succès');
      setEditingCentre(null);
      await loadData();
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
      await loadData();
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
      } else if (type === 'UPDATE') {
        await window.api.hierarchy.updateSite(site.id, {
          nom: site.nom,
          code: site.code,
          max_centres: site.max_centres,
          expiry_date: site.is_permanent ? null : (site.expiry_date || null),
          is_permanent: site.is_permanent ? 1 : 0,
          is_active: site.is_active
        });
        toast.success('Modifications enregistrées avec succès');
        setEditingSite(null);
      }

      setConfirmModal(null);
      setAdminPassword('');
      await loadData();
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
        await loadData();
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
        setDirtyCentresCount(0);
        await loadData();
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
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', padding: 'clamp(16px, 2.5vw, 32px)', overflowY: 'auto' }}>
      
      {/* Header Professionnel Responsive */}
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

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          {userContext?.role === 'SUPER ADMIN' ? (
            <div className="tabs-premium">
              <button className={activeTab === 'SITES' ? 'active' : ''} onClick={() => { setActiveTab('SITES'); setCurrentPage(1); }}>
                <MapPin size={16} /> Sites
              </button>
              <button className={activeTab === 'CENTRES' ? 'active' : ''} onClick={() => { setActiveTab('CENTRES'); setCurrentPage(1); }}>
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
                style={{ 
                  background: (isPushingCentres || dirtyCentresCount === 0) ? '#555555' : 'var(--accent-primary)',
                  cursor: (isPushingCentres || dirtyCentresCount === 0) ? 'not-allowed' : 'pointer',
                  opacity: (isPushingCentres || dirtyCentresCount === 0) ? 0.5 : 1
                }}
                onClick={handlePushCentres}
                disabled={isPushingCentres || loading || dirtyCentresCount === 0}
                title="Envoyer les centres vers le Cloud"
              >
                <CloudUpload size={18} className={isPushingCentres ? 'animate-bounce' : ''} />
                {isPushingCentres ? 'Envoi en cours...' : (dirtyCentresCount > 0 ? `Envoyer les centres (${dirtyCentresCount})` : '✅ Centres à jour')}
              </button>
              <button className="btn btn-outline" style={{ width: 44, height: 44, padding: 0, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} onClick={() => loadData()}>
                <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
              </button>
            </>
          )}

          {(userContext?.role === 'SUPER ADMIN' || activeTab === 'CENTRES') && (
            <button 
              className="btn btn-primary btn-lg" 
              disabled={userContext?.role !== 'SUPER ADMIN' && centres.filter(c => c.site_id === userContext?.site_id).length >= (sites.find(x => x.id === userContext?.site_id)?.max_centres || 4)}
              onClick={() => activeTab === 'SITES' ? setShowSiteModal(true) : setShowCentreModal(true)}
            >
              <Plus size={18} /> {activeTab === 'SITES' ? 'Nouveau Site' : 'Nouveau Centre'}
            </button>
          )}
        </div>
      </div>

      {/* Statistiques Rapides Responsive */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20 }}>
        {userContext?.role === 'SUPER ADMIN' && (
          <div className="stat-card-mini" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', background: 'rgba(255, 255, 255, 0.025)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 16 }}>
            <div className="icon" style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#818cf8', flexShrink: 0 }}>
              <MapPin size={20} />
            </div>
            <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="label" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sites Total</span>
              <span className="value" style={{ fontSize: 22, fontWeight: 800, color: 'white' }}>{sites.length}</span>
            </div>
          </div>
        )}
        <div className="stat-card-mini" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', background: 'rgba(255, 255, 255, 0.025)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 16 }}>
          <div className="icon" style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa', flexShrink: 0 }}>
            <Building2 size={20} />
          </div>
          <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="label" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Centres Actifs</span>
            <span className="value" style={{ fontSize: 22, fontWeight: 800, color: 'white' }}>{centres.length}</span>
          </div>
        </div>
        <div className="stat-card-mini" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', background: 'rgba(255, 255, 255, 0.025)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 16 }}>
          <div className="icon" style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34d399', flexShrink: 0 }}>
            <Activity size={20} />
          </div>
          <div className="content" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="label" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {userContext?.role === 'SUPER ADMIN' ? 'Disponibilité Réseau' : `Disponibilité (${(() => {
                const s = sites.find(x => x.id === userContext?.site_id);
                return s ? s.nom : 'Mon Site';
              })()})`}
            </span>
            <span className="value" style={{ fontSize: 22, fontWeight: 800, color: '#34d399' }}>100%</span>
          </div>
        </div>
      </div>

      {/* Main Content Table Responsive */}
      <div className="card card-premium" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 420 }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {activeTab === 'SITES' ? (
            <>
              <div className="table-container" style={{ overflowX: 'auto', width: '100%', WebkitOverflowScrolling: 'touch' }}>
              <table className="table-premium" style={{ width: '100%', minWidth: 880, borderCollapse: 'collapse' }}>
                <thead style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '2px solid rgba(255, 255, 255, 0.08)' }}>
                  <tr>
                    <th style={{ width: '14%', textAlign: 'center', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>ÉTAT SYSTÈME</th>
                    <th style={{ width: '12%', textAlign: 'center', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>IDENTIFIANT</th>
                    <th style={{ width: '28%', textAlign: 'left', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>DÉSIGNATION DU SITE</th>
                    <th style={{ width: '16%', textAlign: 'left', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>CAPACITÉ</th>
                    <th style={{ width: '15%', textAlign: 'center', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>DÉPLOIEMENT</th>
                    <th style={{ width: '15%', textAlign: 'center', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>LICENCE</th>
                    <th style={{ width: '12%', textAlign: 'right', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(s => (
                    <tr key={s.id} className={!s.is_active ? 'row-inactive' : ''} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', transition: 'background 0.2s ease' }}>
                      <td style={{ textAlign: 'center', padding: '16px' }}>
                        <div className={`status-badge ${s.is_active ? 'active' : 'banned'}`} style={{ display: 'inline-flex', justifyContent: 'center' }}>
                          <div className="pulse-dot" />
                          {s.is_active ? 'OPÉRATIONNEL' : 'ACCÈS RÉVOQUÉ'}
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '16px' }}><code className="code-tag">{s.code}</code></td>
                      <td style={{ textAlign: 'left', padding: '16px' }}><span style={{ fontWeight: 700, fontSize: 14, color: 'white' }}>{s.nom}</span></td>
                      <td style={{ textAlign: 'left', padding: '16px' }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="progress-bar-mini" style={{ width: 60 }}><div style={{ width: '60%' }} /></div>
                            <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>{s.max_centres} Centres</span>
                         </div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: 13 }}>{new Date(s.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td style={{ textAlign: 'center', padding: '16px' }}>
                        {s.is_permanent === 1 ? (
                          <span style={{ color: 'var(--accent-green)', fontSize: 12, fontWeight: 700, background: 'rgba(16, 185, 129, 0.1)', padding: '4px 10px', borderRadius: 12, border: '1px solid rgba(16, 185, 129, 0.2)' }}>PERMANENTE</span>
                        ) : s.expiry_date ? (
                          <span style={{ color: new Date(s.expiry_date) < new Date() ? 'var(--accent-red)' : 'var(--text-muted)', fontSize: 12 }}>
                            {new Date(s.expiry_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Non définie</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', padding: '16px' }}>
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
              <div className="table-container" style={{ overflowX: 'auto', width: '100%', WebkitOverflowScrolling: 'touch' }}>
              <table className="table-premium" style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse' }}>
                <thead style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '2px solid rgba(255, 255, 255, 0.08)' }}>
                  <tr>
                    <th style={{ width: '11%', textAlign: 'center', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>RÉFÉRENCE</th>
                    <th style={{ width: '29%', textAlign: 'left', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>DÉSIGNATION DU CENTRE</th>
                    <th style={{ width: '18%', textAlign: 'left', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>LOCALISATION</th>
                    <th style={{ width: '13%', textAlign: 'center', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>PRÉFIXE CSV</th>
                    <th style={{ width: '14%', textAlign: 'center', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>SITE D'ATTACHEMENT</th>
                    <th style={{ width: '13%', textAlign: 'center', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>STATUT</th>
                    <th style={{ width: '10%', textAlign: 'right', padding: '14px 16px', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {centres.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map(c => (
                    <tr key={c.sync_id || c.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', transition: 'background 0.2s ease' }}>
                      <td style={{ textAlign: 'center', padding: '16px' }}>
                        <span style={{ display: 'inline-block', padding: '5px 12px', borderRadius: 8, background: 'rgba(255, 255, 255, 0.06)', border: '1px solid rgba(255, 255, 255, 0.1)', fontFamily: 'monospace', fontWeight: 800, fontSize: 12, color: 'white', letterSpacing: '0.04em' }}>
                          ID: #{c.id}
                        </span>
                      </td>
                      <td style={{ textAlign: 'left', padding: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: 'white' }}>{c.nom}</span>
                          {(c.numero === 1 || (c.nom && c.nom.toUpperCase().includes('PRINCIPAL'))) && (
                            <span style={{ fontSize: 10, fontWeight: 800, background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.2), rgba(245, 158, 11, 0.1))', color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.35)', padding: '2px 8px', borderRadius: 12, letterSpacing: '0.05em', textTransform: 'uppercase', boxShadow: '0 2px 6px rgba(251, 191, 36, 0.1)', whiteSpace: 'nowrap' }}>
                              ★ PRINCIPAL
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ textAlign: 'left', padding: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: c.lieu ? '#e2e8f0' : 'var(--text-muted)', fontSize: 13, fontWeight: 500 }}>
                          <MapPin size={14} color={c.lieu ? '#818cf8' : 'var(--text-muted)'} style={{ flexShrink: 0 }} />
                          <span>{c.lieu || 'Zone non définie'}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '16px' }}>
                        {c.prefixe_rangement ? (
                          <code style={{ display: 'inline-block', background: 'rgba(251, 191, 36, 0.12)', color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.3)', borderRadius: 6, padding: '4px 10px', fontFamily: 'monospace', fontWeight: 800, fontSize: 12 }}>
                            {c.prefixe_rangement}
                          </code>
                        ) : (
                          <span style={{ display: 'inline-block', background: 'rgba(255, 255, 255, 0.04)', color: 'var(--text-muted)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                            Central / Non requis
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'center', padding: '16px' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(99, 102, 241, 0.12)', color: '#818cf8', border: '1px solid rgba(99, 102, 241, 0.22)', padding: '4px 12px', borderRadius: 14, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          <Globe size={12} color="#818cf8" style={{ flexShrink: 0 }} />
                          <span>{c.site_nom || 'SITE PRINCIPAL'}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center', padding: '16px' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(16, 185, 129, 0.12)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.25)', padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>
                          <div className="pulse-dot" style={{ background: '#10b981' }} />
                          OPÉRATIONNEL
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', padding: '16px' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                          <button 
                            className="btn-action" 
                            onClick={() => setEditingCentre(c)} 
                            title="Modifier le Centre"
                            style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255, 255, 255, 0.04)', border: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', cursor: 'pointer', transition: 'all 0.2s' }}
                          >
                            <Edit size={14} />
                          </button>
                          {!(c.numero === 1 || (c.nom && c.nom.toUpperCase().includes('PRINCIPAL'))) ? (
                            <button 
                              className="btn-action" 
                              onClick={() => handleDeleteCentre(c.id)} 
                              title="Supprimer ce centre"
                              style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171', cursor: 'pointer', transition: 'all 0.2s' }}
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : (
                            <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }} title="Centre principal (protégé contre la suppression)">
                              <Lock size={14} color="var(--text-muted)" />
                            </div>
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
      {editingSite && createPortal(
        <div className="modal-overlay-premium" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 110000, backgroundColor: 'rgba(5, 7, 15, 0.85)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-content-premium" style={{ maxWidth: 450, width: '100%', maxHeight: '90vh', background: '#131722', borderRadius: 24, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 32px 64px -12px rgba(0,0,0,0.6)', overflowY: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
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
        </div>,
        document.body
      )}

      {/* MODAL DE CONFIRMATION SÉCURISÉE (LOOK PREMIUM) */}
      {confirmModal && createPortal(
        <div className="modal-overlay-premium" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 110000, backgroundColor: 'rgba(5, 7, 15, 0.85)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className={`modal-content-premium ${confirmModal.type === 'DELETE' ? 'danger' : 'secure'}`} style={{ maxWidth: 450, width: '100%', maxHeight: '90vh', background: '#131722', borderRadius: 24, border: confirmModal.type === 'DELETE' ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.08)', boxShadow: '0 32px 64px -12px rgba(0,0,0,0.6)', overflowY: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
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
                  {confirmModal.type === 'DELETE' ? 'PURGE COMPLÈTE DU SITE' : confirmModal.type === 'BAN' ? 'RÉVOCATION D\'ACCÈS' : confirmModal.type === 'UPDATE' ? 'MODIFICATION DU SITE' : 'RESTAURATION D\'ACCÈS'}
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
        </div>,
        document.body
      )}

      {/* MODAL CRÉATION SITE */}
      {showSiteModal && createPortal(
        <div className="modal-overlay-premium" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 110000, backgroundColor: 'rgba(5, 7, 15, 0.85)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-content-premium" style={{ maxWidth: 500, width: '100%', maxHeight: '90vh', background: '#131722', borderRadius: 24, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 32px 64px -12px rgba(0,0,0,0.6)', overflowY: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
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
        </div>,
        document.body
      )}

      {/* MODAL CRÉATION CENTRE */}
      {showCentreModal && createPortal(
        <div className="modal-overlay-premium" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 110000, backgroundColor: 'rgba(5, 7, 15, 0.85)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-content-premium" style={{ maxWidth: 450, width: '100%', maxHeight: '90vh', background: '#131722', borderRadius: 24, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 32px 64px -12px rgba(0,0,0,0.6)', overflowY: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
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
        </div>,
        document.body
      )}

      {/* MODAL MODIFICATION CENTRE */}
      {editingCentre && createPortal(
        <div className="modal-overlay-premium" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 110000, backgroundColor: 'rgba(5, 7, 15, 0.85)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="modal-content-premium" style={{ maxWidth: 450, width: '100%', maxHeight: '90vh', background: '#131722', borderRadius: 24, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 32px 64px -12px rgba(0,0,0,0.6)', overflowY: 'auto', position: 'relative', display: 'flex', flexDirection: 'column' }}>
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
        </div>,
        document.body
      )}

    </div>
  );
}
