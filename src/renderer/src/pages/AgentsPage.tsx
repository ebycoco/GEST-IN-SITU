import { useState, useEffect } from 'react';
import { Users, Plus, Edit, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface User { id_user: number; login: string; role: string; nom_user: string; prenom_user: string; statut_actif: number; last_login: string; }

export default function AgentsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ login: '', password: '', role: 'CONSULTANT', nom_user: '', prenom_user: '' });

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    try { setUsers(await window.api.users.getAll()); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Désactiver cet utilisateur ?')) return;
    await window.api.users.delete(id);
    toast.success('Utilisateur désactivé');
    loadUsers();
  };

  const handleCreateOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.login || !formData.nom_user) {
      toast.error('Veuillez remplir les champs obligatoires');
      return;
    }
    if (!isEditing && !formData.password) {
      toast.error('Le mot de passe est obligatoire pour un nouvel agent');
      return;
    }
    
    try {
      if (isEditing && editId) {
        const updateData: any = { login: formData.login, role: formData.role, nom_user: formData.nom_user, prenom_user: formData.prenom_user };
        if (formData.password) updateData.password = formData.password; // only update if provided
        await window.api.users.update(editId, updateData);
        toast.success('Agent modifié avec succès');
      } else {
        await window.api.users.create({ ...formData, statut_actif: 1 });
        toast.success('Agent créé avec succès');
      }
      
      closeModal();
      loadUsers();
    } catch (err: any) {
      toast.error('Erreur: ' + err.message);
    }
  };

  const openEditModal = (user: User) => {
    setIsEditing(true);
    setEditId(user.id_user);
    setFormData({ login: user.login, password: '', role: user.role, nom_user: user.nom_user, prenom_user: user.prenom_user });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setIsEditing(false);
    setEditId(null);
    setFormData({ login: '', password: '', role: 'CONSULTANT', nom_user: '', prenom_user: '' });
  };

  const copyPassword = () => {
    if (formData.password) {
      navigator.clipboard.writeText(formData.password);
      toast.success('Mot de passe copié !');
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Users size={20} color="var(--accent-primary)" />
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Gestion des Agents</h2>
        </div>
        <button className="btn btn-primary" onClick={() => { closeModal(); setShowModal(true); }}>
          <Plus size={14} /> Nouvel Agent
        </button>
      </div>

      <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="card-body" style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
          <table className="data-table">
            <thead>
              <tr><th>Identifiant</th><th>Nom</th><th>Prénom</th><th>Rôle</th><th>Dernière co.</th><th>Statut</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id_user}>
                  <td style={{ fontWeight: 600 }}>{u.login}</td>
                  <td>{u.nom_user}</td>
                  <td>{u.prenom_user}</td>
                  <td>{u.role}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{u.last_login ? new Date(u.last_login).toLocaleString() : 'Jamais'}</td>
                  <td>
                    {u.statut_actif === 1 ? <span style={{ color: 'var(--accent-green)' }}>Actif</span> : <span style={{ color: 'var(--text-muted)' }}>Inactif</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-icon btn-outline btn-sm" onClick={() => openEditModal(u)}><Edit size={12} /></button>
                      <button className="btn btn-icon btn-outline btn-sm" onClick={() => handleDelete(u.id_user)}><Trash2 size={12} color="var(--accent-red)" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ width: 400, padding: 24 }}>
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>{isEditing ? 'Modifier Agent' : 'Nouvel Agent'}</h3>
            <form onSubmit={handleCreateOrUpdate} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Identifiant (Login)*</label>
                <input className="input" type="text" value={formData.login} onChange={e => setFormData({ ...formData, login: e.target.value })} required />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>{isEditing ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe*'}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" style={{ flex: 1 }} type="text" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} required={!isEditing} />
                  <button type="button" className="btn btn-outline" onClick={copyPassword} title="Copier le mot de passe">Copier</button>
                </div>
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
                  <option value="ADMINISTRATEUR">Administrateur</option>
                  <option value="SUPER ADMIN">Super Admin</option>
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
