import { describe, it, expect } from 'vitest';
import { classifyImportOutcome, isSupportedImportFile } from '../src/main/import/import-outcome';
import { detectSeparator, parseCsvLine } from '../src/main/import/csv-line-parser';

/**
 * P1-C (audit Phase 1 du 27/09/2026) — import : plus de faux succès, refus explicite des
 * fichiers Excel, découpage CSV conforme (parseur prêt, branchement soumis à validation).
 * Fonctions pures : aucune base, aucun réseau. Données fictives uniquement.
 */

describe('classifyImportOutcome — bilan SUCCES / PARTIEL / ECHEC', () => {
  it('100 % de lignes rejetées → ECHEC (plus jamais « Migration terminée ! »)', () => {
    const o = classifyImportOutcome({ totalProcessed: 1200, rejected: 1200, inserted: 0, updated: 0, duplicates: 0 });
    expect(o.status).toBe('ECHEC');
    expect(o.message).toMatch(/1200\/1200/);
  });

  it('fichier sans ligne de données → ECHEC', () => {
    expect(classifyImportOutcome({ totalProcessed: 0, rejected: 0 }).status).toBe('ECHEC');
    expect(classifyImportOutcome({}).status).toBe('ECHEC');
  });

  it('aucune ligne acceptée mais des rejets (compteurs incohérents) → ECHEC', () => {
    expect(classifyImportOutcome({ totalProcessed: 10, rejected: 3 }).status).toBe('ECHEC');
  });

  it('rejets partiels → PARTIEL avec le décompte', () => {
    const o = classifyImportOutcome({ totalProcessed: 1000, rejected: 37, inserted: 900, updated: 63 });
    expect(o.status).toBe('PARTIEL');
    expect(o.message).toMatch(/37 ligne\(s\) rejetée\(s\) sur 1000/);
  });

  it('aucun rejet → SUCCES (y compris un ré-import sans changement : doublons exacts)', () => {
    expect(classifyImportOutcome({ totalProcessed: 500, rejected: 0, inserted: 500 }).status).toBe('SUCCES');
    expect(classifyImportOutcome({ totalProcessed: 500, rejected: 0, duplicates: 500 }).status).toBe('SUCCES');
  });
});

describe('classifyImportOutcome — NUM_SECU_INVALIDE non bloquant', () => {
  it('704 num_secu invalides + 2 dates invalides (cas 706/704) → PARTIEL, jamais ECHEC', () => {
    // Le worker ne compte plus NUM_SECU_INVALIDE dans `rejected` : 2 vrais rejets (dates) seulement.
    const o = classifyImportOutcome({ totalProcessed: 704, rejected: 2, inserted: 702, numSecuInvalid: 704 });
    expect(o.status).toBe('PARTIEL');
    expect(o.message).toMatch(/2 ligne\(s\) rejetée\(s\) sur 704/);
    expect(o.message).not.toMatch(/706/);
    expect(o.message).toMatch(/704 numéro\(s\) de sécu invalide\(s\) ignoré\(s\)/);
    expect(o.message).toMatch(/à compléter dans l'application/);
  });

  it('uniquement des num_secu invalides, aucun rejet → SUCCES avec avertissement', () => {
    const o = classifyImportOutcome({ totalProcessed: 50, rejected: 0, inserted: 50, numSecuInvalid: 50 });
    expect(o.status).toBe('SUCCES');
    expect(o.message).toMatch(/50 numéro\(s\) de sécu invalide\(s\)/);
  });

  it('numSecuInvalid = 0 ou absent → aucun avertissement', () => {
    expect(classifyImportOutcome({ totalProcessed: 10, rejected: 0, inserted: 10, numSecuInvalid: 0 }).message).not.toMatch(/sécu/);
    expect(classifyImportOutcome({ totalProcessed: 10, rejected: 0, inserted: 10 }).message).not.toMatch(/sécu/);
  });

  it('toutes les lignes réellement rejetées → ECHEC conservé (DATE_INVALIDE / corrompues)', () => {
    const o = classifyImportOutcome({ totalProcessed: 5, rejected: 5, numSecuInvalid: 3 });
    expect(o.status).toBe('ECHEC');
    expect(o.message).toMatch(/5\/5/);
  });
});

describe('classifyImportOutcome — STATUT_INCONNU non bloquant', () => {
  it('statuts inconnus seuls, aucun rejet → SUCCES avec avertissement', () => {
    const o = classifyImportOutcome({ totalProcessed: 20, rejected: 0, inserted: 20, statutInconnu: 7 });
    expect(o.status).toBe('SUCCES');
    expect(o.message).toMatch(/7 statut\(s\) inconnu\(s\) ramené\(s\) à EN STOCK : à vérifier/);
  });

  it('ne change jamais le statut : mêmes verdicts avec ou sans statutInconnu', () => {
    const cas = [
      { totalProcessed: 10, rejected: 10 },
      { totalProcessed: 10, rejected: 3, inserted: 7 },
      { totalProcessed: 10, rejected: 0, inserted: 10 }
    ];
    for (const c of cas) {
      expect(classifyImportOutcome({ ...c, statutInconnu: 4 }).status).toBe(classifyImportOutcome(c).status);
    }
  });

  it('statutInconnu = 0 ou absent → aucun avertissement', () => {
    expect(classifyImportOutcome({ totalProcessed: 5, inserted: 5, statutInconnu: 0 }).message).not.toMatch(/statut/);
    expect(classifyImportOutcome({ totalProcessed: 5, inserted: 5 }).message).not.toMatch(/statut/);
  });

  it('deux avertissements (num_secu + statut) concaténés proprement', () => {
    const o = classifyImportOutcome({ totalProcessed: 100, rejected: 2, inserted: 98, numSecuInvalid: 30, statutInconnu: 5 });
    expect(o.status).toBe('PARTIEL');
    expect(o.message).toMatch(/30 numéro\(s\) de sécu invalide\(s\)[\s\S]*5 statut\(s\) inconnu\(s\)/);
    expect(o.message).not.toMatch(/ {2}/);
    expect(o.message).toMatch(/application\. Attention : 5 statut/);
  });
});

describe('isSupportedImportFile — seul le CSV est accepté', () => {
  it.each([
    ['C:\\imports\\listing.csv', true],
    ['listing.CSV', true],
    ['listing.xlsx', false],
    ['listing.xls', false],
    ['listing', false],
    ['', false]
  ])('%s → %s', (p, attendu) => {
    expect(isSupportedImportFile(p)).toBe(attendu);
  });
  it('valeurs non chaîne refusées', () => {
    expect(isSupportedImportFile(undefined)).toBe(false);
    expect(isSupportedImportFile(null)).toBe(false);
  });
});

describe('parseCsvLine / detectSeparator — CSV conforme RFC 4180', () => {
  it('séparateur ; (Excel FR) et séparateur , détectés hors guillemets', () => {
    expect(detectSeparator('NOMS;PRENOMS;DATE_NAISSANCE')).toBe(';');
    expect(detectSeparator('noms,prenoms,date_naissance')).toBe(',');
    expect(detectSeparator('"NOM, COMPLET";PRENOMS;DATE')).toBe(';'); // virgule dans un en-tête cité ignorée
    expect(detectSeparator('noms\tprenoms\tdate')).toBe('\t');
  });

  it('virgule/point-virgule à l\'intérieur d\'un champ entre guillemets', () => {
    expect(parseCsvLine('"DUPONT; épouse MARTIN";JEAN;1990-01-01', ';').fields)
      .toEqual(['DUPONT; épouse MARTIN', 'JEAN', '1990-01-01']);
    expect(parseCsvLine('"KONAN, Aya",MARIE,ABIDJAN', ',').fields)
      .toEqual(['KONAN, Aya', 'MARIE', 'ABIDJAN']);
  });

  it('guillemets échappés ("")', () => {
    expect(parseCsvLine('"DIT ""LE GRAND""";PAUL', ';').fields).toEqual(['DIT "LE GRAND"', 'PAUL']);
  });

  it('accents et BOM UTF-8 conservés / retirés correctement', () => {
    expect(parseCsvLine('\uFEFFKOUAMÉ;Adjoua Ç;Yamoussoukro', ';').fields).toEqual(['KOUAMÉ', 'Adjoua Ç', 'Yamoussoukro']);
  });

  it('champs vides conservés à leur position (pas de décalage de colonnes)', () => {
    expect(parseCsvLine('A;;C;', ';').fields).toEqual(['A', '', 'C', '']);
    expect(parseCsvLine(';;', ';').fields).toEqual(['', '', '']);
  });

  it('ligne invalide : guillemet non fermé signalé (à rejeter, pas à importer tronquée)', () => {
    const r = parseCsvLine('"DUPONT;JEAN;1990-01-01', ';');
    expect(r.unterminatedQuote).toBe(true);
  });

  it('régression documentée : le split naïf actuel décale les colonnes', () => {
    const ligne = '"DUPONT; épouse MARTIN";JEAN;1990-01-01';
    expect(ligne.split(';').length).toBe(4); // comportement actuel (aperçu + worker) : 4 colonnes au lieu de 3
    expect(parseCsvLine(ligne, ';').fields.length).toBe(3);
  });
});
