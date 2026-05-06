import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { Users, Plus, Edit, Trash2, Shield } from 'lucide-react';
import toast from 'react-hot-toast';

interface User { id_user: number; login: string; role: string; nom_user: string; prenom_user: string; statut_actif: number; last_login: string; site_id: number; centre_id: number; centre_nom: string; site_nom: string; }

export default function AgentsPage() {
  const { user: userContext, activeSiteId } = useAuthStore();
  const [users, setUsers] = useState<User[]>([]);
  const [centres, setCentres] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  
  const [formData, setFormData] = useState({ 
    login: '', 
    password: '', 
    role: 'CONSULTANT', 
    nom_user: '', 
    prenom_user: '',
    centre_id: ''
  });

  useEffect(() => { 
    loadData();
  }, [userContext?.site_id, activeSiteId]);

  const loadData = async () => {
    setLoading(true);
    try { 
      const allUsers = await window.api.users.getAll();
      const siteIdToUse = userContext?.role === 'SUPER ADMIN' ? activeSiteId : userContext?.site_id;
      
      if (siteIdToUse) {
        setUsers(allUsers.filter((u: any) => u.site_id === siteIdToUse));
      } else {
        setUsers(allUsers);
      }
      
      const c = await window.api.hierarchy.getCentres(siteIdToUse);
      setCentres(c);
    }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Désactiver cet utilisateur ?')) return;
    await window.api.users.delete(id);
    toast.success('Utilisateur désactivé');
    loadData();
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
          nom_user: formData.nom_user, 
          prenom_user: formData.prenom_user,
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
      nom_user: user.nom_user, 
      prenom_user: user.prenom_user,
      centre_id: user.centre_id?.toString() || ''
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setIsEditing(false);
    setEditId(null);
    setFormData({ login: '', password: '', role: 'CONSULTANT', nom_user: '', prenom_user: '', centre_id: '' });
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Users size={20} color="var(--accent-primary)" />
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Gestion des Agents</h2>
          {userContext?.role === 'SUPER ADMIN' && <span className="badge badge-primary">Mode Global</span>}
        </div>

        <button className="btn btn-primary" onClick={() => { closeModal(); setShowModal(true); }}>
          <Plus size={14} /> Nouvel Agent
        </button>
      </div>

      <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="card-body" style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr><th>Identifiant</th><th>Nom & Prénom</th><th>Rôle</th><th>Affectation</th><th>Dernière co.</th><th>Statut</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id_user}>
                  <td style={{ fontWeight: 600 }}>{u.login}</td>
                  <td>{u.nom_user} {u.prenom_user}</td>
                  <td><span className={`badge ${u.role === 'SUPER ADMIN' ? 'badge-primary' : 'badge-outline'}`}>{u.role}</span></td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 13 }}>{u.centre_nom || 'Non assigné'}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.site_nom}</span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{u.last_login ? new Date(u.last_login).toLocaleString() : 'Jamais'}</td>
                  <td>
                    {u.statut_actif === 1 ? <span style={{ color: 'var(--accent-green)', display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} /> Actif</span> : <span style={{ color: 'var(--text-muted)' }}>Inactif</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-icon btn-outline btn-sm" onClick={() => openEditModal(u)}><Edit size={12} /></button>
                      {u.role !== 'SUPER ADMIN' && (
                        <button className="btn btn-icon btn-outline btn-sm" onClick={() => handleDelete(u.id_user)}><Trash2 size={12} color="var(--accent-red)" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && !loading && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Aucun agent trouvé</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 450, padding: 32, border: '1px solid var(--border-color)' }}>
            <h3 style={{ marginTop: 0, marginBottom: 24, fontSize: 20 }}>{isEditing ? 'Modifier Agent' : 'Nouvel Agent'}</h3>
            <form onSubmit={handleCreateOrUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Identifiant (Login)*</label>
                <input className="input" type="text" value={formData.login} onChange={e => setFormData({ ...formData, login: e.target.value })} required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{isEditing ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe*'}</label>
                <input className="input" type="text" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} required={!isEditing} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Nom*</label>
                  <input className="input" type="text" value={formData.nom_user} onChange={e => setFormData({ ...formData, nom_user: e.target.value })} required />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Prénom</label>
                  <input className="input" type="text" value={formData.prenom_user} onChange={e => setFormData({ ...formData, prenom_user: e.target.value })} />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Rôle</label>
                <select className="input" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })}>
                  <option value="CONSULTANT">Consultant</option>
                  <option value="AJOUTANT">Ajoutant</option>
                  <option value="EDITEUR">Éditeur</option>
                  <option value="ADMINISTRATEUR">Administrateur de Site</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Affectation Centre*</label>
                <select className="input" value={formData.centre_id} onChange={e => setFormData({ ...formData, centre_id: e.target.value })} required>
                  <option value="">-- Choisir un centre --</option>
                  {centres.map(c => <option key={c.id} value={c.id}>{c.nom} ({c.site_nom})</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
                <button type="button" className="btn btn-outline" onClick={closeModal}>Annuler</button>
                <button type="submit" className="btn btn-primary">{isEditing ? 'Mettre à jour' : 'Créer l\'agent'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
