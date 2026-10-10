import { describe, it, expect } from 'vitest';
import { formatNumSecu } from '../src/shared/utils/numSecu';

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
