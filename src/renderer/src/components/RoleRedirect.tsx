import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export default function RoleRedirect() {
  const user = useAuthStore((s) => s.user);

  if (!user) return <Navigate to="/login" replace />;

  switch (user.role) {
    case 'OPERATEUR_VERIFICATION':
      return <Navigate to="/agent-verification" replace />;
    case 'OPERATEUR_SAISIE':
      return <Navigate to="/agent-saisie" replace />;
    case 'OPERATEUR_LOGISTIQUE':
      return <Navigate to="/inventaire" replace />;
    case 'OPERATEUR_INVENTAIRE':
      return <Navigate to="/inventaire" replace />;
    case 'OPERATEUR_QUALITE':
      return <Navigate to="/agent-qualite" replace />;
    case 'ADMINISTRATEUR_SITE':
    case 'SUPER ADMIN':
      return <Navigate to="/dashboard" replace />;
    case 'ADMIN_CENTRE':
      return <Navigate to="/admin-centre" replace />;
    default:
      return (
        <div style={{ padding: 40, color: 'white', textAlign: 'center' }}>
          <h2>Erreur de redirection</h2>
          <p>Le rôle <strong>{user.role}</strong> n'est pas reconnu par le système.</p>
          <button onClick={() => useAuthStore.getState().logout()} style={{ marginTop: 20, padding: '10px 20px', cursor: 'pointer' }}>Se déconnecter</button>
        </div>
      );
  }
}
