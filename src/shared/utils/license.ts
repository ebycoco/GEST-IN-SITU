/**
 * Calcul PUR (sans I/O, sans exception) de l'état d'une licence de site, pour l'affichage.
 *
 * Cohérence avec l'existant (NON modifié) :
 *  - critère d'expiration identique à la règle de blocage (users.queries.ts / session-heartbeat.ts) :
 *    expiré si `!is_permanent && expiry_date && now > expiry` ;
 *  - daysLeft = Math.ceil((expiry - now) / 86400000), MÊME calcul que la bannière
 *    session-heartbeat.ts (checkAndPushLicenseExpiryWarning), pour que les deux affichages concordent.
 */

export type LicenseState =
  | 'permanent'
  | 'undefined'
  | 'ok'
  | 'warning'
  | 'critical'
  | 'expired'
  | 'invalid';

export interface LicenseStatus {
  state: LicenseState;
  /** Jours restants (ceil, >= 0 pour les états non expirés) ; null si non applicable. */
  daysLeft: number | null;
}

const MS_PER_DAY = 1000 * 3600 * 24;

/** Seuils : ok > 30 j ; warning 8..30 j ; critical <= 7 j. */
export const LICENSE_WARNING_MAX_DAYS = 30;
export const LICENSE_CRITICAL_MAX_DAYS = 7;

function isTruthyPermanent(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

export function computeLicenseStatus(
  expiryDate: string | null | undefined,
  isPermanent: number | boolean | string | null | undefined,
  now: Date = new Date()
): LicenseStatus {
  try {
    if (isTruthyPermanent(isPermanent)) return { state: 'permanent', daysLeft: null };

    if (expiryDate === null || expiryDate === undefined || String(expiryDate).trim() === '') {
      return { state: 'undefined', daysLeft: null };
    }

    const expiryMs = new Date(expiryDate).getTime();
    const nowMs = now.getTime();
    if (Number.isNaN(expiryMs) || Number.isNaN(nowMs)) return { state: 'invalid', daysLeft: null };

    const diff = expiryMs - nowMs;
    // `|| 0` normalise -0 (Math.ceil d'un petit négatif).
    const daysLeft = Math.ceil(diff / MS_PER_DAY) || 0;

    // Même critère que le blocage : strictement après l'échéance.
    if (nowMs > expiryMs) return { state: 'expired', daysLeft };
    if (daysLeft <= LICENSE_CRITICAL_MAX_DAYS) return { state: 'critical', daysLeft };
    if (daysLeft <= LICENSE_WARNING_MAX_DAYS) return { state: 'warning', daysLeft };
    return { state: 'ok', daysLeft };
  } catch {
    return { state: 'invalid', daysLeft: null };
  }
}
