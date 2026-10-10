import { describe, it, expect } from 'vitest';
import {
  formatNumSecu,
  isScientificNumSecu,
  getNumSecuEditDefault,
  shouldSendNumSecu,
  resolveNumSecuToSendWhenAbsent,
} from '../src/shared/utils/numSecu';

describe('formatNumSecu', () => {
  it.each([
    ['3,84E+12', '3840000000000'],
    ['3.84E+12', '3840000000000'],
    ['1,2346E+12', '1234600000000'],
    ['3,84e+12', '3840000000000'],
    ['3,84E12', '3840000000000'],
    ['  3,84E+12  ', '3840000000000'],
    ['1,234567890123E+12', '1234567890123'],
  ])('convertit %s en %s', (input, expected) => {
    expect(formatNumSecu(input)).toBe(expected);
  });

  it.each([
    ['3840000000000'],
    ['1234567890123'],
    ['12345678901234'], // 14 chiffres
    ['-'],
    ['-1234'],
    ['abc'],
    ['3,84E+11'], // 12 chiffres
    ['3,845E+2'], // fractionnaire
    ['3,84E+99'], // exposant non plausible
    ['3,84E+13'], // 14 chiffres
    ['0,384E+12'], // mantisse à zéro : jamais « 0384000000000 »
    ['0384E+10'],
  ])('laisse %s inchangé', (input) => {
    expect(formatNumSecu(input)).toBe(input);
  });

  it('renvoie une chaîne vide pour null/undefined/vide', () => {
    expect(formatNumSecu(null)).toBe('');
    expect(formatNumSecu(undefined)).toBe('');
    expect(formatNumSecu('')).toBe('');
  });

  it('ne produit jamais de notation scientifique dans la cellule CSV garantie ="…"', () => {
    const raw = formatNumSecu('3,84E+12');
    const cell = `="${raw}"`;
    expect(cell).toBe('="3840000000000"');
    expect(cell).not.toMatch(/E\+/i);
    // Le garde ="…" est neutralisé à l'import : il reste 13 chiffres valides.
    expect(cell.replace(/^="(.*)"$/, '$1')).toMatch(/^\d{13}$/);
  });
});

describe('formatNumSecu - typage défensif', () => {
  it('ne lève pas sur une valeur non-chaîne', () => {
    expect(formatNumSecu(3840000000000 as unknown as string)).toBe('3840000000000');
  });
});

describe('isScientificNumSecu', () => {
  it.each(['3,84E+12', '3.84e12', ' 3,84E+12 ', '0,384E+12', '3,845E+2', '3,84E+99'])('vrai pour %s', (v) => {
    expect(isScientificNumSecu(v)).toBe(true);
  });
  it.each(['3840000000000', '1234567890123', '', '-', 'abc', 'E+12'])('faux pour %s', (v) => {
    expect(isScientificNumSecu(v)).toBe(false);
  });
  it('faux pour null/undefined', () => {
    expect(isScientificNumSecu(null)).toBe(false);
    expect(isScientificNumSecu(undefined)).toBe(false);
  });
});

describe('getNumSecuEditDefault', () => {
  it('vide pour une valeur scientifique (convertible ou non)', () => {
    expect(getNumSecuEditDefault('3,84E+12')).toBe('');
    expect(getNumSecuEditDefault('0,384E+12')).toBe('');
  });
  it('valeur brute sinon', () => {
    expect(getNumSecuEditDefault('1234567890123')).toBe('1234567890123');
    expect(getNumSecuEditDefault('-')).toBe('-');
    expect(getNumSecuEditDefault('')).toBe('');
    expect(getNumSecuEditDefault(null)).toBe('');
    expect(getNumSecuEditDefault(undefined)).toBe('');
  });
});

describe('shouldSendNumSecu', () => {
  it("n'envoie pas une valeur inchangée", () => {
    expect(shouldSendNumSecu('', '')).toBe(false);
    expect(shouldSendNumSecu('1234567890123', '1234567890123')).toBe(false);
    expect(shouldSendNumSecu(undefined, '')).toBe(false);
    expect(shouldSendNumSecu(' 123 ', '123')).toBe(false);
  });
  it('envoie une valeur modifiée', () => {
    expect(shouldSendNumSecu('1234567890123', '')).toBe(true);
    expect(shouldSendNumSecu('', '1234567890123')).toBe(true);
    expect(shouldSendNumSecu('9999999999999', '3840000000000')).toBe(true);
  });
  it('scénario bug : fiche scientifique, champ laissé vide => rien à envoyer', () => {
    const initial = getNumSecuEditDefault('3,84E+12');
    expect(shouldSendNumSecu(initial, initial)).toBe(false);
  });
  it('scénario Saisie : prérempli converti inchangé => rien à envoyer', () => {
    const initial = formatNumSecu('3,84E+12');
    expect(shouldSendNumSecu(initial, initial)).toBe(false);
  });
});

describe('resolveNumSecuToSendWhenAbsent', () => {
  it('undefined si un n° est déjà stocké (input caché), même scientifique', () => {
    expect(resolveNumSecuToSendWhenAbsent('3,84E+12', '3840000000000')).toBeUndefined();
    expect(resolveNumSecuToSendWhenAbsent('1234567890123', '1234567890123')).toBeUndefined();
  });
  it('undefined si input vide', () => {
    expect(resolveNumSecuToSendWhenAbsent('', '  ')).toBeUndefined();
    expect(resolveNumSecuToSendWhenAbsent(null, '')).toBeUndefined();
  });
  it('valeur trimée si fiche sans n° et input rempli', () => {
    expect(resolveNumSecuToSendWhenAbsent('', ' 1234567890123 ')).toBe('1234567890123');
    expect(resolveNumSecuToSendWhenAbsent(undefined, '1234567890123')).toBe('1234567890123');
  });
});

