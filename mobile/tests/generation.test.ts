import { describe, expect, it } from 'vitest';
import { Generation } from '../src/lib/generation';

describe('compteur de generation : reponses tardives ignorees', () => {
  it('ticket valide tant que rien ne change', () => {
    const g = new Generation();
    const t = g.ticket();
    expect(t()).toBe(true);
    expect(t()).toBe(true);
  });
  it('bump (deconnexion / verrou / effacement) invalide les tickets en attente', () => {
    const g = new Generation();
    const t = g.ticket();
    g.bump();
    expect(t()).toBe(false);
  });
  it('un ticket pris apres le bump reste valide', () => {
    const g = new Generation();
    const avant = g.ticket();
    g.bump();
    const apres = g.ticket();
    expect(avant()).toBe(false);
    expect(apres()).toBe(true);
    expect(g.current).toBe(1);
  });
  it('plusieurs bumps : seul le dernier ticket compte', () => {
    const g = new Generation();
    g.bump();
    const t = g.ticket();
    g.bump();
    g.bump();
    expect(t()).toBe(false);
    expect(g.current).toBe(3);
  });
});
