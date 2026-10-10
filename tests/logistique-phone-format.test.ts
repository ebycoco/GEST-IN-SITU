import { describe, it, expect } from 'vitest';
import {
  formatPhoneInput,
  extractLocalDigits,
  resolveContactToSend,
  cleanIpcErrorMessage
} from '../src/renderer/src/pages/inventaire/phoneFormat';

describe('phoneFormat (portail logistique)', () => {
  it('vide et « +225 » seul => vide', () => {
    expect(formatPhoneInput('')).toBe('');
    expect(formatPhoneInput('+225')).toBe('');
    expect(formatPhoneInput('+225 ')).toBe('');
  });

  it('formate dynamiquement par groupes de 2', () => {
    expect(formatPhoneInput('0')).toBe('+225 0');
    expect(formatPhoneInput('+225 0')).toBe('+225 0');
    expect(formatPhoneInput('+225 07 0')).toBe('+225 07 0');
    expect(formatPhoneInput('0708090010')).toBe('+225 07 08 09 00 10');
  });

  it('collage sans préfixe, avec préfixe, et 13 chiffres', () => {
    expect(formatPhoneInput('0708090010')).toBe('+225 07 08 09 00 10');
    expect(formatPhoneInput('+2250708090010')).toBe('+225 07 08 09 00 10');
    expect(formatPhoneInput('2250708090010')).toBe('+225 07 08 09 00 10');
  });

  it('ne coupe jamais un numéro local de 10 chiffres commençant par 225', () => {
    expect(extractLocalDigits('2251234567')).toBe('2251234567');
    expect(extractLocalDigits('+225 22 51 23 45 67')).toBe('2251234567');
  });

  it('tronque à 10 chiffres', () => {
    expect(extractLocalDigits('+225 07 08 09 00 10 11')).toBe('0708090010');
  });

  it('resolveContactToSend : vide, inchangé, invalide, valide', () => {
    expect(resolveContactToSend('', '0700000001')).toEqual({});
    expect(resolveContactToSend('+225 07 00 00 00 01', '0700000001')).toEqual({});
    expect(resolveContactToSend('+225 07 08', null)).toEqual({ error: 'Le contact doit comporter exactement 10 chiffres.' });
    expect(resolveContactToSend('+225 07 08 09 00 10', '')).toEqual({ contact: '0708090010' });
    // Valeur historique non conforme inchangée : ne bloque pas.
    expect(resolveContactToSend(formatPhoneInput('07123'), '07123')).toEqual({});
  });

  it('cleanIpcErrorMessage retire le préfixe Electron', () => {
    expect(cleanIpcErrorMessage(new Error("Error invoking remote method 'cartes:updateRangementEtFiche': Error: Le contact doit faire exactement 10 chiffres locaux.")))
      .toBe('Le contact doit faire exactement 10 chiffres locaux.');
    expect(cleanIpcErrorMessage(new Error('Autre'))).toBe('Autre');
  });
});
