/**
 * Calcul PUR (sans I/O, sans exception) de l'état d'une licence de site.
 *
 * RÈGLE A1 (source unique, utilisée par le blocage au login, le blocage de session ouverte,
 * la bannière préventive et l'affichage) : la date d'échéance saisie (ex. 2026-10-10, stockée
 * 2026-10-10T00:00:00.000Z par SitesPage) est le DERNIER JOUR utilisable. La licence est valable
 * jusqu'à la fin de ce jour calendaire UTC (= heure d'Abidjan, UTC+0) et ne s'arrête qu'au début
 * du lendemain à 00:00:00.000 UTC. Seul le jour calendaire UTC de la valeur stockée compte (une
 * éventuelle heure non nulle est ignorée). Les données stockées ne changent pas : seule leur
 * interprétation change.
 *  - expiré  <=> now >= début du lendemain du jour d'échéance (UTC) ;
 *  - daysLeft = nombre de jours calendaires UTC entre aujourd'hui et le jour d'échéance
 *    (0 le jour même = « Expire aujourd'hui », 1 la veille, ...) — plus de Math.ceil brut.
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
  /** Jours calendaires UTC restants (0 = dernier jour ; >= 0 si non expiré, < 0 si expiré) ; null si non applicable. */
  daysLeft: number | null;
}

const MS_PER_DAY = 1000 * 3600 * 24;

/** Seuils : ok > 30 j ; warning 8..30 j ; critical <= 7 j. */
export const LICENSE_WARNING_MAX_DAYS = 30;
export const LICENSE_CRITICAL_MAX_DAYS = 7;

/** Début (ms epoch) du jour calendaire UTC contenant `ms`. */
function startOfUtcDayMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Limite de validité (règle A1) : 00:00:00.000 UTC du lendemain du jour calendaire UTC de
 * `expiryDate`. `null` si la date n'est pas parsable. Ne lève jamais.
 */
export function getLicenseLimitMs(expiryDate: string | null | undefined): number | null {
  try {
    if (expiryDate === null || expiryDate === undefined) return null;
    const ms = new Date(expiryDate).getTime();
    if (Number.isNaN(ms)) return null;
    return startOfUtcDayMs(ms) + MS_PER_DAY;
  } catch {
    return null;
  }
}

/**
 * true seulement si `now >= limite` (règle A1). Date non parsable (ou `now` invalide) : false
 * (ne bloque pas, comme l'ancien `now > NaN`). Ne lève jamais.
 */
export function isLicenseExpired(expiryDate: string | null | undefined, now: Date = new Date()): boolean {
  try {
    const limit = getLicenseLimitMs(expiryDate);
    const nowMs = now.getTime();
    if (limit === null || Number.isNaN(nowMs)) return false;
    return nowMs >= limit;
  } catch {
    return false;
  }
}

/**
 * Jours calendaires UTC entre le jour de `now` et le jour d'échéance : 0 le jour même, 1 la
 * veille... Valeur négative si le jour d'échéance est passé (l'état est alors 'expired' côté
 * appelant). null si la date ou `now` n'est pas parsable. Ne lève jamais.
 */
export function getLicenseDaysLeft(expiryDate: string | null | undefined, now: Date = new Date()): number | null {
  try {
    const limit = getLicenseLimitMs(expiryDate);
    const nowMs = now.getTime();
    if (limit === null || Number.isNaN(nowMs)) return null;
    const expiryDayStart = limit - MS_PER_DAY;
    // `|| 0` normalise -0.
    return Math.round((expiryDayStart - startOfUtcDayMs(nowMs)) / MS_PER_DAY) || 0;
  } catch {
    return null;
  }
}

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

    const daysLeft = getLicenseDaysLeft(expiryDate, now);
    if (daysLeft === null) return { state: 'invalid', daysLeft: null };

    // Même critère que le blocage (règle A1) : expiré à partir du lendemain 00:00 UTC.
    // Le jour d'échéance lui-même (daysLeft 0) reste 'critical'.
    if (isLicenseExpired(expiryDate, now)) return { state: 'expired', daysLeft };
    if (daysLeft <= LICENSE_CRITICAL_MAX_DAYS) return { state: 'critical', daysLeft };
    if (daysLeft <= LICENSE_WARNING_MAX_DAYS) return { state: 'warning', daysLeft };
    return { state: 'ok', daysLeft };
  } catch {
    return { state: 'invalid', daysLeft: null };
  }
}
