import { describe, expect, it } from 'vitest';
// Lecture de la migration elle-meme (?raw de Vite) : le test echoue si 0020 gagne un code
// que l'ecran ne sait pas afficher.
import sql from '../../supabase/migrations/0020_fonctions_mobile_verification.sql?raw';
import { CODES_RETRAIT, issueGisLogin, messageConnexion, messageRetrait, refusCorrigeable } from '../src/lib/codes';

describe('codes de retour de fn_mobile_delivrer_carte', () => {
  it('chaque code a un texte propre (pas le texte « inattendu »)', () => {
    const inconnu = messageRetrait('CODE_QUI_N_EXISTE_PAS');
    for (const c of CODES_RETRAIT) {
      expect(messageRetrait(c).titre, c).not.toBe(inconnu.titre);
    }
  });

  it('couvre TOUS les codes presents dans la migration 0020', () => {
    const codes = new Set<string>();
    for (const m of sql.matchAll(/'code',\s*'([A-Z_]+)'/g)) codes.add(m[1] as string);
    expect(codes.size).toBeGreaterThan(5);
    for (const c of codes) expect(CODES_RETRAIT as readonly string[], c).toContain(c);
  });

  it('textes repris des maquettes 6b bis', () => {
    expect(messageRetrait('DEJA_DELIVREE').titre).toBe('Carte déjà délivrée');
    expect(messageRetrait('HORS_CENTRE').titre).toBe('Carte d\'un autre centre');
    expect(messageRetrait('RANGEMENT_REQUIS').variante).toBe('warn');
    expect(messageRetrait('COMPTE_INACTIF').texte).toContain('déconnecté');
  });

  it('seuls les refus corrigeables proposent de revenir au formulaire', () => {
    expect(refusCorrigeable('RANGEMENT_REQUIS')).toBe(true);
    expect(refusCorrigeable('PARAMETRES_INVALIDES')).toBe(true);
    expect(refusCorrigeable('DEJA_DELIVREE')).toBe(false);
    expect(refusCorrigeable('DOUBLON')).toBe(false);
  });
});

describe('reponses de gis-login', () => {
  it('succes : token_hash et type', () => {
    expect(issueGisLogin(200, { ok: true, token_hash: 'h', type: 'magiclink' }, null)).toEqual({ kind: 'ok', tokenHash: 'h', otpType: 'magiclink' });
    expect(issueGisLogin(200, { ok: true }, null).kind).toBe('service');
  });
  it('401 / 400 : identifiants (message volontairement non precis)', () => {
    expect(issueGisLogin(401, { ok: false, error: 'invalid_credentials' }, null).kind).toBe('invalid');
    expect(issueGisLogin(400, { ok: false, error: 'bad_request' }, null).kind).toBe('invalid');
    expect(messageConnexion({ kind: 'invalid' })?.texte).toBe('Identifiant ou mot de passe incorrect');
  });
  it('429 : duree renvoyee par le serveur, arrondie a la minute superieure', () => {
    expect(issueGisLogin(429, { retry_after: 300 }, '300')).toEqual({ kind: 'blocked', minutes: 5 });
    expect(issueGisLogin(429, { retry_after: 61 }, null)).toEqual({ kind: 'blocked', minutes: 2 });
    expect(issueGisLogin(429, {}, '900')).toEqual({ kind: 'blocked', minutes: 15 });
    expect(issueGisLogin(429, null, null)).toEqual({ kind: 'blocked', minutes: 1 });
    expect(messageConnexion({ kind: 'blocked', minutes: 5 })?.texte).toContain('Réessayez dans 5 min.');
  });
  it('403 : site suspendu, licence expiree, sans site', () => {
    expect(issueGisLogin(403, { error: 'site_suspended' }, null).kind).toBe('suspended');
    expect(issueGisLogin(403, { error: 'licence_expired' }, null).kind).toBe('licence');
    expect(issueGisLogin(403, { error: 'no_site' }, null).kind).toBe('no_site');
    expect(messageConnexion({ kind: 'suspended' })?.titre).toBe('Accès suspendu');
    expect(messageConnexion({ kind: 'licence' })?.titre).toBe('Licence expirée');
  });
  it('503 et inconnu : service indisponible', () => {
    expect(issueGisLogin(503, { error: 'service_unavailable' }, null).kind).toBe('service');
    expect(issueGisLogin(500, 'x', null).kind).toBe('service');
  });
  it('hors ligne et role', () => {
    expect(messageConnexion({ kind: 'offline' })?.titre).toBe('Hors-ligne');
    expect(messageConnexion({ kind: 'role' })?.titre).toBe('Accès réservé');
  });
});
