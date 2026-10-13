import React, { useState } from 'react';
import { DownloadCloud, Sparkles, X } from 'lucide-react';

interface UpdateReadyBannerProps {
  visible: boolean;
  /** « Plus tard » (croix) : masque seulement le bandeau, sans rien déclencher. */
  onAcknowledge: () => void;
  /**
   * « Installer maintenant » : déclenche la fermeture de la fenêtre principale, qui lance
   * l'installation (contrôle synchro/import côté main). Le bandeau n'est PAS masqué ici :
   * si l'utilisateur choisit « Attendre » dans le dialogue de fermeture, il reste visible.
   */
  onInstallNow: () => void | Promise<void>;
}

/**
 * Bandeau persistant "Mise à jour prête".
 *
 * Remplace l'ancien toast auto-disparaissant (10s) : une mise à jour dont
 * la fenêtre d'installation visible va apparaître à la fermeture de l'app
 * est un événement important pour un agent terrain peu technique — il doit
 * rester visible jusqu'à acquittement explicite, sans jamais bloquer la
 * saisie en cours.
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
export default function UpdateReadyBanner({ visible, onAcknowledge, onInstallNow }: UpdateReadyBannerProps) {
  // Garde anti-réentrance (double-clic) : bouton désactivé pendant le traitement, puis
  // réarmé (cas « Attendre » ou annulation de la confirmation : le bandeau reste affiché).
  const [busy, setBusy] = useState(false);
  if (!visible) return null;

  const handleInstallNow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onInstallNow();
    } catch (err) {
      console.error('[UpdateReadyBanner] Échec du lancement de l\'installation:', err);
    } finally {
      // Délai court : laisse le temps au dialogue de fermeture natif d'apparaître avant
      // de réarmer le bouton.
      setTimeout(() => setBusy(false), 1500);
    }
  };

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
            title="Plus tard"
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
            Une nouvelle version est prête. Cliquez sur « <strong style={{ color: '#fff' }}>Installer maintenant</strong> » : l'application va se fermer, installer la mise à jour, puis se relancer automatiquement. Pensez à enregistrer votre travail.
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
              <strong style={{ color: '#fff' }}>Ne fermez pas la fenêtre d'installation manuellement</strong> pendant la copie des fichiers : attendez qu'elle se termine et que l'application se relance d'elle-même.
            </span>
          </p>
        </div>

        {/* Footer */}
        <button
          onClick={handleInstallNow}
          disabled={busy}
          className="btn-plein-soleil"
          style={{
            opacity: busy ? 0.6 : 1,
            marginTop: 2,
            padding: '11px 18px',
            borderRadius: 12,
            fontWeight: 800,
            fontSize: 13,
            backgroundColor: '#FFE600',
            color: '#000000',
            border: '1px solid #FFE600',
            cursor: busy ? 'default' : 'pointer'
          }}
        >
          Installer maintenant
        </button>
      </div>
    </div>
  );
}
