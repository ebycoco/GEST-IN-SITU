/**
 * Classification du résultat d'un import (P1-C, audit du 27/09/2026).
 *
 * Avant : ImportPage affichait « Migration terminée ! » en succès quel que soit le bilan, y compris
 * avec 100 % de lignes rejetées ou un fichier sans aucune ligne de données. La classification est
 * désormais calculée côté main (source de vérité) à partir des compteurs déjà renvoyés par
 * import-worker.js (non modifié), puis affichée telle quelle par le renderer.
 */

export type ImportOutcomeStatus = 'SUCCES' | 'PARTIEL' | 'ECHEC';

export interface ImportWorkerCounters {
  inserted?: number;
  updated?: number;
  completed?: number;
  completedN2?: number;
  rejected?: number;
  duplicates?: number;
  totalProcessed?: number;
}

export interface ImportOutcome {
  status: ImportOutcomeStatus;
  message: string;
}

/** Seul le CSV est réellement lu par l'aperçu et par le worker (lecture texte ligne à ligne). */
export const SUPPORTED_IMPORT_EXTENSIONS = ['csv'] as const;

export function isSupportedImportFile(filePath: string | null | undefined): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return (SUPPORTED_IMPORT_EXTENSIONS as readonly string[]).includes(ext);
}

export const UNSUPPORTED_IMPORT_FILE_MESSAGE =
  "Format de fichier non supporté : seul le CSV est accepté. Ouvrez le fichier Excel et enregistrez-le au format « CSV UTF-8 » avant l'import.";

export function classifyImportOutcome(r: ImportWorkerCounters): ImportOutcome {
  const n = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const processed = n(r.totalProcessed);
  const rejected = n(r.rejected);
  const acceptes = n(r.inserted) + n(r.updated) + n(r.completed) + n(r.completedN2) + n(r.duplicates);

  if (processed === 0) {
    return { status: 'ECHEC', message: "Aucune ligne de données n'a été lue dans le fichier (fichier vide ou format illisible)." };
  }
  if (rejected >= processed || (acceptes === 0 && rejected > 0)) {
    return {
      status: 'ECHEC',
      message: `Toutes les lignes ont été rejetées (${rejected}/${processed}). Vérifiez les en-têtes de colonnes et le séparateur du fichier.`
    };
  }
  if (rejected > 0) {
    return {
      status: 'PARTIEL',
      message: `Import partiel : ${rejected} ligne(s) rejetée(s) sur ${processed}, à traiter dans les anomalies d'import.`
    };
  }
  return { status: 'SUCCES', message: `Import terminé : ${processed} ligne(s) traitée(s) sans rejet.` };
}
