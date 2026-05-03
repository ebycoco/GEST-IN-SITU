import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export default function RoleRedirect() {
  const user = useAuthStore((s) => s.user);

  if (!user) return <Navigate to="/login" replace />;

  switch (user.role) {
    case 'CONSULTANT':
      return <Navigate to="/consultant/recherche" replace />;
    case 'AJOUTANT':
      return <Navigate to="/ajoutant/saisie" replace />;
    case 'EDITEUR':
      return <Navigate to="/editeur/mission1" replace />;
    case 'ADMINISTRATEUR':
    case 'SUPER ADMIN':
    default:
      return <Navigate to="/dashboard" replace />;
  }
}
