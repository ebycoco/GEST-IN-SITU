import React from 'react';

interface LicenseExpiryBannerProps {
  message: string;
  visible: boolean;
  onClose: () => void;
}

/**
 * Bannière flottante non bloquante d'expiration imminente de licence de site
 * (≤ 3 jours avant `t_sites.expiry_date`). Message déjà formaté côté main
 * (voir `checkAndPushLicenseExpiryWarning` dans
 * `src/main/auth/session-heartbeat.ts`, qui pousse le canal IPC
 * `license:expiryWarning`) — ce composant ne fait qu'afficher tel quel le
 * texte reçu.
 *
 * Remplace intégralement l'ancien mécanisme `auth:warning` (toast unique au
 * login, seuil ≤30 jours, retiré de `authenticateUser()` dans
 * `users.queries.ts`). Composant contrôlé et volontairement minimal (pas
 * d'habillage visuel poussé — un designer interviendra ensuite) : la logique
 * de réapparition après fermeture (délai `reappearMs` reçu du main, cadencé
 * selon le rôle actif) est gérée par l'appelant (`App.tsx`), pas ici.
 * Structure générale inspirée de `UpdateReadyBanner.tsx` (bannière déjà
 * existante dans ce dossier), sans reprendre son style final.
 */
export default function LicenseExpiryBanner({ message, visible, onClose }: LicenseExpiryBannerProps) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        top: 16,
        transform: 'translateX(-50%)',
        zIndex: 20000,
        width: '100%',
        maxWidth: 'min(480px, calc(100vw - 32px))',
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          border: '1px solid rgba(239, 68, 68, 0.45)',
          borderRadius: 12,
          padding: '12px 16px',
          background: 'rgba(30, 10, 10, 0.95)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12
        }}
      >
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5, color: '#fff' }}>
          {message}
        </div>
        <button
          onClick={onClose}
          aria-label="Fermer l'alerte de licence"
          title="Fermer"
          style={{
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            padding: 4,
            fontSize: 14,
            lineHeight: 1
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
