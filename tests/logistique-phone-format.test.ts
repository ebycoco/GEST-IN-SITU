import { describe, it, expect } from 'vitest';
import {
  formatPhoneInput,
  extractLocalDigits,
  resolveContactToSend,
  cleanIpcErrorMessage,
  applyPhoneChange,
  formatContactForDisplay,
  isOverlongContact
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

  it('applyPhoneChange : formes valides inchangées (frappe et collage)', () => {
    const forms = ['0708090010', '07 08 09 00 10', '+225 07 08 09 00 10', '+2250708090010', '2250708090010', '07-08.09/00 10', '07a08b09c00d10'];
    for (const f of forms) {
      expect(applyPhoneChange('', f)).toEqual({ value: '+225 07 08 09 00 10', tooLong: false });
    }
  });

  it('applyPhoneChange : collage 11/12/13 chiffres refusé, champ non modifié, jamais raccourci', () => {
    for (const pasted of ['07080900101', '070809001012', '1230708090010']) {
      expect(applyPhoneChange('', pasted)).toEqual({ value: '', tooLong: true });
      expect(applyPhoneChange('+225 07 0', pasted)).toEqual({ value: '+225 07 0', tooLong: true });
    }
  });

  it('applyPhoneChange : le 11e chiffre tapé est ignoré sans toast', () => {
    expect(applyPhoneChange('+225 07 08 09 00 10', '+225 07 08 09 00 101')).toEqual({ value: '+225 07 08 09 00 10', tooLong: false });
  });

  it('applyPhoneChange : suppression sur un historique > 10 chiffres reste possible', () => {
    expect(applyPhoneChange('07080900101', '0708090010')).toEqual({ value: '+225 07 08 09 00 10', tooLong: false });
    expect(applyPhoneChange('070809001012', '07080900101')).toEqual({ value: '07080900101', tooLong: false });
  });

  it('historique > 10 chiffres : affiché tel quel, signalé, non tronqué ; court préformaté', () => {
    expect(formatContactForDisplay('07080900101')).toBe('07080900101');
    expect(isOverlongContact('07080900101')).toBe(true);
    expect(isOverlongContact('+225 07 08 09 00 10')).toBe(false);
    expect(formatContactForDisplay('12345')).toBe('+225 12 34 5');
    expect(formatContactForDisplay('2250708090010')).toBe('+225 07 08 09 00 10');
    expect(formatContactForDisplay(null)).toBe('');
  });

  it('resolveContactToSend : historique > 10 chiffres inchangé => rien ; modifié => jamais tronqué', () => {
    expect(resolveContactToSend('07080900101', '07080900101')).toEqual({});
    expect(resolveContactToSend('07080900101', '')).toEqual({ error: 'Le contact doit comporter exactement 10 chiffres.' });
    expect(resolveContactToSend('070809001012', null)).toEqual({ error: 'Le contact doit comporter exactement 10 chiffres.' });
    expect(resolveContactToSend('1230708090010', null)).toEqual({ error: 'Le contact doit comporter exactement 10 chiffres.' });
    expect(resolveContactToSend('22507080900', null)).toEqual({ error: 'Le contact doit comporter exactement 10 chiffres.' });
    expect(resolveContactToSend('0708090010', '07080900101')).toEqual({ contact: '0708090010' });
  });

  it('cleanIpcErrorMessage retire le préfixe Electron', () => {
    expect(cleanIpcErrorMessage(new Error("Error invoking remote method 'cartes:updateRangementEtFiche': Error: Le contact doit faire exactement 10 chiffres locaux.")))
      .toBe('Le contact doit faire exactement 10 chiffres locaux.');
    expect(cleanIpcErrorMessage(new Error('Autre'))).toBe('Autre');
  });
});
