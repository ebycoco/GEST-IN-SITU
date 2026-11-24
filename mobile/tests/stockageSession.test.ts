import { describe, expect, it } from 'vitest';
import {
  CLE_ACTIVITE,
  CLE_AUTH,
  CLE_LOGIN,
  adaptateurAuth,
  ecrireActivite,
  effacerStockage,
  lireActivite,
  sessionPresente,
} from '../src/lib/stockageSession';
import { fauxMagasin } from './fauxMagasin';

describe('adaptateur auth (sessionStorage)', () => {
  it('ecrit et relit dans le magasin de l\'onglet', () => {
    const m = fauxMagasin();
    const a = adaptateurAuth(() => m);
    a.setItem(CLE_AUTH, '{"x":1}');
    expect(m.getItem(CLE_AUTH)).toBe('{"x":1}');
    expect(a.getItem(CLE_AUTH)).toBe('{"x":1}');
    a.removeItem(CLE_AUTH);
    expect(m.getItem(CLE_AUTH)).toBeNull();
  });
  it('sans stockage utilisable : repli memoire, aucune exception', () => {
    const a = adaptateurAuth(() => null);
    a.setItem('k', 'v');
    expect(a.getItem('k')).toBe('v');
    a.removeItem('k');
    expect(a.getItem('k')).toBeNull();
  });
  it('stockage qui leve (quota, acces refuse) : repli memoire', () => {
    const casse = () => {
      throw new Error('SecurityError');
    };
    const a = adaptateurAuth(casse);
    expect(() => a.setItem('k', 'v')).not.toThrow();
    expect(a.getItem('k')).toBe('v');
  });
});

describe('effacerStockage / activite', () => {
  it('efface toutes les cles gis-mobile-* (y compris annexes auth-js) et rien d\'autre', () => {
    const m = fauxMagasin();
    m.setItem(CLE_AUTH, 'jeton');
    m.setItem(`${CLE_AUTH}-code-verifier`, 'x');
    m.setItem(CLE_ACTIVITE, '123');
    m.setItem(CLE_LOGIN, 'agent');
    m.setItem('autre-appli', 'garde');
    effacerStockage(m);
    expect(m.dump()).toEqual({ 'autre-appli': 'garde' });
    expect(sessionPresente(m)).toBe(false);
  });
  it('lireActivite : valeur valide, absente, illisible', () => {
    const m = fauxMagasin();
    expect(lireActivite(m)).toBeNull();
    ecrireActivite(1_700_000_000_000, m);
    expect(lireActivite(m)).toBe(1_700_000_000_000);
    m.setItem(CLE_ACTIVITE, 'abc');
    expect(lireActivite(m)).toBeNull();
    m.setItem(CLE_ACTIVITE, '-5');
    expect(lireActivite(m)).toBeNull();
  });
});
