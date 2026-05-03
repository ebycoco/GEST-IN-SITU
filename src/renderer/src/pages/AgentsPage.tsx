import { useState, useEffect } from 'react';
import { Users, Plus, Edit, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface User { id_user: number; login: string; role: string; nom_user: string; prenom_user: string; statut_actif: number; last_login: string; }

export default function AgentsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Users size={20} color="var(--accent-primary)" />
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Gestion des Agents</h2>
        </div>
        <button className="btn btn-primary"><Plus size={14} /> Nouvel Agent</button>
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
                      <button className="btn btn-icon btn-outline btn-sm"><Edit size={12} /></button>
                      <button className="btn btn-icon btn-outline btn-sm" onClick={() => handleDelete(u.id_user)}><Trash2 size={12} color="var(--accent-red)" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
