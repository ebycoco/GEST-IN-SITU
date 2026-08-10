import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';

export default function RoleRedirect() {
  const user = useAuthStore((s) => s.user);

  // ── Guard 1 : Protection contre null/undefined ──────────────────────────
  // Si l'utilisateur n'est pas chargé, redirection immédiate vers /login.
  // Ne jamais tenter de lire .role sur un objet null.
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // ── Routing par rôle ────────────────────────────────────────────────────
  switch (user.role) {
    case 'OPERATEUR_VERIFICATION':
      return <Navigate to="/agent-verification" replace />;
    case 'OPERATEUR_SAISIE':
      return <Navigate to="/agent-saisie" replace />;
    case 'OPERATEUR_LOGISTIQUE':
    case 'OPERATEUR_INVENTAIRE':
      return <Navigate to="/inventaire" replace />;
    case 'OPERATEUR_APUREMENT':
      return <Navigate to="/apurement" replace />;
    case 'OPERATEUR_QUALITE':
      return <Navigate to="/agent-qualite" replace />;
    case 'ADMINISTRATEUR_SITE':
    case 'SUPER ADMIN':
      return <Navigate to="/dashboard" replace />;
    case 'ADMIN_CENTRE':
      return <Navigate to="/admin-centre" replace />;

    // ── Guard 2 : Fallback — Rôle inconnu ───────────────────────────────
    default:
      return <RoleUnknownFallback role={user.role} />;
  }
}

/**
 * Composant de secours affiché lorsqu'un rôle n'est pas répertorié.
 * Déclenche le toast.error et le console.error via useEffect (hooks
 * interdits directement dans le corps du switch).
 */
function RoleUnknownFallback({ role }: { role: string }) {
  useEffect(() => {
    // ── Logging d'erreur ────────────────────────────────────────────────
    console.error('[ROLE_REDIRECT] Erreur : Rôle inconnu détecté -', role);

    // ── Notification d'échec ────────────────────────────────────────────
    toast.error('Accès non autorisé : rôle invalide.', {
      duration: 6000,
      id: 'role-redirect-error', // évite les toasts en doublon
    });
  }, [role]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      padding: 40,
      textAlign: 'center',
      background: 'var(--bg-primary, #0a0f1c)',
      gap: 16,
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: 'rgba(239, 68, 68, 0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 32,
        marginBottom: 8,
      }}>
        🚫
      </div>
      <h2 style={{ color: '#ef4444', margin: 0, fontSize: 22, fontWeight: 800 }}>
        Accès non autorisé
      </h2>
      <p style={{ color: 'var(--text-muted, #9ca3af)', fontSize: 14, maxWidth: 380, lineHeight: 1.6, margin: 0 }}>
        Le rôle <strong style={{ color: 'white' }}>{role}</strong> n'est pas reconnu par le système.
        <br />Contactez votre administrateur pour régulariser votre accès.
      </p>
      <button
        onClick={() => useAuthStore.getState().logout()}
        style={{
          marginTop: 8,
          padding: '10px 24px',
          cursor: 'pointer',
          borderRadius: 10,
          border: '1px solid rgba(239, 68, 68, 0.4)',
          background: 'rgba(239, 68, 68, 0.1)',
          color: '#fca5a5',
          fontWeight: 700,
          fontSize: 14,
          transition: 'all 0.2s ease',
        }}
        onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; }}
        onMouseOut={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
      >
        Se déconnecter
      </button>
    </div>
  );
}
