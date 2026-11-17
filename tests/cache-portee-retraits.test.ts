/**
 * Correctifs lot 3 : page Retraits liée au site actif (computeRetraitsScopeKey, setRetraitsCache
 * avec scopeKey optionnel) et règle pure « appel né périmé » (isStaleScope) du hook
 * useDashboardStats (bouton « Actualiser » bloqué). Environnement node, sans React ni jsdom : les
 * effets React sont couverts par les specs e2e (agent-13).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeRetraitsScopeKey,
  isStaleScope,
  shouldRestoreCache
} from '../src/renderer/src/utils/cacheScope';
import { useCacheStore } from '../src/renderer/src/stores/cacheStore';

const base = { role: 'SUPER ADMIN', activeSiteId: 1, userSiteId: 9, centreId: null, period: 'semaine', customDate: null };

describe('computeRetraitsScopeKey', () => {
  it('SUPER ADMIN : suit le site actif (pas le site de rattachement)', () => {
    expect(computeRetraitsScopeKey(base)).toBe('RETRAITS:1:SUPER ADMIN:none:semaine:none');
    expect(computeRetraitsScopeKey({ ...base, activeSiteId: 2 })).toBe('RETRAITS:2:SUPER ADMIN:none:semaine:none');
    expect(computeRetraitsScopeKey(base)).not.toBe(computeRetraitsScopeKey({ ...base, activeSiteId: 2 }));
  });

  it('rôle non SA : site de rattachement, activeSiteId ignoré', () => {
    const k = computeRetraitsScopeKey({ ...base, role: 'ADMIN_CENTRE', centreId: 4 });
    expect(k).toBe('RETRAITS:9:ADMIN_CENTRE:4:semaine:none');
    expect(computeRetraitsScopeKey({ ...base, role: 'ADMIN_CENTRE', centreId: 4, activeSiteId: 77 })).toBe(k);
  });

  it('la période et la date font partie de la clé (le cache dépend des filtres)', () => {
    const jourA = computeRetraitsScopeKey({ ...base, period: 'jour', customDate: '2026-11-17' });
    const jourB = computeRetraitsScopeKey({ ...base, period: 'jour', customDate: '2026-11-16' });
    const mois = computeRetraitsScopeKey({ ...base, period: 'mois', customDate: '2026-11' });
    expect(new Set([computeRetraitsScopeKey(base), jourA, jourB, mois]).size).toBe(4);
  });

  it('le rôle actif et le centre changent la clé ; clé distincte de celles du dashboard/import', () => {
    expect(computeRetraitsScopeKey({ ...base, role: 'ADMINISTRATEUR_SITE' })).not.toBe(computeRetraitsScopeKey(base));
    expect(computeRetraitsScopeKey({ ...base, centreId: 3 })).not.toBe(computeRetraitsScopeKey(base));
    expect(computeRetraitsScopeKey(base).startsWith('RETRAITS:')).toBe(true);
  });

  it('valeurs absentes : "none", jamais "undefined"/"null"', () => {
    const k = computeRetraitsScopeKey({ role: undefined, activeSiteId: undefined, userSiteId: undefined, centreId: undefined, period: 'annee' });
    expect(k).toBe('RETRAITS:none:none:none:annee:none');
  });
});

describe('isStaleScope (règle « appel né périmé -> ne rien faire »)', () => {
  it('même portée : appel valide, jamais bloqué', () => {
    expect(isStaleScope('SITE:1:SUPER ADMIN:none', 'SITE:1:SUPER ADMIN:none')).toBe(false);
  });
  it('portée courante différente (changement de site après un long await) : périmé', () => {
    expect(isStaleScope('SITE:2:SUPER ADMIN:none', 'SITE:1:SUPER ADMIN:none')).toBe(true);
    expect(isStaleScope('GLOBAL', 'SITE:1:SUPER ADMIN:none')).toBe(true);
  });
});

describe('useCacheStore : retraitsCache avec portée (node, sans DOM)', () => {
  beforeEach(() => {
    useCacheStore.getState().clearCache();
  });

  it('état initial / après clearCache : scopeKey null, cachedAt null', () => {
    const c = useCacheStore.getState().retraitsCache;
    expect(c).toEqual({ data: null, trend: [], cachedAt: null, scopeKey: null });
  });

  it('setRetraitsCache(data, trend, scopeKey) : étiqueté, restaurable pour la même clé uniquement', () => {
    const k = 'RETRAITS:1:SUPER ADMIN:none:semaine:none';
    useCacheStore.getState().setRetraitsCache({ rows: [1], totaux: {} }, [{ label: 'a', total: 4 }], k);
    const c = useCacheStore.getState().retraitsCache;
    expect(c.scopeKey).toBe(k);
    expect(c.cachedAt).toEqual(expect.any(Number));
    expect(shouldRestoreCache(c, k)).toBe(true);
    expect(shouldRestoreCache(c, 'RETRAITS:2:SUPER ADMIN:none:semaine:none')).toBe(false);
    expect(shouldRestoreCache(c, 'RETRAITS:1:SUPER ADMIN:none:jour:2026-11-17')).toBe(false);
  });

  it('ancien appel setRetraitsCache(data, trend) sans scopeKey : compatible, jamais restauré', () => {
    useCacheStore.getState().setRetraitsCache({ rows: [], totaux: {} }, []);
    const c = useCacheStore.getState().retraitsCache;
    expect(c.scopeKey).toBeNull();
    expect(c.cachedAt).toEqual(expect.any(Number));
    expect(shouldRestoreCache(c, 'RETRAITS:1:SUPER ADMIN:none:semaine:none')).toBe(false);
  });

  it('un 2e setRetraitsCache remplace la portée précédente (un seul instantané)', () => {
    useCacheStore.getState().setRetraitsCache({ rows: [1] }, [], 'K1');
    useCacheStore.getState().setRetraitsCache({ rows: [2] }, [], 'K2');
    const c = useCacheStore.getState().retraitsCache;
    expect(c.scopeKey).toBe('K2');
    expect(c.data).toEqual({ rows: [2] });
    expect(shouldRestoreCache(c, 'K1')).toBe(false);
  });

  it('clearCache efface la portée retraits', () => {
    useCacheStore.getState().setRetraitsCache({ rows: [1] }, [], 'K');
    useCacheStore.getState().clearCache();
    expect(useCacheStore.getState().retraitsCache).toEqual({ data: null, trend: [], cachedAt: null, scopeKey: null });
  });

  it('les autres caches sont strictement inchangés par setRetraitsCache', () => {
    const s = useCacheStore.getState();
    const before = {
      dashboard: s.dashboardCache, importC: s.importCache, centre: s.centreDashboardCache,
      qualite: s.qualiteCache, agents: s.agentsCache, sites: s.sitesCache, centres: s.centresCache
    };
    s.setRetraitsCache({ rows: [1] }, [], 'K');
    const a = useCacheStore.getState();
    expect(a.dashboardCache).toBe(before.dashboard);
    expect(a.importCache).toBe(before.importC);
    expect(a.centreDashboardCache).toBe(before.centre);
    expect(a.qualiteCache).toBe(before.qualite);
    expect(a.agentsCache).toBe(before.agents);
    expect(a.sitesCache).toBe(before.sites);
    expect(a.centresCache).toBe(before.centres);
  });
});
