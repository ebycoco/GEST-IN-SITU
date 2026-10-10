import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { computeLicenseStatus, LicenseState } from '../../../../../shared/utils/license';
import type { ISite } from '../../../../../shared/types';

/**
 * Carte « Licence » du tableau de bord ADMINISTRATEUR_SITE (et SUPER ADMIN consultant un site).
 *
 * Données : un unique appel `window.api.hierarchy.getSites()` (handler existant, cantonné côté main
 * via getSecureCurrentUser() : site propre pour un admin, tous les sites pour un SUPER ADMIN — d'où
 * le `find` par id côté renderer). Aucun nouveau canal IPC, aucune écriture.
 *
 * Asynchronisme / mémoire : l'effet est protégé par un drapeau `cancelled` (démontage ou changement
 * de site/refreshToken avant la réponse => la réponse est ignorée, aucun setState sur composant démonté).
 * Seul le site courant est conservé en état (pas la liste complète). Tout échec est silencieux
 * (console.warn) : la carte ne rend alors rien et ne peut pas casser le dashboard.
 *
 * Calcul des jours : voir shared/utils/license.ts (même Math.ceil que la bannière d'expiration).
 */

interface LicenseStatusCardProps {
  /** Valeur qui change à chaque clic sur « Actualiser » pour relancer le chargement. */
  refreshToken?: number | null;
}

type SiteLicense = Pick<ISite, 'id' | 'expiry_date' | 'is_permanent'>;

const STATE_COLOR: Record<LicenseState, string> = {
  permanent: 'var(--accent-green)',
  ok: 'var(--accent-green)',
  warning: 'var(--accent-orange)',
  critical: 'var(--accent-red)',
  expired: 'var(--accent-red)',
  undefined: 'var(--accent-orange)',
  invalid: 'var(--text-secondary)'
};

/** Date d'échéance en toutes lettres, en UTC (l'échéance est saisie à minuit UTC : pas de décalage d'un jour). */
function formatExpiryFr(expiryDate: string): string | null {
  const d = new Date(expiryDate);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function LicenseStatusCard({ refreshToken = null }: LicenseStatusCardProps) {
  const user = useAuthStore((s) => s.user);
  const activeSiteId = useAuthStore((s) => s.activeSiteId);
  const role = user?.role;
  const siteId = role === 'SUPER ADMIN' ? activeSiteId : user?.site_id ?? null;

  const [site, setSite] = React.useState<SiteLicense | null>(null);

  React.useEffect(() => {
    if (!siteId) {
      setSite(null);
      return;
    }
    let cancelled = false;
    window.api.hierarchy
      .getSites()
      .then((sites) => {
        if (cancelled) return;
        const current = (sites as ISite[]).find((s) => s.id === siteId);
        setSite(current ? { id: current.id, expiry_date: current.expiry_date, is_permanent: current.is_permanent } : null);
      })
      .catch((e: unknown) => {
        if (!cancelled) console.warn('[LicenseStatusCard] chargement impossible', e);
      });
    return () => {
      cancelled = true;
    };
  }, [siteId, refreshToken]);

  if (!site) return null;

  const { state, daysLeft } = computeLicenseStatus(site.expiry_date, site.is_permanent);
  const color = STATE_COLOR[state];
  const formatted = site.expiry_date ? formatExpiryFr(site.expiry_date) : null;

  let headline: string;
  let detail: string | null = null;
  switch (state) {
    case 'permanent':
      headline = 'Licence permanente';
      break;
    case 'undefined':
      headline = 'Échéance non définie';
      detail = 'À renseigner par le super administrateur';
      break;
    case 'expired':
      headline = 'Licence expirée';
      if (formatted) detail = `Échue le ${formatted}`;
      break;
    case 'invalid':
      headline = 'Échéance indisponible';
      detail = "La date d'échéance n'a pas pu être lue.";
      break;
    default:
      headline = daysLeft === 0 ? "Expire aujourd'hui" : daysLeft === 1 ? '1 jour restant' : `${daysLeft} jours restants`;
      if (formatted) detail = `Échéance le ${formatted}`;
  }

  const showCounterStyle = state === 'ok' || state === 'warning' || state === 'critical';
  const showContactHelp = role === 'ADMINISTRATEUR_SITE' && state !== 'permanent';
  const ariaLabel = `Licence : ${headline}${detail ? `, ${detail}` : ''}`;

  return (
    <div
      className="glass-card animate-fade-in"
      role="status"
      aria-label={ariaLabel}
      style={{
        display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', padding: '18px 24px',
        marginBottom: 16, width: '100%', boxSizing: 'border-box',
        borderLeft: `4px solid ${color}`, background: 'var(--bg-card)'
      }}
    >
      <div style={{ width: 48, height: 48, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <ShieldCheck size={26} color={color} aria-hidden="true" />
      </div>

      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Licence</span>
          {/* Libellé FIXE « Pro » : il n'existe aucune donnée de plan/offre en base ; ce badge est purement décoratif et identique pour tous les sites. */}
          <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 999, background: '#ffd700', color: '#0a0e27' }}>Pro</span>
        </div>
        <div style={{ fontSize: showCounterStyle ? 28 : 20, fontWeight: 800, color, lineHeight: 1.2 }}>{headline}</div>
        {detail && <div style={{ fontSize: 13, color: 'var(--text-primary)', marginTop: 4 }}>{detail}</div>}
      </div>

      {showContactHelp && (
        <div style={{ flex: '1 1 220px', fontSize: 12.5, color: 'var(--text-secondary)', textAlign: 'right' }}>
          Pour renouveler votre licence, contactez le super administrateur.
        </div>
      )}
    </div>
  );
}
