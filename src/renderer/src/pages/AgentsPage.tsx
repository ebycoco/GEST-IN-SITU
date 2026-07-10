import React, { useState, useEffect, useMemo } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useCacheStore } from '../stores/cacheStore';
import { 
  Users, Plus, Edit, Trash2, Shield, Search, 
  UserCheck, UserX, ShieldCheck, RefreshCw,
  MapPin, Mail, Phone, Calendar, Clock,
  User, Lock, Building, Type, Key, Eye, EyeOff
} from 'lucide-react';
import toast from 'react-hot-toast';

interface User { 
  id_user: number; 
  login: string; 
  role: string; 
  roles?: string[];
  nom_user: string; 
  prenom_user: string; 
  statut_actif: number; 
  last_login: string; 
  site_id: number; 
  centre_id: number; 
  centre_nom: string; 
  site_nom: string;
  email?: string;
  telephone?: string;
  created_at?: string;
}

const AVAILABLE_ROLES = [
  { value: 'OPERATEUR_VERIFICATION', label: 'Opérateur de Vérification (Lecture seule)' },
  { value: 'OPERATEUR_SAISIE', label: 'Opérateur de Saisie (Nouvelle Saisie)' },
  { value: 'OPERATEUR_LOGISTIQUE', label: 'Opérateur Logistique (Classement)' },
  { value: 'OPERATEUR_INVENTAIRE', label: 'Opérateur Inventaire (Apurement)' },
  { value: 'OPERATEUR_QUALITE', label: 'Opérateur Qualité & Assainissement' },
  { value: 'ADMINISTRATEUR_SITE', label: 'Administrateur de Site (Totalité)' },
  { value: 'ADMIN_CENTRE', label: 'Administrateur de Centre (Local)' },
];

export default function AgentsPage() {
  const { user: userContext, activeSiteId } = useAuthStore();
  
  const visibleRoles = useMemo(() => {
    if (userContext?.role === 'SUPER ADMIN') {
      return AVAILABLE_ROLES;
    }
    return AVAILABLE_ROLES.filter(r => r.value !== 'SUPER ADMIN' && r.value !== 'ADMINISTRATEUR_SITE');
  }, [userContext?.role]);

  const [users, setUsers] = useState<User[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [centres, setCentres] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetTargetUser, setResetTargetUser] = useState<User | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, users]);

  const handleOpenResetModal = (user: User) => {
    setResetTargetUser(user);
    setShowResetModal(true);
  };

  const handleCloseResetModal = () => {
    setResetTargetUser(null);
    setShowResetModal(false);
  };

  const handleResetPassword = async () => {
    if (!resetTargetUser || !userContext) return;
    setIsResetting(true);
    try {
      await window.api.users.resetAgentPassword(resetTargetUser.id_user, userContext.id_user);
      
      toast.success(
        (t) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Key size={20} color="#fbbf24" style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 800, color: '#ffffff' }}>Mot de passe réinitialisé !</div>
              <div style={{ fontSize: 11, color: '#fbbf24', marginTop: 2 }}>
                Nouvelle valeur temporaire : <span style={{ textDecoration: 'underline', fontWeight: 'bold' }}>cnam@2026</span>
              </div>
            </div>
          </div>
        ),
        {
          duration: 6000,
          style: {
            background: '#12131e',
            color: '#fff',
            border: '2px dashed #fbbf24',
            borderRadius: '16px',
            padding: '12px 18px',
          },
        }
      );
      handleCloseResetModal();
    } catch (err: any) {
      toast.error('Erreur: ' + err.message);
    } finally {
      setIsResetting(false);
    }
  };
  
  const [formData, setFormData] = useState<{
    login: string;
    password?: string;
    role: string;
    roles: string[];
    nom_user: string;
    prenom_user: string;
    centre_id: string;
    email: string;
    telephone: string;
  }>({ 
    login: '', 
    password: '', 
    role: 'OPERATEUR_VERIFICATION', 
    roles: ['OPERATEUR_VERIFICATION'],
    nom_user: '', 
    prenom_user: '',
    centre_id: '',
    email: '',
    telephone: ''
  });

  const toggleRole = (role: string) => {
    const currentRoles = [...formData.roles];
    const index = currentRoles.indexOf(role);
    if (index > -1) {
      if (currentRoles.length > 1) {
        currentRoles.splice(index, 1);
      } else {
        toast.error("Au moins un rôle est requis.");
        return;
      }
    } else {
      currentRoles.push(role);
    }
    setFormData({ ...formData, roles: currentRoles, role: currentRoles[0] });
  };

  useEffect(() => { 
    const cache = useCacheStore.getState().agentsCache;
    let hasCache = false;
    if (cache.cachedAt && cache.list.length > 0) {
      setUsers(cache.list);
      setLoading(false);
      hasCache = true;
    }
    loadData(hasCache);
  }, [userContext?.site_id, activeSiteId]);

  const loadData = async (silent?: boolean) => {
    const isSilent = !!silent;
    if (!isSilent) setLoading(true);
    try { 
      const siteIdToUse = userContext?.role === 'SUPER ADMIN' ? activeSiteId : userContext?.site_id;
      
      const users = await window.api.users.getAll(siteIdToUse || undefined);
      console.log(`[AgentsPage] Loaded ${users.length} users for site_id=${siteIdToUse}`);
      setUsers(users);
      useCacheStore.getState().setAgentsCache(users);
      
      const c = await window.api.hierarchy.getCentres(siteIdToUse || undefined);
      setCentres(c);
    }
    catch (e) { 
      console.error('[AgentsPage] loadData error:', e);
      toast.error("Erreur lors du chargement des données");
    }
    finally { if (!isSilent) setLoading(false); }
  };

  const [isPullingAgents, setIsPullingAgents] = useState(false);

  const handlePullAgents = async () => {
    if (!navigator.onLine) {
      toast.error("⚠️ Connexion Internet requise : Veuillez vous connecter pour récupérer les comptes des agents.");
      return;
    }

    const siteIdToUse = userContext?.role === 'SUPER ADMIN' ? activeSiteId : userContext?.site_id;
    if (!siteIdToUse) {
      toast.error("Veuillez d'abord sélectionner un site actif.");
      return;
    }

    setIsPullingAgents(true);
    const toastId = toast.loading("☁️ Récupération des comptes agents depuis le cloud...");

    try {
      const res = await window.api.sync.pullAgents(Number(siteIdToUse), userContext);
      if (res.success) {
        toast.success(`✅ Rapatriement réussi : ${res.count} profil(s) d'agent(s) récupéré(s) ou mis à jour.`, { id: toastId, duration: 5000 });
        await loadData();
      } else {
        toast.error(`Échec du rapatriement : ${res.message || 'Erreur inconnue'}`, { id: toastId });
      }
    } catch (err: any) {
      toast.error(`Erreur de connexion cloud : ${err.message || err}`, { id: toastId });
    } finally {
      setIsPullingAgents(false);
    }
  };

  const stats = useMemo(() => {
    return {
      total: users.length,
      active: users.filter(u => u.statut_actif === 1).length,
      admins: users.filter(u => ['ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'SUPER ADMIN'].includes(u.role)).length,
      operators: users.filter(u => !['ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'SUPER ADMIN'].includes(u.role)).length
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    return users.filter(u => 
      u.login.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.nom_user?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.prenom_user?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.role.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [users, searchTerm]);

  const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const indexOfFirstItem = (currentPage - 1) * itemsPerPage;
  const indexOfLastItem = Math.min(currentPage * itemsPerPage, filteredUsers.length);
  const paginatedUsers = useMemo(() => {
    return filteredUsers.slice(indexOfFirstItem, currentPage * itemsPerPage);
  }, [filteredUsers, currentPage, itemsPerPage]);

  const handleToggleStatus = async (user: User) => {
    const newStatus = user.statut_actif === 1 ? 0 : 1;
    const actionText = newStatus === 1 ? 'activer' : 'désactiver';
    if (!confirm(`Êtes-vous sûr de vouloir ${actionText} cet utilisateur ?`)) return;
    try {
      await window.api.users.update(user.id_user, { statut_actif: newStatus });
      toast.success(`Utilisateur ${newStatus === 1 ? 'activé' : 'désactivé'}`);
      loadData();
    } catch (err: any) {
      toast.error('Erreur: ' + err.message);
    }
  };

  const handleHardDelete = async (id: number) => {
    if (!confirm('ATTENTION: Êtes-vous sûr de vouloir supprimer DÉFINITIVEMENT cet utilisateur de la base de données ? Cette action est irréversible.')) return;
    try {
      await window.api.users.hardDelete(id);
      toast.success('Utilisateur supprimé définitivement');
      loadData();
    } catch (err: any) {
      toast.error('Erreur: ' + err.message);
    }
  };

  const handleCreateOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.login || !formData.nom_user) {
      toast.error('Veuillez remplir les champs obligatoires');
      return;
    }
    
    try {
      if (isEditing && editId) {
        const updateData: any = { 
          login: formData.login, 
          role: formData.role, 
          roles: formData.roles,
          nom_user: formData.nom_user, 
          prenom_user: formData.prenom_user,
          email: formData.email,
          telephone: formData.telephone,
          centre_id: formData.centre_id ? parseInt(formData.centre_id) : null
        };
        if (formData.password) updateData.password = formData.password;
        await window.api.users.update(editId, updateData);
        toast.success('Agent modifié avec succès');
      } else {
        if (!formData.password) {
          toast.error('Le mot de passe est obligatoire');
          return;
        }
        const siteIdToUse = userContext?.role === 'SUPER ADMIN' ? activeSiteId : userContext?.site_id;
        await window.api.users.create({ 
          ...formData, 
          statut_actif: 1, 
          site_id: siteIdToUse,
          centre_id: formData.centre_id ? parseInt(formData.centre_id) : null
        });
        toast.success('Agent créé avec succès');
      }
      
      closeModal();
      loadData();
    } catch (err: any) {
      toast.error('Erreur: ' + err.message);
    }
  };

  const openEditModal = (user: User) => {
    setIsEditing(true);
    setEditId(user.id_user);
    setFormData({ 
      login: user.login, 
      password: '', 
      role: user.role, 
      roles: user.roles || [user.role],
      nom_user: user.nom_user, 
      prenom_user: user.prenom_user || '',
      centre_id: user.centre_id?.toString() || '',
      email: user.email || '',
      telephone: user.telephone || ''
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setIsEditing(false);
    setEditId(null);
    setFormData({ 
      login: '', 
      password: '', 
      role: 'OPERATEUR_VERIFICATION', 
      roles: ['OPERATEUR_VERIFICATION'],
      nom_user: '', 
      prenom_user: '', 
      centre_id: '',
      email: '', 
      telephone: ''
    });
    setShowPassword(false);
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: '6rem' }}>
      {/* Header & Search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="icon-box" style={{ background: 'var(--premium-glass)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <Users size={24} color="var(--accent-primary)" />
          </div>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0, letterSpacing: '-0.5px' }}>Gestion des Agents</h2>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
              {userContext?.role === 'SUPER ADMIN' ? 'Administration globale du personnel' : `Agents de votre site : ${users[0]?.site_nom || '...'}`}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              className="form-input" 
              placeholder="Rechercher un agent..." 
              style={{ paddingLeft: 40, width: 280, borderRadius: 14, height: 44 }}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" style={{ borderRadius: 14, height: 44, padding: '0 20px', fontWeight: 700 }} onClick={() => { closeModal(); setShowModal(true); }}>
            <Plus size={18} /> Nouvel Agent
          </button>
          <button 
            className="btn btn-outline" 
            style={{ borderRadius: 14, height: 44, padding: '0 20px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }} 
            onClick={handlePullAgents}
            disabled={isPullingAgents || loading}
          >
            <RefreshCw size={16} className={isPullingAgents ? 'animate-spin' : ''} />
            Récupérer depuis le Cloud
          </button>
          <button className="btn btn-outline" style={{ width: 44, height: 44, padding: 0, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => loadData()}>
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats Dashboard */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        {[
          { label: 'Total Agents', value: stats.total, icon: Users, color: 'var(--accent-primary)' },
          { label: 'Agents Actifs', value: stats.active, icon: UserCheck, color: 'var(--accent-green)' },
          { label: 'Administrateurs', value: stats.admins, icon: ShieldCheck, color: 'var(--accent-purple)' },
          { label: 'Opérateurs', value: stats.operators, icon: UserX, color: 'var(--text-muted)' }
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: '20px 24px', background: 'var(--premium-glass)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, fontWeight: 500 }}>{s.label}</p>
                <h3 style={{ margin: '4px 0 0 0', fontSize: 28, fontWeight: 800 }}>{s.value}</h3>
              </div>
              <div style={{ width: 48, height: 48, borderRadius: 16, background: `${s.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <s.icon size={24} color={s.color} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Agents Table */}
      <div className="table-responsive-wrapper" style={{ overflowX: 'auto', overflowY: 'hidden', width: '100%', borderRadius: 24, border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ minWidth: 1000, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
          
          {/* L'En-tête des colonnes (Header) avec son padding de synchronisation */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '16px 24px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ flex: 2, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>AGENT / LOGIN</div>
            <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>RÔLE / ACCÈS</div>
            <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>SITE</div>
            <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>CENTRE</div>
            <div style={{ flex: 1.5, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>CONTACT</div>
            <div style={{ flex: 1.5, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>DERNIÈRE CO.</div>
            <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>STATUT</div>
            <div style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>ACTIONS</div>
          </div>

          {/* La liste ou le corps du tableau (si virtualisé ou classique sous forme de lignes) */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {paginatedUsers.map(u => (
              <div key={u.id_user} className="table-row-hover" style={{ display: 'flex', alignItems: 'center', padding: '16px 24px', background: 'rgba(255,255,255,0.01)', borderBottom: '1px solid rgba(255,255,255,0.02)', transition: 'all 0.2s' }}>
                
                {/* AGENT */}
                <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ 
                    width: 40, height: 40, borderRadius: 12, 
                    background: u.role === 'SUPER ADMIN' ? 'var(--gradient-primary)' : 'rgba(255,255,255,0.05)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700, color: 'white'
                  }}>
                    {u.nom_user?.charAt(0)}{u.prenom_user?.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'white' }}>{u.nom_user} {u.prenom_user}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>@{u.login}</div>
                  </div>
                </div>

                {/* RÔLE / ACCÈS */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                  {(u.roles || [u.role]).map(r => (
                    <span key={r} className={`badge ${r === 'SUPER ADMIN' ? 'badge-primary' : 'badge-outline'}`} style={{ fontSize: 9, fontWeight: 800 }}>
                      {r}
                    </span>
                  ))}
                </div>

                {/* SITE */}
                <div style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>
                  {u.site_nom || 'Non spécifié'}
                </div>

                {/* CENTRE */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: 'white' }}>
                    <MapPin size={12} color="var(--accent-primary)" /> {u.centre_nom || 'Libre'}
                  </div>
                </div>

                {/* CONTACT */}
                <div style={{ flex: 1.5 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {u.email && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}><Mail size={10} /> {u.email}</div>}
                    {u.telephone && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}><Phone size={10} /> {u.telephone}</div>}
                    {!u.email && !u.telephone && <span style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--text-muted)' }}>Non renseigné</span>}
                  </div>
                </div>

                {/* DERNIÈRE CO. */}
                <div style={{ flex: 1.5 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                    <Clock size={12} /> {u.last_login ? new Date(u.last_login).toLocaleString() : 'Jamais'}
                  </div>
                </div>

                {/* STATUT */}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ 
                      width: 8, height: 8, borderRadius: '50%', 
                      background: u.statut_actif === 1 ? 'var(--accent-green)' : 'var(--text-muted)',
                      boxShadow: u.statut_actif === 1 ? '0 0 10px var(--accent-green)' : 'none'
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: u.statut_actif === 1 ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                      {u.statut_actif === 1 ? 'Actif' : 'Désactivé'}
                    </span>
                  </div>
                </div>

                {/* ACTIONS */}
                <div style={{ flex: 1, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button className="btn btn-icon btn-outline btn-sm" onClick={() => openEditModal(u)} title="Modifier">
                    <Edit size={14} />
                  </button>
                  {u.role !== 'SUPER ADMIN' && u.id_user !== userContext?.id_user && (
                    <>
                      <button className="btn btn-icon btn-outline btn-sm" onClick={() => handleOpenResetModal(u)} title="Réinitialiser le mot de passe" style={{ borderColor: 'rgba(251, 191, 36, 0.3)' }}>
                        <Key size={14} color="#fbbf24" />
                      </button>
                      <button className="btn btn-icon btn-outline btn-sm" onClick={() => handleToggleStatus(u)} title={u.statut_actif === 1 ? "Désactiver" : "Activer"}>
                        {u.statut_actif === 1 ? <UserX size={14} color="var(--text-muted)" /> : <UserCheck size={14} color="var(--accent-green)" />}
                      </button>
                      <button className="btn btn-icon btn-outline btn-sm" onClick={() => handleHardDelete(u.id_user)} title="Supprimer définitivement">
                        <Trash2 size={14} color="var(--accent-red)" />
                      </button>
                    </>
                  )}
                </div>

              </div>
            ))}

            {filteredUsers.length === 0 && !loading && (
              <div style={{ padding: '80px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <Users size={48} style={{ opacity: 0.2 }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'white' }}>Aucun agent trouvé</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Essayez de modifier vos filtres ou de créer un nouvel agent</div>
                </div>
                <button className="btn btn-primary" onClick={() => setShowModal(true)}>Créer le premier agent</button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          padding: '16px 24px', 
          background: 'var(--bg-secondary)', 
          borderRadius: 16,
          border: '1px solid rgba(255, 255, 255, 0.05)',
          marginTop: 16 
        }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Affichage de <span style={{ color: 'white', fontWeight: 600 }}>{filteredUsers.length > 0 ? indexOfFirstItem + 1 : 0}</span> à <span style={{ color: 'white', fontWeight: 600 }}>{indexOfLastItem}</span> sur <span style={{ color: 'white', fontWeight: 600 }}>{filteredUsers.length}</span> agents
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button 
              type="button"
              className="btn btn-outline btn-sm" 
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              style={{ 
                borderRadius: 10, 
                height: 36, 
                padding: '0 16px', 
                opacity: currentPage === 1 ? 0.4 : 1,
                cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                background: 'transparent',
                color: 'white'
              }}
            >
              Précédent
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Page <span style={{ color: '#fbbf24', fontWeight: 700 }}>{currentPage}</span> sur <span style={{ color: 'white', fontWeight: 600 }}>{totalPages}</span>
            </span>
            <button 
              type="button"
              className="btn btn-outline btn-sm" 
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              style={{ 
                borderRadius: 10, 
                height: 36, 
                padding: '0 16px', 
                opacity: currentPage === totalPages ? 0.4 : 1,
                cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                background: 'transparent',
                color: 'white'
              }}
            >
              Suivant
            </button>
          </div>
        </div>
      )}

      {/* Modal - Modern Premium Style */}
      {showModal && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(2, 4, 12, 0.85)', 
          backdropFilter: 'blur(24px)', 
          display: 'flex', alignItems: 'center', justifyContent: 'center', 
          zIndex: 1000,
          animation: 'fadeIn 0.3s ease'
        }}>
          <div 
            style={{ 
              background: 'linear-gradient(145deg, rgba(45, 50, 85, 0.95) 0%, rgba(20, 22, 40, 0.98) 100%)', 
              width: 'min(90vw, 580px)', 
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '32px 48px', 
              borderRadius: 32,
              border: '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 40px 80px rgba(0, 0, 0, 0.9), 0 0 40px rgba(99, 102, 241, 0.15), inset 0 1px 1px rgba(255, 255, 255, 0.2)',
              animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              position: 'relative'
            }}
          >
            <div style={{ position: 'absolute', top: 32, left: 0, width: 6, height: 32, background: 'var(--gradient-primary)', borderRadius: '0 4px 4px 0' }} />
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <div style={{ width: 48, height: 48, borderRadius: 16, background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Users size={24} color="var(--accent-primary)" />
              </div>
              <h3 style={{ margin: 0, fontSize: 26, color: 'white', fontWeight: 800, letterSpacing: '-0.5px' }}>
                {isEditing ? 'Modifier l\'agent' : 'Nouvel Agent'}
              </h3>
            </div>
            
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
              Définissez les informations de connexion et les niveaux d'accès pour ce compte.
            </p>

            <form onSubmit={handleCreateOrUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              <div style={{ display: 'flex', gap: 20 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Identifiant (Login)<span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span></label>
                  <div style={{ position: 'relative' }}>
                    <User size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-primary)' }} />
                    <input className="form-input" style={{ width: '100%', paddingLeft: 44, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', height: 48, transition: 'all 0.2s', color: 'white', outline: 'none' }} type="text" placeholder="ex: agent_abobo" value={formData.login} onChange={e => setFormData({ ...formData, login: e.target.value })} required />
                  </div>
                </div>
                {!isEditing && (
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Mot de passe<span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span></label>
                    <div style={{ position: 'relative' }}>
                      <Lock size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-primary)' }} />
                      <input 
                        className="form-input" 
                        style={{ width: '100%', paddingLeft: 44, paddingRight: 44, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', height: 48, transition: 'all 0.2s', color: 'white', outline: 'none' }} 
                        type={showPassword ? "text" : "password"} 
                        placeholder="••••••••" 
                        value={formData.password} 
                        onChange={e => setFormData({ ...formData, password: e.target.value })} 
                        required={!isEditing} 
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                          position: 'absolute',
                          right: 16,
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0
                        }}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 20 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Nom<span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span></label>
                  <div style={{ position: 'relative' }}>
                    <Type size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input className="form-input" style={{ width: '100%', paddingLeft: 44, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', height: 48, transition: 'all 0.2s', color: 'white', outline: 'none' }} type="text" placeholder="NOM DE FAMILLE" value={formData.nom_user} onChange={e => setFormData({ ...formData, nom_user: e.target.value.toUpperCase() })} required />
                  </div>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Prénom</label>
                  <div style={{ position: 'relative' }}>
                    <Type size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input className="form-input" style={{ width: '100%', paddingLeft: 44, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', height: 48, transition: 'all 0.2s', color: 'white', outline: 'none' }} type="text" placeholder="Prénoms" value={formData.prenom_user} onChange={e => setFormData({ ...formData, prenom_user: e.target.value.toUpperCase() })} />
                  </div>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Permissions & Rôles multiples (Cochez tout ce qui s'applique)<span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span></label>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', 
                  gap: 12,
                  background: 'rgba(255, 255, 255, 0.02)',
                  padding: 16,
                  borderRadius: 16,
                  border: '1px solid rgba(255, 255, 255, 0.05)'
                }}>
                  {visibleRoles.map(r => (
                    <label key={r.value} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', color: 'white', fontSize: 13, padding: '4px 0' }}>
                      <input
                        type="checkbox"
                        checked={formData.roles.includes(r.value)}
                        onChange={() => toggleRole(r.value)}
                        style={{
                          accentColor: '#fbbf24',
                          width: 16,
                          height: 16,
                          cursor: 'pointer'
                        }}
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Affectation Centre<span style={{ color: '#ef4444', marginLeft: '4px' }}>*</span></label>
                <div style={{ position: 'relative' }}>
                  <Building size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-primary)', zIndex: 1 }} />
                  <select className="form-select" style={{ width: '100%', paddingLeft: 44, borderRadius: 16, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', height: 48, transition: 'all 0.2s', color: 'white', appearance: 'none', position: 'relative', outline: 'none' }} value={formData.centre_id} onChange={e => setFormData({ ...formData, centre_id: e.target.value })} required>
                    <option value="">-- Choisir un centre d'affectation --</option>
                    {centres.map(c => <option key={c.id} value={c.id}>{c.nom} ({c.site_nom})</option>)}
                  </select>
                  <div style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }}>▼</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16, marginTop: 16 }}>
                <button type="button" className="btn btn-outline" onClick={closeModal} style={{ borderRadius: 16, padding: '0 28px', height: 52, fontWeight: 600, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent' }}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" style={{ borderRadius: 16, padding: '0 36px', height: 52, fontWeight: 800, background: 'var(--gradient-primary)', boxShadow: '0 8px 16px rgba(99, 102, 241, 0.3)', transition: 'all 0.3s', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isEditing ? <Edit size={18} /> : <Plus size={18} />}
                  {isEditing ? 'Mettre à jour' : 'Créer l\'agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Réinitialisation Mot de passe */}
      {showResetModal && resetTargetUser && (
        <div style={{ 
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
          backgroundColor: 'rgba(2, 4, 12, 0.85)', 
          backdropFilter: 'blur(24px)', 
          display: 'flex', alignItems: 'center', justifyContent: 'center', 
          zIndex: 1010,
          animation: 'fadeIn 0.3s ease'
        }}>
          <div 
            style={{ 
              background: 'linear-gradient(145deg, rgba(45, 50, 85, 0.95) 0%, rgba(20, 22, 40, 0.98) 100%)', 
              width: 'min(90vw, 480px)', 
              padding: '32px 40px', 
              borderRadius: 24,
              border: '1px solid rgba(251, 191, 36, 0.25)',
              boxShadow: '0 40px 80px rgba(0, 0, 0, 0.9), 0 0 40px rgba(251, 191, 36, 0.05)',
              position: 'relative'
            }}
          >
            <div style={{ position: 'absolute', top: 32, left: 0, width: 6, height: 32, background: '#fbbf24', borderRadius: '0 4px 4px 0' }} />
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 16, background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Key size={24} color="#fbbf24" />
              </div>
              <h3 style={{ margin: 0, fontSize: 22, color: 'white', fontWeight: 800 }}>
                Réinitialisation
              </h3>
            </div>
            
            <p style={{ color: 'white', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Voulez-vous réinitialiser le mot de passe de cet agent (<strong style={{ color: '#fbbf24' }}>@{resetTargetUser.login}</strong>) ? 
              Un mot de passe temporaire <strong style={{ color: '#fbbf24' }}>'cnam@2026'</strong> lui sera attribué.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
              <button type="button" className="btn btn-outline" onClick={handleCloseResetModal} disabled={isResetting} style={{ borderRadius: 12, padding: '0 20px', height: 44, fontWeight: 600, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent' }}>
                Annuler
              </button>
              <button type="button" className="btn btn-primary" onClick={handleResetPassword} disabled={isResetting} style={{ borderRadius: 12, padding: '0 24px', height: 44, fontWeight: 800, background: '#fbbf24', color: '#000', border: 'none', transition: 'all 0.3s', display: 'flex', alignItems: 'center', gap: 8 }}>
                {isResetting ? 'Réinitialisation...' : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
