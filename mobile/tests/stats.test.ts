import { describe, expect, it } from 'vitest';
import { formatHeureAbidjan, parseStats } from '../src/lib/stats';

const LIGNE = {
  date_delivrance: '2026-11-25T09:46:00+00:00',
  noms: 'KOFFI',
  prenoms: 'AYA',
  date_de_naissance: '1990-03-04',
  lieu_de_naissance: 'ABOBO',
  num_secu: '3840000000000',
  rangement: 'A12',
  nom_retirant: 'KOFFI AYA',
  relation_retirant: 'ASSURE',
  num_retirant: '0700000000',
};

const OK = {
  code: 'OK',
  site_nom: 'SITE TEST',
  centre_nom: 'CENTRE TEST',
  aujourd_hui: 1,
  semaine: 5,
  mois: 20,
  annee: 300,
  retraits_jour: [LIGNE],
};

describe('parseStats (fn_mobile_mes_stats)', () => {
  it('reponse complete', () => {
    const s = parseStats(OK);
    expect(s).toMatchObject({ code: 'OK', siteNom: 'SITE TEST', centreNom: 'CENTRE TEST', aujourdhui: 1, semaine: 5, mois: 20, annee: 300 });
    expect(s.retraits).toEqual([
      {
        dateDelivrance: LIGNE.date_delivrance,
        noms: 'KOFFI',
        prenoms: 'AYA',
        dateNaissance: '1990-03-04',
        lieuNaissance: 'ABOBO',
        numSecu: '3840000000000',
        rangement: 'A12',
        nomRetirant: 'KOFFI AYA',
        relationRetirant: 'ASSURE',
        numRetirant: '0700000000',
      },
    ]);
  });
  it('champs null ou de mauvais type -> null / chaine vide ; elements non objets ecartes', () => {
    const s = parseStats({ ...OK, site_nom: null, centre_nom: 12, retraits_jour: [null, 'x', [], { noms: 4, num_secu: 123 }] });
    expect(s.siteNom).toBeNull();
    expect(s.centreNom).toBeNull();
    expect(s.retraits).toHaveLength(1);
    expect(s.retraits[0]).toMatchObject({ noms: '', prenoms: '', numSecu: null, dateDelivrance: null });
  });
  it('retraits_jour absent -> liste vide', () => {
    expect(parseStats({ ...OK, retraits_jour: null }).retraits).toEqual([]);
  });
  it('COMPTE_INACTIF rendu tel quel, sans donnees', () => {
    expect(parseStats({ code: 'COMPTE_INACTIF' })).toMatchObject({ code: 'COMPTE_INACTIF', siteNom: null, retraits: [] });
  });
  it('corps inattendu ou sans code -> REPONSE_ILLISIBLE', () => {
    for (const x of [null, undefined, 'OK', 42, [], {}, { code: 1 }]) {
      expect(parseStats(x).code).toBe('REPONSE_ILLISIBLE');
    }
  });
  it('code OK mais compteur manquant ou invalide -> REPONSE_ILLISIBLE (jamais de faux 0)', () => {
    expect(parseStats({ ...OK, semaine: undefined }).code).toBe('REPONSE_ILLISIBLE');
    expect(parseStats({ ...OK, mois: '20' }).code).toBe('REPONSE_ILLISIBLE');
    expect(parseStats({ ...OK, annee: -1 }).code).toBe('REPONSE_ILLISIBLE');
    expect(parseStats({ ...OK, aujourd_hui: Number.NaN }).code).toBe('REPONSE_ILLISIBLE');
  });
});

describe('formatHeureAbidjan', () => {
  it('heure en fuseau Africa/Abidjan (UTC+0), quel que soit le decalage recu', () => {
    expect(formatHeureAbidjan('2026-11-25T09:46:00Z')).toBe('09:46');
    expect(formatHeureAbidjan('2026-11-25T10:46:00+01:00')).toBe('09:46');
  });
  it('absente ou illisible -> tiret', () => {
    expect(formatHeureAbidjan(null)).toBe('—');
    expect(formatHeureAbidjan('')).toBe('—');
    expect(formatHeureAbidjan('pas une date')).toBe('—');
  });
});
