import { describe, it, expect } from 'vitest';
import {
  parseSemver,
  compareVersions,
  pickReferenceVersion,
  isSilent,
  computeVersionState,
  computeRowState,
  summarize,
  sortByLateness,
  formatRelative,
  formatAbsolute,
  SILENT_AFTER_MS,
} from '../src/renderer/src/pages/postesVersionsStatus';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const msAgo = (ms: number): string => new Date(NOW - ms).toISOString();
const DAY = 86_400_000;

describe('parseSemver', () => {
  it('lit x.y.z, avec v initial, espaces et suffixes', () => {
    expect(parseSemver('2.26.2')).toEqual([2, 26, 2]);
    expect(parseSemver('v2.26.2')).toEqual([2, 26, 2]);
    expect(parseSemver('V1.0.0')).toEqual([1, 0, 0]);
    expect(parseSemver('  2.27.0-beta.1 ')).toEqual([2, 27, 0]);
    expect(parseSemver('2.27.0+build5')).toEqual([2, 27, 0]);
  });
  it('invalide, vide ou absent → null', () => {
    for (const v of ['', 'abc', '2.26', '2.26.x', '2..1', 'x.y.z', '-1.0.0', '2.26.2.1', null, undefined]) {
      expect(parseSemver(v as string | null | undefined)).toBeNull();
    }
  });
});

describe('compareVersions', () => {
  it('compare numériquement (pas lexicographiquement)', () => {
    expect(compareVersions('2.9.0', '2.10.0')).toBe(-1);
    expect(compareVersions('2.26.2', '2.26.2')).toBe(0);
    expect(compareVersions('v3.0.0', '2.99.99')).toBe(1);
    expect(compareVersions('2.26.2-rc1', '2.26.2')).toBe(0);
  });
  it('null si une version est invalide', () => {
    expect(compareVersions('abc', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0', null)).toBeNull();
  });
});

describe('pickReferenceVersion', () => {
  const rows = [{ app_version: '2.24.0' }, { app_version: 'zzz' }, { app_version: '2.26.2' }, { app_version: null }];
  it('préfère latestVersion valide', () => {
    expect(pickReferenceVersion('2.27.0', rows)).toBe('2.27.0');
    expect(pickReferenceVersion(' v2.27.0 ', rows)).toBe('v2.27.0');
  });
  it('sinon la plus haute version valide des lignes', () => {
    expect(pickReferenceVersion(null, rows)).toBe('2.26.2');
    expect(pickReferenceVersion('invalide', rows)).toBe('2.26.2');
  });
  it('aucune référence possible → null', () => {
    expect(pickReferenceVersion(null, [])).toBeNull();
    expect(pickReferenceVersion(null, [{ app_version: 'x' }])).toBeNull();
  });
});

describe('isSilent (borne 7 jours)', () => {
  it('exactement 7 jours : pas silencieux ; 7 jours + 1 ms : silencieux', () => {
    expect(isSilent(msAgo(SILENT_AFTER_MS), NOW)).toBe(false);
    expect(isSilent(msAgo(SILENT_AFTER_MS + 1), NOW)).toBe(true);
    expect(isSilent(msAgo(7 * DAY - 1), NOW)).toBe(false);
  });
  it('récent et futur : pas silencieux', () => {
    expect(isSilent(msAgo(60_000), NOW)).toBe(false);
    expect(isSilent(msAgo(-3_600_000), NOW)).toBe(false);
  });
  it('date absente ou invalide : silencieux', () => {
    expect(isSilent(null, NOW)).toBe(true);
    expect(isSilent('pas une date', NOW)).toBe(true);
  });
});

describe('computeVersionState / computeRowState', () => {
  it('à jour (égal ou supérieur), en retard, inconnu', () => {
    expect(computeVersionState('2.26.2', '2.26.2')).toBe('A_JOUR');
    expect(computeVersionState('2.27.0', '2.26.2')).toBe('A_JOUR');
    expect(computeVersionState('2.26.1', '2.26.2')).toBe('EN_RETARD');
  });
  it('référence absente ou version invalide → inconnu', () => {
    expect(computeVersionState('2.26.2', null)).toBe('INCONNU');
    expect(computeVersionState('n/a', '2.26.2')).toBe('INCONNU');
    expect(computeVersionState(null, '2.26.2')).toBe('INCONNU');
  });
  it('silencieux prioritaire mais état de version conservé', () => {
    const info = computeRowState({ app_version: '2.20.0', last_seen_at: msAgo(8 * DAY) }, '2.26.2', NOW);
    expect(info).toEqual({ state: 'SILENCIEUX', versionState: 'EN_RETARD', silent: true });
    const live = computeRowState({ app_version: '2.20.0', last_seen_at: msAgo(DAY) }, '2.26.2', NOW);
    expect(live).toEqual({ state: 'EN_RETARD', versionState: 'EN_RETARD', silent: false });
  });
});

describe('summarize', () => {
  it('somme des états = total', () => {
    const s = summarize(['A_JOUR', 'A_JOUR', 'EN_RETARD', 'INCONNU', 'SILENCIEUX']);
    expect(s).toEqual({ total: 5, A_JOUR: 2, EN_RETARD: 1, INCONNU: 1, SILENCIEUX: 1 });
    expect(summarize([]).total).toBe(0);
  });
});

describe('sortByLateness', () => {
  const mk = (ref: string, v: string | null, seenAgo: number | null) => {
    const row = { poste_ref: ref, app_version: v, last_seen_at: seenAgo === null ? null : msAgo(seenAgo) };
    return { row, info: computeRowState(row, '2.26.2', NOW) };
  };
  it('en retard (plus bas d\'abord), silencieux, inconnu, à jour ; sans muter l\'entrée', () => {
    const input = [
      mk('aaaaaaaa', '2.26.2', DAY),
      mk('bbbbbbbb', 'zz', DAY),
      mk('cccccccc', '2.10.0', 9 * DAY),
      mk('dddddddd', '2.25.0', DAY),
      mk('eeeeeeee', '2.20.0', DAY),
    ];
    const copy = [...input];
    const out = sortByLateness(input).map((i) => i.row.poste_ref);
    expect(out).toEqual(['eeeeeeee', 'dddddddd', 'cccccccc', 'bbbbbbbb', 'aaaaaaaa']);
    expect(input).toEqual(copy);
  });
  it('à état et version égaux : remontée la plus ancienne d\'abord', () => {
    const out = sortByLateness([mk('11111111', '2.26.2', 1000), mk('22222222', '2.26.2', 5000)]).map((i) => i.row.poste_ref);
    expect(out).toEqual(['22222222', '11111111']);
  });
});

describe('formatRelative / formatAbsolute', () => {
  it('relatif en français', () => {
    expect(formatRelative(msAgo(10_000), NOW)).toBe("à l'instant");
    expect(formatRelative(msAgo(5 * 60_000), NOW)).toBe('il y a 5 min');
    expect(formatRelative(msAgo(3 * 3_600_000), NOW)).toBe('il y a 3 h');
    expect(formatRelative(msAgo(2 * DAY + 1000), NOW)).toBe('il y a 2 j');
    expect(formatRelative(msAgo(-60_000), NOW)).toBe("à l'instant");
  });
  it('absent ou invalide → tiret', () => {
    expect(formatRelative(null, NOW)).toBe('—');
    expect(formatRelative('x', NOW)).toBe('—');
    expect(formatAbsolute(null)).toBe('—');
    expect(formatAbsolute('x')).toBe('—');
    expect(formatAbsolute(msAgo(0))).not.toBe('—');
  });
});
