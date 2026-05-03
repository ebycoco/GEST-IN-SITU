import { UserCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

export default function ProfilePage() {
  const user = useAuthStore(s => s.user);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <UserCircle size={20} color="var(--accent-primary)" />
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Mon Profil</h2>
      </div>

      <div className="card" style={{ maxWidth: 500 }}>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ width: 80, height: 80, borderRadius: 20, background: 'var(--gradient-button)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 700, color: 'white' }}>
              {(user?.nom_user || user?.login || 'U').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 style={{ fontSize: 20, margin: '0 0 4px 0' }}>{user?.nom_user} {user?.prenom_user}</h3>
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>@{user?.login}</p>
              <span className="status-badge distribue" style={{ marginTop: 8, display: 'inline-block' }}>{user?.role}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
