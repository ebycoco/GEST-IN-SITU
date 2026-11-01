import { describe, it, expect } from 'vitest';
import { extractLockoutMessage } from '../src/renderer/src/utils/lockoutMessage';

describe('extractLockoutMessage', () => {
  const FALLBACK = 'Trop de tentatives de confirmation échouées. Réessayez dans quelques minutes.';

  it("extrait le message utile d'un verrou brut", () => {
    const e = new Error('TROP_DE_TENTATIVES: Trop de tentatives de confirmation échouées. Réessayez dans 3 minute(s).');
    expect(extractLockoutMessage(e)).toBe('Trop de tentatives de confirmation échouées. Réessayez dans 3 minute(s).');
  });

  it("retire le préfixe d'invocation Electron", () => {
    const e = new Error("Error invoking remote method 'hierarchy:verifyPassword': Error: TROP_DE_TENTATIVES: Réessayez dans 1 minute(s).");
    expect(extractLockoutMessage(e)).toBe('Réessayez dans 1 minute(s).');
  });

  it('utilise le repli quand le détail est vide', () => {
    expect(extractLockoutMessage(new Error('TROP_DE_TENTATIVES:'))).toBe(FALLBACK);
    expect(extractLockoutMessage(new Error('TROP_DE_TENTATIVES:   '))).toBe(FALLBACK);
  });

  it('renvoie null pour une autre erreur', () => {
    expect(extractLockoutMessage(new Error('Network down'))).toBeNull();
  });

  it('gère string, objet avec message, et valeurs sans message', () => {
    expect(extractLockoutMessage('TROP_DE_TENTATIVES: ok')).toBe('ok');
    expect(extractLockoutMessage({ message: 'TROP_DE_TENTATIVES: obj' })).toBe('obj');
    expect(extractLockoutMessage({})).toBeNull();
    expect(extractLockoutMessage({ message: 42 })).toBeNull();
    expect(extractLockoutMessage(null)).toBeNull();
    expect(extractLockoutMessage(undefined)).toBeNull();
    expect(extractLockoutMessage('autre')).toBeNull();
  });
});
