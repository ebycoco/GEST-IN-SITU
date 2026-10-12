import { describe, it, expect } from 'vitest';
import { normalizeEmail, normalizePhone, validateEmail, validatePhone } from '../src/shared/utils/contact';

describe('contact — normalisation', () => {
  it.each([[undefined], [null], [''], ['   ']])('email %j => null', (v) => {
    expect(normalizeEmail(v)).toBeNull();
  });
  it('email trim', () => expect(normalizeEmail('  a@b.ci ')).toBe('a@b.ci'));
  it.each([[undefined], [null], [''], [' \t ']])('téléphone %j => null', (v) => {
    expect(normalizePhone(v)).toBeNull();
  });
  it('téléphone sans espaces', () => expect(normalizePhone(' +225 07 01 02 03 04 ')).toBe('+2250701020304'));
});

describe('contact — validation (règle ProfilePage)', () => {
  it('null accepté (facultatif)', () => {
    expect(validateEmail(null)).toBeNull();
    expect(validatePhone(null)).toBeNull();
  });
  it.each([['a@b.ci'], ['jean.dupont@exemple.com']])('email valide %s', (e) => expect(validateEmail(e)).toBeNull());
  it.each([['abc'], ['a@b'], ['a b@c.d'], ['@b.c'], ['a@@b.c']])('email invalide %s', (e) => {
    expect(validateEmail(e)).toMatch(/e-mail invalide/);
  });
  it('+225 avec 10 chiffres locaux valide', () => expect(validatePhone('+2250701020304')).toBeNull());
  it('+225 avec 9 ou 11 chiffres locaux invalide', () => {
    expect(validatePhone('+225070102030')).toMatch(/\+225/);
    expect(validatePhone('+22507010203045')).toMatch(/\+225/);
  });
  it('sans + invalide', () => expect(validatePhone('0701020304')).toMatch(/commencer par '\+'/));
  it('autre indicatif : >= 8 chiffres', () => {
    expect(validatePhone('+3312345678')).toBeNull();
    expect(validatePhone('+331234')).toMatch(/trop court/);
  });
});
