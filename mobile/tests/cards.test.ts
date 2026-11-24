import { describe, expect, it } from 'vitest';
import { badgeFor, estBloquee, etatFiche, parseRecherche, rangementUrgenceValide, type Carte } from '../src/lib/cards';
import { classerErreur, parseRetrait } from '../src/lib/api';
import { formRetraitValide, utiliseNumeroFiche, type FormRetrait } from '../src/screens/Retrait';
import { criteresDe } from '../src/screens/Recherche';

const carte = (o: Partial<Carte> = {}): Carte => ({
  sync_id: 's1', noms: 'KOUASSI', prenoms: 'AYA', date_naissance: '1992-03-14', lieu_naissance: 'BOUAKE',
  rangement: 'B12-C3-P07', non_classee: false, statut: 'EN STOCK', statut_physique: null, id_centre: 4,
  centre_nom: 'Centre Nord', meme_centre: true, contact_masque: '********45', date_delivrance: null,
  centre_retrait: null, nom_retirant: null, tel_retirant_masque: null, ...o,
});

describe('reponse de fn_mobile_rechercher_cartes', () => {
  it('lecture defensive, jamais plus de 10 lignes, jamais de num_secu', () => {
    const lignes = Array.from({ length: 12 }, (_, i) => ({ sync_id: `s${i}`, noms: 'A', num_secu: 'SECRET' }));
    const r = parseRecherche({ code: 'OK', mode: 'NOM', inversion: true, tronque: true, resultats: lignes });
    expect(r.resultats).toHaveLength(10);
    expect(r.inversion).toBe(true);
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(parseRecherche(null).code).toBe('REPONSE_ILLISIBLE');
    expect(parseRecherche({ code: 'COMPTE_INACTIF' }).resultats).toEqual([]);
  });
});

describe('badges et etat de la fiche', () => {
  it('symbole + mot', () => {
    expect(badgeFor({ statut: 'EN STOCK', statut_physique: null }).texte).toBe('✓ EN STOCK');
    expect(badgeFor({ statut: 'DELIVRE', statut_physique: null }).texte).toBe('● DÉLIVRÉE');
    expect(badgeFor({ statut: 'DOUBLON', statut_physique: null }).texte).toBe('⛔ DOUBLON');
    expect(badgeFor({ statut: 'EN STOCK', statut_physique: 'ABSENT' }).texte).toBe('⚠ ABSENTE');
    expect(badgeFor({ statut: 'EN STOCK', statut_physique: 'PERDUE' }).texte).toBe('✕ PERDUE');
    expect(badgeFor({ statut: 'ANNULE', statut_physique: null }).texte).toBe('? ANNULE');
  });
  it('etats', () => {
    expect(etatFiche(carte())).toBe('DELIVRABLE');
    expect(etatFiche(carte({ statut: 'DELIVRE' }))).toBe('DELIVREE');
    expect(etatFiche(carte({ statut: 'DOUBLON' }))).toBe('DOUBLON');
    expect(etatFiche(carte({ statut_physique: 'ABSENT' }))).toBe('ABSENTE');
    expect(etatFiche(carte({ statut_physique: 'PERDUE' }))).toBe('PERDUE');
    expect(etatFiche(carte({ meme_centre: false }))).toBe('HORS_CENTRE');
    expect(etatFiche(carte({ meme_centre: false, non_classee: true, rangement: null }))).toBe('DELIVRABLE');
    expect(etatFiche(carte({ statut: 'EN COURS' }))).toBe('NON_DELIVRABLE');
    expect(estBloquee(carte({ statut: 'DOUBLON' }))).toBe(true);
    expect(estBloquee(carte({ statut: 'DELIVRE' }))).toBe(false);
  });
  it('rangement d\'urgence : meme regle que le serveur', () => {
    expect(rangementUrgenceValide('c1-b4-p3')).toBe(true);
    expect(rangementUrgenceValide('  ')).toBe(false);
    expect(rangementUrgenceValide('non classe')).toBe(false);
    expect(rangementUrgenceValide('x'.repeat(61))).toBe(false);
  });
});

describe('formulaire de retrait', () => {
  const f = (o: Partial<FormRetrait> = {}): FormRetrait => ({ type: 'ASSURE', nom: 'KOUASSI AYA', tel: '', autreNumero: false, rangement: '', ...o });
  it('assure avec le numero de la fiche : telephone vide accepte', () => {
    expect(utiliseNumeroFiche(carte(), f())).toBe(true);
    expect(formRetraitValide(carte(), f())).toBe(true);
  });
  it('assure sans numero sur la fiche : 10 chiffres exiges', () => {
    const c = carte({ contact_masque: null });
    expect(formRetraitValide(c, f())).toBe(false);
    expect(formRetraitValide(c, f({ tel: '0700000000' }))).toBe(true);
  });
  it('tiers : nom + 10 chiffres', () => {
    expect(formRetraitValide(carte(), f({ type: 'TIERS', nom: 'YAO', tel: '070000000' }))).toBe(false);
    expect(formRetraitValide(carte(), f({ type: 'TIERS', nom: '', tel: '0700000000' }))).toBe(false);
    expect(formRetraitValide(carte(), f({ type: 'TIERS', nom: 'YAO', tel: '0700000000' }))).toBe(true);
  });
  it('carte non classee : rangement d\'urgence obligatoire', () => {
    const c = carte({ non_classee: true, rangement: null });
    expect(formRetraitValide(c, f())).toBe(false);
    expect(formRetraitValide(c, f({ rangement: 'C1-B4-P3' }))).toBe(true);
  });
});

describe('criteres de recherche', () => {
  it('nom + date valide, ou 10 chiffres', () => {
    expect(criteresDe({ onglet: 'NOM', nom: ' kouassi  aya', ddn: '14/03/1992', tel: '' })).toEqual({ mode: 'NOM', nom: 'KOUASSI AYA', ddnIso: '1992-03-14', ddnAffiche: '14/03/1992', tel: '' });
    expect(criteresDe({ onglet: 'NOM', nom: 'KOUASSI', ddn: '31/02/1992', tel: '' })).toBeNull();
    expect(criteresDe({ onglet: 'NOM', nom: '', ddn: '14/03/1992', tel: '' })).toBeNull();
    expect(criteresDe({ onglet: 'TEL', nom: '', ddn: '', tel: '070000000' })).toBeNull();
    expect(criteresDe({ onglet: 'TEL', nom: '', ddn: '', tel: '0700000001' })?.tel).toBe('0700000001');
  });
});

describe('erreurs serveur', () => {
  it('classement', () => {
    expect(classerErreur(0, '')).toBe('reseau');
    expect(classerErreur(403, '42501', 'GIS mobile : role non autorise')).toBe('role');
    expect(classerErreur(400, '42501', 'GIS mobile : session invalide')).toBe('session');
    expect(classerErreur(401, 'PGRST303')).toBe('session');
    expect(classerErreur(400, '55P03')).toBe('occupee');
    expect(classerErreur(500, 'XX000')).toBe('serveur');
  });
  it('reponse du retrait', () => {
    expect(parseRetrait({ code: 'OK', reessai: true, date_delivrance: '2026-11-23T09:46:00Z' })).toEqual({ code: 'OK', reessai: true, dateDelivrance: '2026-11-23T09:46:00Z' });
    expect(parseRetrait(null).code).toBe('REPONSE_ILLISIBLE');
  });
});
