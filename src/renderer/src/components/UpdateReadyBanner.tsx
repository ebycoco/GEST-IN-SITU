import React from 'react';
import { DownloadCloud, Sparkles, X } from 'lucide-react';

interface UpdateReadyBannerProps {
  visible: boolean;
  onAcknowledge: () => void;
}

/**
 * Bandeau persistant "Mise à jour prête".
 *
 * Remplace l'ancien toast auto-disparaissant (10s) : une mise à jour
 * installée silencieusement à la fermeture de l'app est un événement
 * important pour un agent terrain peu technique — il doit rester visible
 * jusqu'à acquittement explicite, sans jamais bloquer la saisie en cours.
 *
 * Persistance de l'acquittement : mémorisée en mémoire (state React),
 * PAS en localStorage. Choix volontaire — voir justification dans le
 * rapport de l'agent-2-designer : un flag localStorage non versionné
 * risquerait de masquer silencieusement la notification d'une future
 * mise à jour (différente) si jamais réutilisé par erreur. Le state
 * React se réinitialise à chaque redémarrage de l'app, ce qui est sans
 * incidence puisque l'installation silencieuse a justement lieu à la
 * fermeture précédente.
 */
export default function UpdateReadyBanner({ visible, onAcknowledge }: UpdateReadyBannerProps) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 28,
        transform: 'translateX(-50%)',
        zIndex: 20000,
        width: '100%',
        maxWidth: 'min(480px, calc(100vw - 32px))',
        pointerEvents: 'none'
      }}
    >
      <div
        className="premium-card premium-glass animate-slide-up"
        style={{
          pointerEvents: 'auto',
          border: '1px solid rgba(255, 215, 0, 0.45)',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.45), 0 0 32px rgba(255, 215, 0, 0.12)',
          borderRadius: 18,
          padding: '18px 20px',
          background: 'linear-gradient(155deg, rgba(10, 13, 28, 0.97), rgba(15, 19, 53, 0.97))',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          maxHeight: '80vh',
          overflowY: 'auto'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              borderRadius: 12,
              background: 'rgba(255, 215, 0, 0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 16px rgba(255, 215, 0, 0.15)'
            }}
          >
            <DownloadCloud size={20} color="#FFD700" />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
              Mise à jour prête
              <Sparkles size={13} color="#FFD700" />
            </h4>
          </div>

          <button
            onClick={onAcknowledge}
            aria-label="Fermer la notification"
            title="J'ai compris"
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          <p style={{ margin: 0 }}>
            Une nouvelle version de GEST-IN-SITU va s'installer <strong style={{ color: '#fff' }}>automatiquement à la prochaine fermeture</strong> de l'application. Vous n'avez rien à faire.
          </p>
          <p style={{ margin: '10px 0 0 0', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span
              aria-hidden="true"
              style={{
                flexShrink: 0,
                marginTop: 5,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: '#FFD700',
                display: 'inline-block',
                animation: 'pulse 1.8s ease-in-out infinite'
              }}
            />
            <span>
              Pendant l'installation, l'icône du raccourci sur le bureau peut <strong style={{ color: '#fff' }}>clignoter ou blanchir quelques secondes</strong> : c'est normal, ce n'est pas une anomalie.
            </span>
          </p>
        </div>

        {/* Footer */}
        <button
          onClick={onAcknowledge}
          className="btn-plein-soleil"
          style={{
            marginTop: 2,
            padding: '11px 18px',
            borderRadius: 12,
            fontWeight: 800,
            fontSize: 13,
            backgroundColor: '#FFE600',
            color: '#000000',
            border: '1px solid #FFE600',
            cursor: 'pointer'
          }}
        >
          J'ai compris
        </button>
      </div>
    </div>
  );
}
