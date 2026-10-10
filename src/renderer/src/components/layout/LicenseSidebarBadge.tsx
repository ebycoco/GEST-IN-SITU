import React from 'react';
import { computeLicenseStatus, LicenseState } from '../../../../shared/utils/license';

/**
 * Badge « Licence · Pro » discret affiché sous le nom du site dans l'en-tête de la Sidebar.
 *
 * Données : AUCUN appel IPC ici. La Sidebar détient déjà la liste des sites (getSites, cantonnée côté
 * main via getSecureCurrentUser(), rafraîchie sur 'app:data-updated') et passe uniquement le site
 * courant en prop : zéro effet, zéro listener, zéro setState => rien à nettoyer, pas de fuite mémoire.
 * Tout état inattendu (site absent, rôle SUPER ADMIN) => rien n'est rendu ; computeLicenseStatus ne lève jamais.
 *
 * Libellé « Licence » + « Pro » FIXE : aucune donnée de plan/offre n'existe en base (idem LicenseStatusCard).
 * Aucun nombre de jours ni date n'est affiché ni exposé dans l'infobulle.
 */

export interface LicenseBadgeModel {
  color: string;
  /** « Expire bientôt » : uniquement en état critical (<= 7 j). */
  showSoonText: boolean;
  /** Infobulle (title + aria) : uniquement warning / critical / undefined ; null sinon. */
  tooltip: string | null;
}

const STATE_COLOR: Record<LicenseState, string> = {
  permanent: 'var(--accent-green)',
  ok: 'var(--accent-green)',
  warning: 'var(--accent-orange)',
  undefined: 'var(--accent-orange)',
  critical: 'var(--accent-red)',
  expired: 'var(--accent-red)',
  invalid: 'var(--text-secondary)'
};

/**
 * Fonction pure : état de licence + rôle ACTIF -> modèle d'affichage. Retourne null pour SUPER ADMIN
 * (ou rôle absent) : le badge n'est alors pas affiché.
 * « undefined » (échéance non définie) reçoit l'infobulle : l'action de l'utilisateur est la même
 * (faire régulariser l'échéance par le niveau supérieur).
 */
export function getLicenseBadgeModel(state: LicenseState, role: string | null | undefined): LicenseBadgeModel | null {
  if (!role || role === 'SUPER ADMIN') return null;
  const needsAction = state === 'warning' || state === 'critical' || state === 'undefined';
  const tooltip = needsAction
    ? role === 'ADMINISTRATEUR_SITE'
      ? 'Pour renouveler, contactez le super administrateur.'
      : "Pour renouveler, contactez l'administrateur du site."
    : null;
  return { color: STATE_COLOR[state], showSoonText: state === 'critical', tooltip };
}

interface LicenseSidebarBadgeProps {
  /** Site courant (issu de l'état `sites` de la Sidebar) ; undefined tant que non chargé / introuvable. */
  site: { expiry_date?: string | null; is_permanent?: number | boolean | string | null } | null | undefined;
  /** Rôle ACTIF issu du store d'authentification (pas de relecture SQL). */
  role: string | null | undefined;
}

export function LicenseSidebarBadge({ site, role }: LicenseSidebarBadgeProps) {
  if (!site) return null;
  const { state } = computeLicenseStatus(site.expiry_date, site.is_permanent);
  const model = getLicenseBadgeModel(state, role);
  if (!model) return null;

  return (
    <div
      role="status"
      // Source UNIQUE de l'infobulle : l'attribut title (infobulle visuelle + description accessible exposée par Chromium).
      // Ni aria-describedby ni <span> masqué : évite la double annonce lecteur d'écran.
      title={model.tooltip ?? undefined}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, marginTop: 3, position: 'relative', minWidth: 0 }}
    >
      {/* Ligne 1 : pastille · Licence · Pro (inchangée, nowrap). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, whiteSpace: 'nowrap' }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: model.color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase', color: 'var(--text-primary)', flexShrink: 0 }}>Licence</span>
        {/* Libellé FIXE « Pro » (aucune donnée de plan en base) — même style que LicenseStatusCard. */}
        <span style={{ fontSize: 11, fontWeight: 800, lineHeight: 1.2, padding: '0 5px', borderRadius: 999, background: '#ffd700', color: '#0a0e27', flexShrink: 0 }}>Pro</span>
      </div>
      {/* Ligne 2 (critical uniquement) : texte sur sa propre ligne, aligné sous « Licence » (8px pastille + 6px gap),
          jamais tronqué (pas d'ellipsis) ; retour à la ligne propre si la largeur disponible était insuffisante. */}
      {model.showSoonText && (
        <span style={{ marginLeft: 14, minWidth: 0, fontSize: 11, fontWeight: 700, color: model.color, whiteSpace: 'normal', overflowWrap: 'break-word' }}>Expire bientôt</span>
      )}
    </div>
  );
}
