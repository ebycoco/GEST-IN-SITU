import { describe, expect, it } from 'vitest';
import {
  formatDateInput,
  formatDateTime,
  formatIsoDate,
  formatMaskedContact,
  formatPhoneFull,
  formatPhoneInput,
  normalizeName,
  parseDdn,
  phoneDigits,
} from '../src/lib/masks';

describe('masque date JJ/MM/AAAA', () => {
  it('ajoute les « / » au fil de la frappe', () => {
    expect(formatDateInput('1')).toBe('1');
    expect(formatDateInput('14')).toBe('14');
    expect(formatDateInput('140')).toBe('14/0');
    expect(formatDateInput('1403')).toBe('14/03');
    expect(formatDateInput('140319')).toBe('14/03/19');
    expect(formatDateInput('14031992')).toBe('14/03/1992');
  });
  it('ignore lettres et chiffres en trop, accepte une saisie deja masquee', () => {
    expect(formatDateInput('14/03/1992999')).toBe('14/03/1992');
    expect(formatDateInput('a1b4')).toBe('14');
  });
  it('effacement : jamais de « / » final bloquant', () => {
    expect(formatDateInput('14/0')).toBe('14/0');
    expect(formatDateInput('14/')).toBe('14');
  });
  it('convertit en AAAA-MM-JJ et refuse les dates impossibles', () => {
    const today = new Date(2026, 10, 24);
    expect(parseDdn('14/03/1992', today)).toBe('1992-03-14');
    expect(parseDdn('29/02/2000', today)).toBe('2000-02-29');
    expect(parseDdn('29/02/2001', today)).toBeNull();
    expect(parseDdn('31/04/1990', today)).toBeNull();
    expect(parseDdn('00/01/1990', today)).toBeNull();
    expect(parseDdn('01/13/1990', today)).toBeNull();
    expect(parseDdn('01/01/1899', today)).toBeNull();
    expect(parseDdn('25/11/2026', today)).toBeNull();
    expect(parseDdn('24/11/2026', today)).toBe('2026-11-24');
    expect(parseDdn('14/03/19', today)).toBeNull();
  });
});

describe('masque telephone (10 chiffres, +225)', () => {
  it('groupe par 2 sans espace final', () => {
    expect(formatPhoneInput('0700000')).toBe('07 00 00 0');
    expect(formatPhoneInput('07000000')).toBe('07 00 00 00');
    expect(formatPhoneInput('0500000018')).toBe('05 00 00 00 18');
  });
  it('limite a 10 chiffres et retire l\'indicatif colle', () => {
    expect(phoneDigits('05 00 00 00 18 99')).toBe('0500000018');
    expect(phoneDigits('+225 05 00 00 00 18')).toBe('0500000018');
    expect(phoneDigits('00225 0500000018')).toBe('0500000018');
    expect(phoneDigits('225')).toBe('225');
  });
  it('numero complet saisi par l\'agent', () => {
    expect(formatPhoneFull('0500000018')).toBe('+225 05 00 00 00 18');
  });
  it('contact masque par le serveur : seuls les 2 derniers chiffres', () => {
    expect(formatMaskedContact('********45')).toBe('+225 •• •• •• •• 45');
    expect(formatMaskedContact(null)).toBeNull();
    expect(formatMaskedContact('')).toBeNull();
    expect(formatMaskedContact('*')).toBeNull();
  });
});

describe('mises en forme', () => {
  it('dates du serveur', () => {
    expect(formatIsoDate('1992-03-14')).toBe('14/03/1992');
    expect(formatIsoDate('1992-03-14T00:00:00')).toBe('14/03/1992');
    expect(formatIsoDate('14/03/1992')).toBe('14/03/1992');
    expect(formatIsoDate(null)).toBe('');
    const local = new Date(2026, 10, 23, 9, 46).toISOString();
    expect(formatDateTime(local)).toBe('23/11/2026 à 09:46');
    expect(formatDateTime('n/a')).toBe('n/a');
  });
  it('nom normalise comme le serveur', () => {
    expect(normalizeName('  kouassi   aya ')).toBe('KOUASSI AYA');
  });
});
