/**
 * Correctif « site actif périmé » (D1 tableau de bord, D2 page Import).
 *
 * Teste en PUR (environnement node, sans React ni jsdom) :
 *  1. l'utilitaire de portée src/renderer/src/utils/cacheScope.ts ;
 *  2. le store zustand useCacheStore : champ optionnel scopeKey, setImportCache(count, scopeKey?)
 *     rétrocompatible, autres caches inchangés, effacement par clearCache / invalidateDashboardCache.
 *
 * Les effets React (changement de site A -> B -> A) sont couverts par les specs e2e (agent-13).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  GOVERNANCE_SCOPE_KEY,
  computeDashboardScopeKey,
  computeImportScopeKey,
  resolveEffectiveSiteId,
  shouldRestoreCache
} from '../src/renderer/src/utils/cacheScope';
import { useCacheStore } from '../src/renderer/src/stores/cacheStore';

describe('computeDashboardScopeKey', () => {
  const base = { role: 'SUPER ADMIN', activeSiteId: 1, userSiteId: 9, centreId: null, isGovernanceView: false };

  it('même portée => même clé', () => {
    expect(computeDashboardScopeKey(base)).toBe(computeDashboardScopeKey({ ...base }));
  });

  it('SUPER ADMIN : le site actif (pas le site de rattachement) détermine la clé', () => {
    expect(computeDashboardScopeKey(base)).toBe('SITE:1:SUPER ADMIN:none');
    expect(computeDashboardScopeKey({ ...base, activeSiteId: 2 })).toBe('SITE:2:SUPER ADMIN:none');
    expect(computeDashboardScopeKey(base)).not.toBe(computeDashboardScopeKey({ ...base, activeSiteId: 2 }));
    // userSiteId n'influence pas la clé d'un SUPER ADMIN
    expect(computeDashboardScopeKey({ ...base, userSiteId: 77 })).toBe(computeDashboardScopeKey(base));
  });

  it('autre rôle : le site de rattachement détermine la clé, activeSiteId est ignoré', () => {
    const admin = { ...base, role: 'ADMINISTRATEUR_SITE' };
    expect(computeDashboardScopeKey(admin)).toBe('SITE:9:ADMINISTRATEUR_SITE:none');
    expect(computeDashboardScopeKey({ ...admin, activeSiteId: 5 })).toBe(computeDashboardScopeKey(admin));
  });

  it('le rôle actif change la clé (compte multi-rôles, setActiveRole)', () => {
    const a = computeDashboardScopeKey({ ...base, role: 'ADMINISTRATEUR_SITE' });
    const b = computeDashboardScopeKey({ ...base, role: 'OPERATEUR_SAISIE' });
    expect(a).not.toBe(b);
  });

  it('le centre change la clé', () => {
    const c1 = computeDashboardScopeKey({ ...base, role: 'ADMIN_CENTRE', centreId: 3 });
    const c2 = computeDashboardScopeKey({ ...base, role: 'ADMIN_CENTRE', centreId: 4 });
    expect(c1).not.toBe(c2);
    expect(c1).toBe('SITE:9:ADMIN_CENTRE:3');
  });

  it('vue gouvernance => clé GLOBAL, distincte de tout site', () => {
    const gov = computeDashboardScopeKey({ ...base, activeSiteId: null, isGovernanceView: true });
    expect(gov).toBe(GOVERNANCE_SCOPE_KEY);
    expect(gov).not.toBe(computeDashboardScopeKey(base));
    // sans site actif et hors gouvernance (layouts qui passent false) : clé « none », pas GLOBAL
    expect(computeDashboardScopeKey({ ...base, activeSiteId: null })).toBe('SITE:none:SUPER ADMIN:none');
  });

  it('valeurs absentes / chaîne vide => none, jamais « null » ou « undefined »', () => {
    expect(computeDashboardScopeKey({})).toBe('SITE:none:none:none');
    expect(computeDashboardScopeKey({ role: 'X', userSiteId: '' })).toBe('SITE:none:X:none');
  });

  it('site 0 (falsy mais valide) est conservé dans la clé', () => {
    expect(computeDashboardScopeKey({ role: 'ADMINISTRATEUR_SITE', userSiteId: 0 })).toBe('SITE:0:ADMINISTRATEUR_SITE:none');
  });
});

describe('computeImportScopeKey / resolveEffectiveSiteId', () => {
  it('suit site effectif + rôle, ignore le centre', () => {
    expect(computeImportScopeKey({ role: 'SUPER ADMIN', activeSiteId: 1, userSiteId: 9 })).toBe('IMPORT:1:SUPER ADMIN');
    expect(computeImportScopeKey({ role: 'SUPER ADMIN', activeSiteId: 2, userSiteId: 9 })).toBe('IMPORT:2:SUPER ADMIN');
    expect(computeImportScopeKey({ role: 'ADMINISTRATEUR_SITE', activeSiteId: 2, userSiteId: 9 })).toBe('IMPORT:9:ADMINISTRATEUR_SITE');
  });

  it('SUPER ADMIN sans site actif => IMPORT:none (aucune collision avec un site réel)', () => {
    expect(computeImportScopeKey({ role: 'SUPER ADMIN', activeSiteId: null, userSiteId: 9 })).toBe('IMPORT:none:SUPER ADMIN');
  });

  it('resolveEffectiveSiteId reprend la formule du hook et de la page', () => {
    expect(resolveEffectiveSiteId({ role: 'SUPER ADMIN', activeSiteId: 3, userSiteId: 9 })).toBe(3);
    expect(resolveEffectiveSiteId({ role: 'ADMIN_CENTRE', activeSiteId: 3, userSiteId: 9 })).toBe(9);
  });
});

describe('shouldRestoreCache', () => {
  it('restaure si clé identique ET cachedAt', () => {
    expect(shouldRestoreCache({ cachedAt: 123, scopeKey: 'SITE:1:R:none' }, 'SITE:1:R:none')).toBe(true);
  });

  it('refuse une clé différente (autre site / rôle / centre / gouvernance)', () => {
    expect(shouldRestoreCache({ cachedAt: 123, scopeKey: 'SITE:1:R:none' }, 'SITE:2:R:none')).toBe(false);
    expect(shouldRestoreCache({ cachedAt: 123, scopeKey: 'SITE:1:R:none' }, GOVERNANCE_SCOPE_KEY)).toBe(false);
    expect(shouldRestoreCache({ cachedAt: 123, scopeKey: GOVERNANCE_SCOPE_KEY }, 'SITE:1:R:none')).toBe(false);
  });

  it('refuse un cache sans cachedAt (invalidé ou jamais rempli), même si la clé correspond', () => {
    expect(shouldRestoreCache({ cachedAt: null, scopeKey: 'K' }, 'K')).toBe(false);
    expect(shouldRestoreCache({ cachedAt: 0, scopeKey: 'K' }, 'K')).toBe(false);
  });

  it('refuse un cache hérité sans clé (undefined ou null)', () => {
    expect(shouldRestoreCache({ cachedAt: 123 }, 'K')).toBe(false);
    expect(shouldRestoreCache({ cachedAt: 123, scopeKey: null }, 'K')).toBe(false);
  });

  it('refuse un cache absent', () => {
    expect(shouldRestoreCache(null, 'K')).toBe(false);
    expect(shouldRestoreCache(undefined, 'K')).toBe(false);
  });
});

describe('useCacheStore : portée des caches dashboard / import (node, sans DOM)', () => {
  beforeEach(() => {
    useCacheStore.getState().clearCache();
  });

  it('état initial / après clearCache : scopeKey null, cachedAt null', () => {
    const s = useCacheStore.getState();
    expect(s.dashboardCache.scopeKey).toBeNull();
    expect(s.dashboardCache.cachedAt).toBeNull();
    expect(s.importCache.scopeKey).toBeNull();
    expect(s.importCache.cachedAt).toBeNull();
    expect(s.importCache.cardCount).toBeNull();
  });

  it('setDashboardCache avec scopeKey : posé + cachedAt daté', () => {
    useCacheStore.getState().setDashboardCache({ stats: { total: 23 }, scopeKey: 'SITE:2:SUPER ADMIN:none' });
    const c = useCacheStore.getState().dashboardCache;
    expect(c.scopeKey).toBe('SITE:2:SUPER ADMIN:none');
    expect(c.stats).toEqual({ total: 23 });
    expect(c.cachedAt).toEqual(expect.any(Number));
    expect(shouldRestoreCache(c, 'SITE:2:SUPER ADMIN:none')).toBe(true);
    expect(shouldRestoreCache(c, 'SITE:1:SUPER ADMIN:none')).toBe(false);
  });

  it('ancien appel setDashboardCache SANS scopeKey : compatible, scopeKey inchangé (null) => jamais restauré', () => {
    useCacheStore.getState().setDashboardCache({ dirtyCartesCount: 4 });
    const c = useCacheStore.getState().dashboardCache;
    expect(c.dirtyCartesCount).toBe(4);
    expect(c.cachedAt).toEqual(expect.any(Number));
    expect(c.scopeKey).toBeNull();
    expect(shouldRestoreCache(c, 'SITE:1:R:none')).toBe(false);
  });

  it('une écriture partielle sans scopeKey conserve la clé déjà posée (fusion)', () => {
    useCacheStore.getState().setDashboardCache({ stats: { total: 1 }, scopeKey: 'K' });
    useCacheStore.getState().setDashboardCache({ cloudCartesCount: 7 });
    const c = useCacheStore.getState().dashboardCache;
    expect(c.scopeKey).toBe('K');
    expect(c.stats).toEqual({ total: 1 });
    expect(c.cloudCartesCount).toBe(7);
  });

  it('invalidateDashboardCache : cachedAt null (donc non restaurable), données et clé conservées', () => {
    useCacheStore.getState().setDashboardCache({ stats: { total: 5 }, scopeKey: 'K' });
    useCacheStore.getState().invalidateDashboardCache();
    const c = useCacheStore.getState().dashboardCache;
    expect(c.cachedAt).toBeNull();
    expect(c.scopeKey).toBe('K');
    expect(shouldRestoreCache(c, 'K')).toBe(false);
  });

  it('setImportCache(count, scopeKey) : étiqueté et restaurable pour la même clé uniquement', () => {
    useCacheStore.getState().setImportCache(120, 'IMPORT:1:SUPER ADMIN');
    const c = useCacheStore.getState().importCache;
    expect(c).toMatchObject({ cardCount: 120, scopeKey: 'IMPORT:1:SUPER ADMIN' });
    expect(c.cachedAt).toEqual(expect.any(Number));
    expect(shouldRestoreCache(c, 'IMPORT:1:SUPER ADMIN')).toBe(true);
    expect(shouldRestoreCache(c, 'IMPORT:2:SUPER ADMIN')).toBe(false);
  });

  it('ancien appel setImportCache(count) sans 2e paramètre : compatible, scopeKey null, jamais restauré', () => {
    useCacheStore.getState().setImportCache(33);
    const c = useCacheStore.getState().importCache;
    expect(c.cardCount).toBe(33);
    expect(c.scopeKey).toBeNull();
    expect(c.cachedAt).toEqual(expect.any(Number));
    expect(shouldRestoreCache(c, 'IMPORT:1:SUPER ADMIN')).toBe(false);
  });

  it('un 2e setImportCache remplace la portée précédente (un seul instantané, pas un cache par site)', () => {
    useCacheStore.getState().setImportCache(10, 'IMPORT:1:SUPER ADMIN');
    useCacheStore.getState().setImportCache(0, 'IMPORT:2:SUPER ADMIN');
    const c = useCacheStore.getState().importCache;
    expect(c).toMatchObject({ cardCount: 0, scopeKey: 'IMPORT:2:SUPER ADMIN' });
    expect(shouldRestoreCache(c, 'IMPORT:1:SUPER ADMIN')).toBe(false);
  });

  it('clearCache (logout) efface les deux portées et remet tous les caches à l\'état vide', () => {
    const s = useCacheStore.getState();
    s.setDashboardCache({ stats: { total: 9 }, scopeKey: 'K' });
    s.setImportCache(9, 'IMPORT:1:R');
    s.clearCache();
    const after = useCacheStore.getState();
    expect(after.dashboardCache.scopeKey).toBeNull();
    expect(after.dashboardCache.cachedAt).toBeNull();
    expect(after.dashboardCache.stats).toBeNull();
    expect(after.importCache).toEqual({ cardCount: null, cachedAt: null, scopeKey: null });
  });

  it('les 5 autres caches sont strictement inchangés par les écritures dashboard / import', () => {
    const s = useCacheStore.getState();
    const before = {
      centre: s.centreDashboardCache,
      qualite: s.qualiteCache,
      agents: s.agentsCache,
      sites: s.sitesCache,
      centres: s.centresCache,
      retraits: s.retraitsCache
    };
    s.setDashboardCache({ stats: { total: 1 }, scopeKey: 'K' });
    s.setImportCache(1, 'IMPORT:1:R');
    const a = useCacheStore.getState();
    expect(a.centreDashboardCache).toBe(before.centre);
    expect(a.qualiteCache).toBe(before.qualite);
    expect(a.agentsCache).toBe(before.agents);
    expect(a.sitesCache).toBe(before.sites);
    expect(a.centresCache).toBe(before.centres);
    expect(a.retraitsCache).toBe(before.retraits);
  });

  it('les autres setters conservent leur forme d\'origine (sans scopeKey)', () => {
    const s = useCacheStore.getState();
    s.setAgentsCache([{ id: 1 }]);
    s.setSitesCache([{ id: 2 }]);
    s.setCentresCache([{ id: 3 }]);
    s.setQualiteCache({ q: 1 });
    s.setRetraitsCache({ r: 1 }, [1]);
    s.setCentreDashboardCache({ stats: { c: 1 } });
    const a = useCacheStore.getState();
    expect(a.agentsCache).toEqual({ list: [{ id: 1 }], cachedAt: expect.any(Number) });
    expect(a.sitesCache).toEqual({ list: [{ id: 2 }], cachedAt: expect.any(Number) });
    expect(a.centresCache).toEqual({ list: [{ id: 3 }], cachedAt: expect.any(Number) });
    expect(a.qualiteCache).toEqual({ stats: { q: 1 }, cachedAt: expect.any(Number) });
    expect(a.retraitsCache).toEqual({ data: { r: 1 }, trend: [1], cachedAt: expect.any(Number) });
    expect(a.centreDashboardCache.stats).toEqual({ c: 1 });
    expect(a.centreDashboardCache.cachedAt).toEqual(expect.any(Number));
  });

  it('scénario A -> B -> A : le cache de B n\'est jamais restauré pour A (un seul instantané)', () => {
    const keyA = computeDashboardScopeKey({ role: 'SUPER ADMIN', activeSiteId: 1 });
    const keyB = computeDashboardScopeKey({ role: 'SUPER ADMIN', activeSiteId: 2 });
    const s = useCacheStore.getState();
    s.setDashboardCache({ stats: { total: 23 }, scopeKey: keyA });
    expect(shouldRestoreCache(useCacheStore.getState().dashboardCache, keyB)).toBe(false); // ouverture de B
    s.setDashboardCache({ stats: { total: 40 }, scopeKey: keyB });
    expect(shouldRestoreCache(useCacheStore.getState().dashboardCache, keyA)).toBe(false); // retour sur A
    expect(shouldRestoreCache(useCacheStore.getState().dashboardCache, keyB)).toBe(true);
  });
});
