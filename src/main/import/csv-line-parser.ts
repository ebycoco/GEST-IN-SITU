/**
 * Découpage CSV d'une ligne conforme RFC 4180 (P1-C, audit du 27/09/2026).
 *
 * NON BRANCHÉ à ce jour : l'aperçu (handlers.ts, import:parseCSV) et le worker d'import
 * (workers/import-worker.js) découpent encore par `line.split(sep)`, qui casse tout champ
 * contenant le séparateur entre guillemets (ex. "KOUASSI; épouse YAO"). Le branchement touche
 * l'import massif de production (import-worker.js, JavaScript non typé, ne peut pas importer ce
 * module TypeScript) : il reste soumis à validation (STOP & WARN). Les deux chemins doivent être
 * modifiés ensemble, sinon l'aperçu et l'import divergent.
 *
 * Limite assumée : lecture ligne à ligne (readline) — un champ entre guillemets contenant un saut
 * de ligne n'est pas reconstitué ; il est signalé via `unterminatedQuote` pour être rejeté
 * explicitement plutôt qu'importé tronqué.
 */

export interface ParsedCsvLine {
  fields: string[];
  unterminatedQuote: boolean;
}

/**
 * Séparateur déduit de la ligne d'en-têtes : le candidat (';', ',', tabulation) le plus fréquent
 * HORS guillemets. Repli ';' (format Excel en réglages régionaux français) si aucun n'apparaît.
 */
export function detectSeparator(headerLine: string): string {
  const candidates = [';', ',', '\t'];
  const counts = new Map<string, number>(candidates.map(c => [c, 0]));
  let inQuotes = false;
  for (const ch of headerLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best = ';';
  let bestCount = 0;
  for (const c of candidates) {
    const n = counts.get(c) ?? 0;
    if (n > bestCount) { best = c; bestCount = n; }
  }
  return best;
}

export function parseCsvLine(line: string, sep: string): ParsedCsvLine {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = line.charCodeAt(0) === 0xfeff ? line.slice(1) : line; // BOM UTF-8

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } // guillemet échappé ""
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.trim() === '') {
      field = '';
      inQuotes = true;
    } else if (ch === sep) {
      fields.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(inQuotes ? field : field.trim());
  return { fields, unterminatedQuote: inQuotes };
}
