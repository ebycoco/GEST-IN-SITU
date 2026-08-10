import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, ChevronRight, LogOut } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';

const ROLE_META: Record<string, { label: string; description: string; color: string; icon: string }> = {
  'SUPER ADMIN':            { label: 'Super Administrateur',         description: 'Accès total au système',                       color: '#a78bfa', icon: '👑' },
  'ADMINISTRATEUR_SITE':    { label: 'Administrateur de Site',       description: 'Gestion globale du site',                      color: '#60a5fa', icon: '🏛️' },
  'ADMIN_CENTRE':           { label: 'Administrateur de Centre',     description: 'Gestion locale du centre',                     color: '#34d399', icon: '🏢' },
  'OPERATEUR_VERIFICATION': { label: 'Opérateur de Vérification',    description: 'Recherche, délivrance et signalements',        color: '#fbbf24', icon: '🔍' },
  'OPERATEUR_SAISIE':       { label: 'Opérateur de Saisie',          description: 'Enregistrement de nouvelles cartes',           color: '#f87171', icon: '✏️' },
  'OPERATEUR_LOGISTIQUE':   { label: 'Opérateur Logistique',         description: 'Scan, classement et apurement',                color: '#fb923c', icon: '📦' },
  'OPERATEUR_INVENTAIRE':   { label: 'Opérateur Inventaire',         description: 'Inventaire physique et suivi des stocks',      color: '#38bdf8', icon: '📋' },
  'OPERATEUR_QUALITE':      { label: 'Opérateur Qualité',            description: 'Correction, fusion et contrôle qualité',       color: '#4ade80', icon: '✅' },
  'OPERATEUR_APUREMENT':    { label: 'Opérateur Apurement',          description: 'Émargement rétroactif des cahiers historiques', color: '#ec4899', icon: '📜' },
};

export default function RoleSelectorPage() {
  const navigate = useNavigate();
  const { user, setActiveRole } = useAuthStore();

  // ── Guard : si l'utilisateur n'a qu'un seul rôle, RoleRedirect gère ────
  useEffect(() => {
    if (!user) {
      navigate('/login', { replace: true });
      return;
    }
    const roles = user.roles ?? [user.role];
    if (roles.length <= 1) {
      // Mono-rôle — déléguer à RoleRedirect via '/'
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  if (!user) return null;

  const roles = user.roles ?? [user.role];

  const handleSelect = async (role: string) => {
    try {
      await setActiveRole(role);
      // Log de sélection de rôle
      console.info(`[ROLE_SELECTOR] Rôle sélectionné : ${role} par ${user.login}`);
      toast.success(`Connecté en tant que : ${ROLE_META[role]?.label ?? role}`, { duration: 3000 });
      // Naviguer vers '/' → RoleRedirect prend le relais
      navigate('/', { replace: true });
    } catch (e: any) {
      toast.error(e.message || 'Impossible de sélectionner ce rôle.');
    }
  };

  return (
    <div style={{
      height: '100vh',
      width: '100vw',
      overflowY: 'auto',
      background: 'var(--bg-primary, #0a0f1c)',
      padding: '32px 20px',
      boxSizing: 'border-box',
    }}>
      <div style={{
        minHeight: 'calc(100vh - 64px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto',
        width: '100%',
        maxWidth: 520,
        animation: 'slideUp 0.3s ease',
      }}>
        {/* En-tête */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 60, height: 60, borderRadius: 16, margin: '0 auto 12px',
            background: 'var(--gradient-button, linear-gradient(135deg, #6c63ff, #a855f7))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(108, 99, 255, 0.35)',
          }}>
            <Shield size={32} color="white" />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 900, color: 'white', margin: '0 0 6px 0' }}>
            Sélection du Rôle
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted, #9ca3af)', margin: 0, lineHeight: 1.5 }}>
            Bonjour <strong style={{ color: 'white' }}>{user.prenom_user ?? user.login}</strong>,
            votre compte possède <strong style={{ color: 'white' }}>{roles.length} rôles</strong>.
            Choisissez celui à utiliser pour cette session.
          </p>
        </div>

        {/* Liste des rôles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginBottom: 20 }}>
          {roles.map((role) => {
            const meta = ROLE_META[role] ?? { label: role, description: 'Rôle personnalisé', color: '#9ca3af', icon: '🔑' };
            return (
              <button
                key={role}
                onClick={() => handleSelect(role)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 18px',
                  borderRadius: 14,
                  border: `1px solid rgba(255,255,255,0.08)`,
                  background: 'rgba(255,255,255,0.03)',
                  color: 'white',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'all 0.2s ease',
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = `${meta.color}18`;
                  e.currentTarget.style.borderColor = `${meta.color}55`;
                  e.currentTarget.style.transform = 'translateX(4px)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                  e.currentTarget.style.transform = 'translateX(0)';
                }}
              >
                {/* Icône */}
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: `${meta.color}20`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20,
                  border: `1px solid ${meta.color}30`,
                }}>
                  {meta.icon}
                </div>

                {/* Texte */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: meta.color }}>
                    {meta.label}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)', marginTop: 2 }}>
                    {meta.description}
                  </div>
                </div>

                {/* Chevron */}
                <ChevronRight size={18} style={{ color: meta.color, flexShrink: 0, opacity: 0.7 }} />
              </button>
            );
          })}
        </div>

        {/* Déconnexion */}
        <div style={{ textAlign: 'center', paddingBottom: 16 }}>
          <button
            onClick={() => {
              useAuthStore.getState().logout();
              navigate('/login', { replace: true });
            }}
            style={{
              background: 'none',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10,
              color: 'var(--text-muted, #9ca3af)',
              fontSize: 13,
              cursor: 'pointer',
              padding: '10px 20px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)'; e.currentTarget.style.color = '#fca5a5'; }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'var(--text-muted, #9ca3af)'; }}
          >
            <LogOut size={14} /> Se déconnecter
          </button>
        </div>
      </div>
    </div>
  );
}
