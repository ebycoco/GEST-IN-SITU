import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export default function RoleRedirect() {
  const user = useAuthStore((s) => s.user);

  if (!user) return <Navigate to="/login" replace />;

  switch (user.role) {
    case 'OPERATEUR_VERIFICATION':
      return <Navigate to="/verification/recherche" replace />;
    case 'OPERATEUR_SAISIE':
      return <Navigate to="/saisie" replace />;
    case 'OPERATEUR_LOGISTIQUE':
      return <Navigate to="/logistique" replace />;
    case 'OPERATEUR_INVENTAIRE':
      return <Navigate to="/inventaire" replace />;
    case 'OPERATEUR_QUALITE':
      return <Navigate to="/qualite" replace />;
    case 'ADMINISTRATEUR_SITE':
    case 'SUPER ADMIN':
      return <Navigate to="/dashboard" replace />;
    case 'ADMIN_CENTRE':
      return <Navigate to="/centre/dashboard" replace />;
    default:
      return <Navigate to="/dashboard" replace />;
  }
}
