import { describe, it, expect } from 'vitest';
import { formatWelcomeName, buildWelcomeMessage } from '../src/renderer/src/pages/loginWelcome';

describe('formatWelcomeName', () => {
  it('nom présent -> nom (jamais le prénom)', () => {
    expect(formatWelcomeName({ nom_user: 'Yeo', prenom_user: 'Marie' })).toBe('Yeo');
  });
  it('nom vide/espaces/null/undefined + prénom -> prénom', () => {
    expect(formatWelcomeName({ nom_user: '', prenom_user: 'Marie' })).toBe('Marie');
    expect(formatWelcomeName({ nom_user: '   ', prenom_user: 'Marie' })).toBe('Marie');
    expect(formatWelcomeName({ nom_user: null, prenom_user: 'Marie' })).toBe('Marie');
    expect(formatWelcomeName({ prenom_user: 'Marie' })).toBe('Marie');
  });
  it('ni nom ni prénom -> chaîne vide', () => {
    expect(formatWelcomeName({ nom_user: ' ', prenom_user: '' })).toBe('');
    expect(formatWelcomeName({})).toBe('');
    expect(formatWelcomeName(null)).toBe('');
    expect(formatWelcomeName(undefined)).toBe('');
  });
  it('valeurs non-chaîne ignorées', () => {
    expect(formatWelcomeName({ nom_user: 42 as unknown as string, prenom_user: 'Awa' })).toBe('Awa');
  });
  it('trim et compression des espaces', () => {
    expect(formatWelcomeName({ nom_user: '  Kone   Kouadio ' })).toBe('Kone Kouadio');
  });
  it('tout en majuscules -> capitalisé', () => {
    expect(formatWelcomeName({ nom_user: 'YEO' })).toBe('Yeo');
    expect(formatWelcomeName({ nom_user: 'KONE KOUADIO' })).toBe('Kone Kouadio');
    expect(formatWelcomeName({ nom_user: '', prenom_user: 'AMINATA' })).toBe('Aminata');
    expect(formatWelcomeName({ nom_user: 'ÉLOI' })).toBe('Éloi');
  });
  it('casse mixte ou minuscule conservée', () => {
    expect(formatWelcomeName({ nom_user: 'Kouassi' })).toBe('Kouassi');
    expect(formatWelcomeName({ nom_user: 'McDonald' })).toBe('McDonald');
    expect(formatWelcomeName({ nom_user: 'yeo' })).toBe('yeo');
  });
  it('noms composés, tirets, apostrophes', () => {
    expect(formatWelcomeName({ nom_user: 'KOUASSI-YAO' })).toBe('Kouassi-Yao');
    expect(formatWelcomeName({ nom_user: "N'GUESSAN" })).toBe("N'Guessan");
    expect(formatWelcomeName({ nom_user: 'D’ALMEIDA' })).toBe('D’Almeida');
    expect(formatWelcomeName({ nom_user: 'Kouassi-Yao' })).toBe('Kouassi-Yao');
  });
  it('sans lettre (ex. chiffres) -> inchangé', () => {
    expect(formatWelcomeName({ nom_user: '123' })).toBe('123');
  });
});

describe('buildWelcomeMessage', () => {
  it('mono-rôle avec nom', () => {
    expect(buildWelcomeMessage({ nom_user: 'YEO', prenom_user: 'Marie' })).toBe('Bienvenue Yeo !');
  });
  it('mono-rôle avec repli prénom, jamais les deux', () => {
    const msg = buildWelcomeMessage({ nom_user: '  ', prenom_user: 'Marie' });
    expect(msg).toBe('Bienvenue Marie !');
    expect(buildWelcomeMessage({ nom_user: 'Yeo', prenom_user: 'Marie' })).not.toContain('Marie');
  });
  it('repli total', () => {
    expect(buildWelcomeMessage({})).toBe('Bienvenue !');
    expect(buildWelcomeMessage(null)).toBe('Bienvenue !');
    expect(buildWelcomeMessage(undefined, { multiRole: false })).toBe('Bienvenue !');
  });
  it('multi-rôles', () => {
    expect(buildWelcomeMessage({ nom_user: 'Yeo' }, { multiRole: true })).toBe(
      'Bienvenue Yeo ! Sélectionnez votre rôle pour cette session.'
    );
    expect(buildWelcomeMessage({}, { multiRole: true })).toBe(
      'Bienvenue ! Sélectionnez votre rôle pour cette session.'
    );
  });
  it('ne divulgue ni login ni rôle', () => {
    const user = { nom_user: 'Yeo', login: 'jyeo', role: 'SUPER ADMIN' } as { nom_user: string };
    const msg = buildWelcomeMessage(user);
    expect(msg).not.toContain('jyeo');
    expect(msg).not.toContain('SUPER');
  });
});
