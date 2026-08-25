// GEST-IN-SITU Import Worker
// Runs in a separate thread to avoid blocking the Electron UI
const { parentPort, workerData } = require('worker_threads');
const Database = require(workerData.sqlitePath);
const { createReadStream, openSync, readSync, closeSync } = require('fs');
const readline = require('readline');

// Référence module-scope vers la connexion active, uniquement pour permettre au handler
// run().catch() ci-dessous de fermer proprement le WAL en cas d'exception non prévue
// (ex: erreur SQLite mi-écriture). Sans cela, une exception laisse la connexion ouverte
// jusqu'à la destruction du thread, ce qui peut laisser le WAL dans un état non checkpointé.
let workerDb = null;

async function run() {
  const startTime = Date.now();
  var totalRejected = 0;
  // Sous-ensemble de totalRejected : lignes réellement absentes de t_import_temp (dates
  // invalides), par opposition aux anomalies STATUT_INCONNU qui restent importées malgré
  // l'anomalie tracée. Sert à ne pas gonfler artificiellement le compteur "duplicates".
  var totalExcludedFromBatch = 0;
  // Lignes totalement vides (hors `rangement`) ignorées avant tout traitement — voir garde
  // juste avant `resolveRouting()` plus bas. Ne touche aucun autre compteur ni le contrat
  // postMessage({ type: 'done' }), uniquement tracé dans le log [IMPORT DIAGNOSTIC] final.
  var totalSkippedEmpty = 0;
  const { dbPath, filePath, agent, totalEstimate, siteId, routingTable, excludedRowIndices } = workerData;
  var lastProgressValue = -1;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Détecteur d'encodage pour supporter UTF-8 et Windows-1252 (Latin1)
  function detectEncoding(path) {
    try {
      const fd = openSync(path, 'r');
      const buffer = Buffer.alloc(102400);
      const bytesRead = readSync(fd, buffer, 0, 102400, 0);
      closeSync(fd);
      
      const slice = buffer.slice(0, bytesRead);
      const str = slice.toString('utf8');
      const reencoded = Buffer.from(str, 'utf8');
      
      if (slice.equals(reencoded)) {
        return 'utf8';
      }
      return 'latin1';
    } catch (e) {
      return 'utf8';
    }
  }

  // Comptage initial ultra-rapide par analyse binaire du fichier
  const countLinesFast = (path) => new Promise((resolve, reject) => {
    let count = 0;
    let lastChar = 0;
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      for (let i = 0; i < chunk.length; ++i) {
        if (chunk[i] === 10 && lastChar !== 13) {
          count++; // \n seul (Unix)
        } else if (chunk[i] === 13) {
          count++; // \r (Mac) ou début de \r\n (Windows)
        }
        lastChar = chunk[i];
      }
    });
    stream.on('end', () => resolve(count));
    stream.on('error', (err) => reject(err));
  });

  const rawCount = await countLinesFast(filePath);
  const total = rawCount > 0 ? rawCount - 1 : (totalEstimate || 220000);

  // Index de routage multi-site (longest-prefix-first) sur les centres
  const routingIndex = [];
  (routingTable || []).forEach(c => {
    if (c.prefixe_rangement && c.prefixe_rangement.trim()) {
      const prefixes = c.prefixe_rangement.split(',');
      prefixes.forEach(p => {
        const cleanP = p.toUpperCase().trim();
        if (cleanP) {
          routingIndex.push({
            centre_id: c.id,
            site_id: c.site_id,
            prefix: cleanP
          });
        }
      });
    }
  });
  routingIndex.sort((a, b) => b.prefix.length - a.prefix.length);

  // Le premier centre de la routingTable est toujours le centre principal (trié par numéro ASC en base)
  const defaultCentreId = (routingTable && routingTable.length > 0) ? routingTable[0].id : null;

  function resolveRouting(rawRangement) {
    const cleanRangement = removeAccents(rawRangement || '');
    if (!cleanRangement) {
      return { site_id: siteId, centre_id: defaultCentreId, rangement: 'NON CLASSE' };
    }
    const upper = cleanRangement.toUpperCase().trim();
    for (var i = 0; i < routingIndex.length; i++) {
      if (upper.startsWith(routingIndex[i].prefix)) {
        return { 
          site_id: routingIndex[i].site_id, 
          centre_id: routingIndex[i].centre_id, 
          rangement: upper 
        };
      }
    }
    return { site_id: siteId, centre_id: defaultCentreId, rangement: upper };
  }

  const db = new Database(dbPath, { timeout: 60000 });
  workerDb = db;
  db.pragma('busy_timeout = 60000');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');
  db.pragma('foreign_keys = OFF');

  // Ré-alignement défensif de `contact` sur le format canonique (chiffres bruts, sans
  // indicatif) — celui utilisé par la saisie manuelle et le pull Cloud. Répare les cartes
  // du site qu'une ancienne version de ce worker aurait stockées au format "+225 XX XX XX XX XX".
  // Doit s'exécuter AVANT le ré-alignement de cle_doublon ci-dessous, qui se base sur cette colonne.
  try {
    const badContacts = db.prepare(`
      SELECT id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance, contact
      FROM t_cartes
      WHERE site_id = ? AND contact LIKE '+225%'
    `).all(siteId);

    if (badContacts.length > 0) {
      const fixContactStmt = db.prepare(`UPDATE t_cartes SET contact = ?, cle_doublon = ? WHERE id_carte = ?`);
      const fixTx = db.transaction((rows) => {
        for (const row of rows) {
          const digits = normalizeContact(row.contact);
          const cleDbl = (row.noms || '') + '|' + (row.prenoms || '') + '|' + (row.date_de_naissance || '') + '|' + (row.lieu_de_naissance || '') + '|' + digits;
          fixContactStmt.run(digits, cleDbl, row.id_carte);
        }
      });
      fixTx(badContacts);
      console.log(`[CSV WORKER] contact ré-aligné (format canonique) sur ${badContacts.length} carte(s) du site ${siteId}.`);
    }
  } catch (err) {
    console.error('[CSV WORKER] Failed to normalize t_cartes contact:', err);
  }

  // Ré-alignement défensif de cle_doublon sur le format canonique à 5 segments
  // (noms|prenoms|date_de_naissance|lieu_de_naissance|contact), celui utilisé par la saisie
  // manuelle (createCarte/updateCarte), le dashboard qualité (stats-worker.js, sentinelle '||||')
  // et le moteur de sync (downstream.ts). Répare aussi les cartes du site qu'une ancienne version
  // de ce worker aurait déviées vers un format à 7 segments (+num_secu+statut), invisible à ces
  // modules. Ciblé sur les seules clés à réparer (>=6 '|') pour rester rapide sur les gros sites.
  try {
    const realign = db.prepare(`
      UPDATE t_cartes
      SET cle_doublon = COALESCE(noms, '') || '|' || COALESCE(prenoms, '') || '|' || COALESCE(date_de_naissance, '') || '|' || COALESCE(lieu_de_naissance, '') || '|' || COALESCE(contact, '')
      WHERE site_id = ? AND cle_doublon LIKE '%|%|%|%|%|%'
    `).run(siteId);
    if (realign.changes > 0) {
      console.log(`[CSV WORKER] cle_doublon ré-alignée (format canonique) sur ${realign.changes} carte(s) du site ${siteId}.`);
    }
  } catch (err) {
    console.error('[CSV WORKER] Failed to normalize t_cartes cle_doublon:', err);
  }

  // Drop and recreate temp table to guarantee a clean and up-to-date schema
  db.exec('DROP TABLE IF EXISTS t_import_temp;');
  db.exec(`
    CREATE TABLE t_import_temp (
      id_tmp INTEGER PRIMARY KEY AUTOINCREMENT,
      noms TEXT,
      prenoms TEXT,
      date_de_naissance TEXT,
      num_secu TEXT,
      lieu_de_naissance TEXT,
      contact TEXT,
      lieu_enrolement TEXT,
      rangement TEXT,
      statut TEXT,
      date_delivrance TEXT,
      agent_saisie TEXT,
      agent_distributeur TEXT,
      site_id INTEGER,
      centre_id INTEGER,
      cle_doublon TEXT,
      cle_doublon_flex TEXT,
      nom_retirant TEXT,
      num_retirant TEXT
    );
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_import_temp_cle ON t_import_temp(cle_doublon);');

  const insertStmt = db.prepare(
    'INSERT INTO t_import_temp (noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance, ' +
    'contact, lieu_enrolement, rangement, statut, date_delivrance, ' +
    'agent_saisie, agent_distributeur, site_id, centre_id, cle_doublon, cle_doublon_flex, nom_retirant, num_retirant) ' +
    'VALUES (@noms, @prenoms, @date_de_naissance, @num_secu, @lieu_de_naissance, ' +
    '@contact, @lieu_enrolement, @rangement, @statut, @date_delivrance, ' +
    '@agent_saisie, @agent_distributeur, @site_id, @centre_id, @cle_doublon, @cle_doublon_flex, @nom_retirant, @num_retirant)'
  );

  const insertAnomalyStmt = db.prepare(`
    INSERT INTO t_import_anomalies (carte_id, type_anomalie, description, noms, prenoms, date_de_naissance, num_secu, contact, site_id, erreur_message, lieu_de_naissance, rangement, lieu_enrolement, statut, date_delivrance)
    VALUES (@carte_id, @type_anomalie, @description, @noms, @prenoms, @date_de_naissance, @num_secu, @contact, @site_id, @erreur_message, @lieu_de_naissance, @rangement, @lieu_enrolement, @statut, @date_delivrance)
  `);

  const BATCH_SIZE = 10000;
  let totalTransactions = 0;
  const insertManyTx = db.transaction(function(items, anomalies) {
    for (var i = 0; i < items.length; i++) {
      insertStmt.run(items[i]);
    }
    for (var j = 0; j < anomalies.length; j++) {
      console.log(`[IMPORT DIAGNOSTIC] 💾 Insertion dans t_import_anomalies - Nom: ${anomalies[j].noms} ${anomalies[j].prenoms} | Raison: ${anomalies[j].erreur_message}`);
      insertAnomalyStmt.run(anomalies[j]);
    }
  });


  // ============================================================
  // UTILITAIRES DE BASE
  // ============================================================

  function removeAccents(str) {
    if (!str) return '';
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();
  }

  // Format canonique (chiffres bruts, sans indicatif) — identique à cartes.queries.ts
  // (saisie manuelle) et download-worker.js (pull Cloud), pour que la colonne `contact`
  // et donc `cle_doublon` restent comparables quelle que soit l'origine de la carte.
  function normalizeContact(contactStr) {
    if (!contactStr) return '';
    let cleaned = contactStr.toString().replace(/\D/g, '');
    if (cleaned.startsWith('225') && cleaned.length > 10) {
      cleaned = cleaned.substring(3);
    }
    if (cleaned.length > 10) {
      cleaned = cleaned.substring(cleaned.length - 10);
    }
    return cleaned;
  }

  function cleanBirthDate(dateStr) {
    if (!dateStr) return '';
    const cleanStr = dateStr.toString().trim().toLowerCase();
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanStr)) return cleanStr;

    if (/^\d{1,2}[\/\s-]\d{1,2}[\/\s-]\d{4}$/.test(cleanStr)) {
      const parts = cleanStr.split(/[\/\s-]+/);
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }

    const normalizedLiteral = cleanStr.replace(/\./g, '');
    const partsLiteral = normalizedLiteral.split(/[- ]+/);

    if (partsLiteral.length === 3) {
      const day = partsLiteral[0].padStart(2, '0');
      let monthToken = partsLiteral[1];
      let year = partsLiteral[2];

      if (monthToken.includes('jan')) monthToken = 'janv';
      else if (monthToken.startsWith('f')) monthToken = 'fevr';
      else if (monthToken.includes('mar')) monthToken = 'mars';
      else if (monthToken.startsWith('av')) monthToken = 'avr';
      else if (monthToken.includes('mai')) monthToken = 'mai';
      else if (monthToken.includes('jui') && monthToken.includes('n')) monthToken = 'juin';
      else if (monthToken.includes('jui')) monthToken = 'juil';
      else if (monthToken.startsWith('a')) monthToken = 'aout';
      else if (monthToken.includes('sep')) monthToken = 'sept';
      else if (monthToken.includes('oct')) monthToken = 'oct';
      else if (monthToken.startsWith('n')) monthToken = 'nov';
      else if (monthToken.includes('d') || monthToken.includes('c')) monthToken = 'dec';

      const frenchMonths = {
        'janv': '01', 'fevr': '02', 'mars': '03', 'avr': '04', 'mai': '05', 'juin': '06',
        'juil': '07', 'aout': '08', 'sept': '09', 'oct': '10', 'nov': '11', 'dec': '12'
      };

      if (frenchMonths[monthToken]) {
        if (year.length === 2) year = parseInt(year) > 30 ? `19${year}` : `20${year}`;
        return `${year}-${frenchMonths[monthToken]}-${day}`;
      }
    }
    return '';
  }

  /**
   * Normalise une valeur brute de la colonne date_delivrance du CSV.
   * Retourne une date 'YYYY-MM-DD' valide, ou null si le contenu est
   * du texte parasite (ex: 'RETIRER', 'OK'), vide, un tiret ou un
   * format non reconnu.
   *
   * Un retour null dans les Chemins A/B déclenche le fallback TODAY_ISO.
   */
  function normalizeDateDistribution(rawDate) {
    if (!rawDate) return null;
    var s = rawDate.toString().trim();

    // Rejet immédiat : vide, tiret ou valeur triviale
    if (!s || s === '-' || s === '--' || s === 'N/A' || s === 'NA' || s === '/') return null;

    // Rejet immédiat : moins de 2 chiffres → texte pur parasite ('RETIRER', 'OK', 'OUI'...)
    var digitCount = (s.match(/\d/g) || []).length;
    if (digitCount < 2) return null;

    // Tentative de parsing via cleanBirthDate (gère JJ/MM/AAAA, JJ-MM-AAAA, YYYY-MM-DD, littéraux)
    var parsed = cleanBirthDate(s);

    // Validation stricte : le résultat doit être exactement YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(parsed)) {
      var parts = parsed.split('-');
      var y = parseInt(parts[0], 10);
      var m = parseInt(parts[1], 10);
      var d = parseInt(parts[2], 10);
      // Contrôle calendaire de base
      if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return parsed; // ✅ Date valide et cohérente
      }
    }

    return null; // Format non reconnu ou date aberrante → fallback date du jour
  }

  // ============================================================
  // MISSION 1 — BuildColumnMap : Détection insensible à la casse et aux accents
  // ============================================================

  // Table des alias reconnus par colonne canonique
  // removeAccents() est appliqué à la fois sur les clés du CSV et sur ces alias au moment de la comparaison.
  const COLUMN_ALIASES = {
    statut:            ['STATUT', 'STATUS', 'ETAT', 'ETAT CARTE', 'ETAT DE LA CARTE', 'SITUATION'],
    noms:              ['NOMS', 'NOM', 'NAME', 'LASTNAME', 'NOM ASSURE'],
    prenoms:           ['PRENOMS', 'PRENOM', 'FIRSTNAME', 'PRENOM ASSURE'],
    date_de_naissance: ['DATE DE NAISSANCE', 'DATE_DE_NAISSANCE', 'DDN', 'NAISSANCE', 'DATE NAISS'],
    num_secu:          ['NUM SECU', 'NUM_SECU', 'NUMERO SECURITE', 'ID CMU', 'NUMERO CMU', 'NUM CMU', 'N° SECU', 'N° SÉCU'],
    contact:           ['CONTACT', 'TELEPHONE', 'TEL', 'PHONE', 'NUMERO TEL'],
    lieu_de_naissance: ['LIEU DE NAISSANCE', 'LIEU_DE_NAISSANCE', 'LIEU NAISS', 'COMMUNE NAISS'],
    lieu_enrolement:   ['LIEU ENROLEMENT', 'LIEU_ENROLEMENT', 'ENROLEMENT', 'SITE ENROLEMENT'],
    rangement:         ['RANGEMENT', 'EMPLACEMENT', 'REFERENCE', 'REF', 'CLASSEMENT'],
    date_delivrance:   ['DATE DELIVRANCE', 'DATE_DELIVRANCE', 'DATE DISTRIBUTION', 'DATE RETRAIT', 'DATE LIVRAISON'],
  };

  /**
   * Construit un dictionnaire { nomCanonique: indexColonne } à partir des headers bruts du CSV.
   * La comparaison est insensible à la casse ET aux accents (via removeAccents).
   */
  function buildColumnMap(rawHeaders) {
    var colMap = {};
    for (var idx = 0; idx < rawHeaders.length; idx++) {
      var hNorm = removeAccents(rawHeaders[idx].trim()); // NFD strip + uppercase
      var matched = false;
      for (var canonical in COLUMN_ALIASES) {
        if (COLUMN_ALIASES.hasOwnProperty(canonical)) {
          var aliases = COLUMN_ALIASES[canonical];
          for (var j = 0; j < aliases.length; j++) {
            if (removeAccents(aliases[j]) === hNorm) {
              if (colMap[canonical] === undefined) { // Premier match gagne
                colMap[canonical] = idx;
              }
              matched = true;
              break;
            }
          }
        }
        if (matched) break;
      }
      // Fallback : si aucun alias reconnu, enregistrer la clé normalisée brute
      if (!matched) {
        var fallbackKey = hNorm.toLowerCase().replace(/\s+/g, '_');
        if (colMap[fallbackKey] === undefined) {
          colMap[fallbackKey] = idx;
        }
      }
    }
    return colMap;
  }

  /**
   * Lecture sécurisée d'une colonne : cherche d'abord par nom canonique, puis par clé de fallback.
   */
  function getCol(cols, colMap, canonical, fallbackKey) {
    var idx = colMap[canonical];
    if (idx === undefined && fallbackKey) {
      idx = colMap[fallbackKey];
    }
    return (idx !== undefined ? (cols[idx] || '') : '');
  }

  // ============================================================
  // MISSION 2 — ParseStatutSemantique : Arbre de décision ligne par ligne
  // ============================================================

  // Mots de parenté déclenchant le Chemin A (Retrait Intelligent)
  // Q3 arbitrage : un mot de parenté seul (ex: 'FRERE') déclenche aussi le Chemin A.
  const MOTS_PARENTE = [
    'FRERE', 'PERE', 'MERE', 'SOEUR', 'EPOUX', 'EPOUSE', 'CONJOINT', 'CONJOINTE',
    'FILS', 'FILLE', 'ONCLE', 'TANTE', 'NEVEU', 'NIECE', 'COUSIN', 'COUSINE',
    'TUTEUR', 'MANDATAIRE', 'PROCHE', 'AYANT DROIT', 'GRAND PERE', 'GRAND MERE',
    'BEAU PERE', 'BELLE MERE', 'BEAU FRERE', 'BELLE SOEUR'
  ];

  // Mots fonctionnels à purger lors de l'extraction du nom retirant
  const MOTS_FONCTIONNELS = [
    'RETIRE', 'RETIRER', 'DELIVRE', 'DELIVRER', 'DISTRIBUE', 'DISTRIBUER',
    'REMET', 'REMETTRE', 'REMIS', 'PAR', 'POUR', 'LE', 'LA', 'LES', 'DE', 'DU',
    'AU', 'AUX', 'UN', 'UNE', 'SA', 'SON', 'SES', 'CARTE', 'CMU', 'A', 'ET'
  ];

  // Préfixes et valeurs exactes identifiant un statut livré SANS complexité (Chemin B)
  const PREFIXES_LIVRE = ['DELIV', 'DISTRIB', 'REMI'];
  const VALEURS_EXACTES_LIVRE = ['OK', 'RECU', 'OUI', 'LIVRE', 'RETIRE'];

  // Regex de détection d'un numéro de téléphone dans une chaîne (≥8 chiffres avec séparateurs optionnels)
  const REGEX_PHONE_DETECT = /\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d/;

  /**
   * CHEMIN A — Détecte si la chaîne brute contient des indices de Retrait Intelligent.
   * Déclenché si : contient PAR, LUI/MEME/ELLE, un mot de parenté, ou un numéro de téléphone.
   */
  function isRetraitIntelligent(raw) {
    if (!raw) return false;
    // Présence de "PAR" (retrait par tiers)
    if (/\bPAR\b/.test(raw)) return true;
    // L'assuré lui-même
    if (raw.includes('LUI') || raw.includes('MEME') || raw.includes('ELLE')) return true;
    // Mot de parenté (Arbitrage Q3 : seul suffit)
    for (var i = 0; i < MOTS_PARENTE.length; i++) {
      if (raw.includes(MOTS_PARENTE[i])) return true;
    }
    // Numéro de téléphone intégré dans la chaîne
    if (REGEX_PHONE_DETECT.test(raw)) return true;
    return false;
  }

  /**
   * CHEMIN B — Détecte un statut livré standard sans complexité.
   * Précédence : isRetraitIntelligent est testé AVANT, donc on n'arrive ici que si ce n'est pas un retrait complexe.
   */
  function isStatutDistribueSimple(raw) {
    if (!raw) return false;
    for (var i = 0; i < PREFIXES_LIVRE.length; i++) {
      if (raw.startsWith(PREFIXES_LIVRE[i])) return true;
    }
    return VALEURS_EXACTES_LIVRE.indexOf(raw) !== -1;
  }

  // Liste exhaustive des statuts reconnus par le pipeline (Chemins A, B, C)
  // Tout rawStatut non vide et absent de cette liste sera tracé comme STATUT_INCONNU.
  var STATUS_CONNUS = [
    // Chemin ANNULE & DOUBLON
    'ANNULE', 'DOUBLON',
    // Chemin B — valeurs exactes
    'OK', 'RECU', 'OUI', 'LIVRE', 'RETIRE',
    // Chemin B — préfixes (on inclut les valeurs de base que les préfixes couvrent)
    'DELIV', 'DELIVRE', 'DELIVREE', 'DELIVRER',
    'DISTRIB', 'DISTRIBUE', 'DISTRIBUEE', 'DISTRIBUER',
    'REMI', 'REMIS', 'REMETTRE',
    // Chemin C — valeurs stock normales
    'EN STOCK', 'STOCK', 'NON DISTRIBUE', 'NON DELIVRE', 'DISPONIBLE', 'EN ATTENTE RETRAIT'
  ];

  /**
   * CHEMIN C — Normalisation par défaut.
   * Retourne 'EN STOCK' pour toutes les valeurs vides, connues ou inconnues.
   *
   * NOTE : La contrainte CHECK de t_cartes interdit tout statut hors de
   * ('EN STOCK','DELIVRE','DISTRIBUEE','RETIRE','ANNULE'). Les statuts
   * inconnus (ex: 'SUSPENDU', 'EN ATTENTE') sont donc normalisés vers
   * 'EN STOCK' pour ne pas violer la contrainte et garantir la cohérence.
   * La valeur brute est tracée dans les logs console pour audit éventuel.
   */
  function normaliserStatut(raw) {
    if (!raw || raw === '-' || raw === '--' || raw === 'N/A' || raw === 'NA') return 'EN STOCK';
    var VALEURS_STOCK = ['EN STOCK', 'STOCK', 'NON DISTRIBUE', 'NON DELIVRE', 'DISPONIBLE', 'EN ATTENTE RETRAIT'];
    if (VALEURS_STOCK.indexOf(raw) !== -1) return 'EN STOCK';
    if (raw === 'DOUBLON') return 'DOUBLON';
    // Valeur inconnue : on la logue pour traçabilité, mais on force 'EN STOCK'
    // pour respecter la contrainte CHECK de t_cartes
    console.warn('[CSV WORKER] Statut inconnu normalisé en EN STOCK:', raw);
    return 'EN STOCK';
  }

  /**
   * Extrait et normalise un numéro de téléphone depuis une chaîne brute.
   * Retourne null si aucun numéro valide (≥8 chiffres) n'est trouvé.
   */
  function extractPhone(raw) {
    if (!raw) return null;
    // Regex étendue : capture séquence d'au moins 8 chiffres avec séparateurs optionnels
    var match = raw.match(/(?:(?:\+|00)225[\s.\-]?)?(\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d(?:[\s.\-]?\d{0,2})?)/);
    if (!match) return null;
    var digits = match[0].replace(/\D/g, '');
    if (digits.length < 8) return null;
    return normalizeContact(digits); // → chiffres bruts (format canonique)
  }

  /**
   * Extrait l'identité du retirant depuis la chaîne de statut brute.
   * Priorité : LUI/ELLE MEME → <NOM PRENOM> | Mot de parenté seul → mot-clé | Général → purge des mots fonctionnels.
   */
  function extractNomRetirant(raw, noms, prenoms) {
    if (!raw) return 'TIERS INCONNU';

    // Cas 1 : L'assuré lui-même (LUI-MEME, ELLE-MEME, ou combinaisons)
    if ((raw.includes('LUI') && raw.includes('MEME')) ||
        (raw.includes('ELLE') && raw.includes('MEME')) ||
        raw === 'LUI-MEME' || raw === 'ELLE-MEME' || raw === 'LUIMEME') {
      return (noms + ' ' + prenoms).trim();
    }

    // Cas 2 : Mot de parenté présent seul ou en position dominante
    // On cherche si un mot de parenté est le seul contenu significatif après purge
    for (var pi = 0; pi < MOTS_PARENTE.length; pi++) {
      var parente = MOTS_PARENTE[pi];
      // Retrait exact du mot de parenté (avec ou sans verbe fonctionnel)
      if (raw === parente) {
        return parente; // ex: "FRERE", "MERE"
      }
      // Présence du mot de parenté après suppression des mots fonctionnels
      var withoutFunctional = raw;
      for (var fi = 0; fi < MOTS_FONCTIONNELS.length; fi++) {
        withoutFunctional = withoutFunctional.replace(new RegExp('\\b' + MOTS_FONCTIONNELS[fi] + '\\b', 'g'), '').trim();
      }
      // Retirer le numéro de téléphone
      withoutFunctional = withoutFunctional.replace(/(?:(?:\+|00)225[\s.\-]?)?(\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d(?:[\s.\-]?\d{0,2})?)/g, '').trim();
      if (withoutFunctional === parente) {
        return parente;
      }
    }

    // Cas 3 : Extraction générale — purger les mots fonctionnels ET le numéro de téléphone
    var residue = raw;

    // Retirer le numéro de téléphone extrait
    residue = residue.replace(/(?:(?:\+|00)225[\s.\-]?)?(\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d[\s.\-]?\d(?:[\s.\-]?\d{0,2})?)/g, '');

    // Tokeniser et purger les mots fonctionnels et de parenté
    var tokens = residue.split(/[\s,;.\-]+/).filter(Boolean);
    var kept = tokens.filter(function(t) {
      return MOTS_FONCTIONNELS.indexOf(t) === -1 &&
             MOTS_PARENTE.indexOf(t) === -1 &&
             t.length > 1;
    });

    var result = kept.join(' ').trim();
    return result || 'TIERS INCONNU';
  }

  // ============================================================
  // LECTURE DU CSV
  // Stream read CSV with auto-detected encoding
  // ============================================================
  const encoding = detectEncoding(filePath);
  console.log(`[CSV WORKER] Import encoding resolved to: ${encoding}`);
  const fileStream = createReadStream(filePath, { encoding });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  var headers = [];
  var colMap = {};       // ← MISSION 1 : carte canonique → index colonne
  var batch = [];
  var anomaliesBatch = [];
  var lineCount = 0;
  var processedRows = 0;
  var sep = ';';
  // P0 fix : Set des index (0-based, même ordre que preview.rows côté renderer, en-tête
  // exclu, lignes vides exclues) des lignes retirées de l'aperçu par l'utilisateur via la
  // corbeille. Lookup O(1) pour ne pas dégrader la boucle principale sur les gros fichiers.
  var excludedSet = new Set(Array.isArray(excludedRowIndices) ? excludedRowIndices : []);

  function isValidDate(dateStr) {
    if (!dateStr) return false;
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);
    const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
  }

  // Date du jour précalculée une seule fois pour toute la session d'import.
  // Réutilisée comme fallback absolu dans les Chemins A et B.
  var TODAY_ISO = new Date().toISOString().split('T')[0]; // ex: '2026-07-02'

  const iterator = rl[Symbol.asyncIterator]();
  while (true) {
    const { value: line, done } = await iterator.next();
    if (done) break;

    if (!line.trim()) continue;
    if (lineCount === 0) {
      // Détection du séparateur
      sep = line.includes(';') ? ';' : ',';
      headers = line.split(sep).map(function(h) { return h.trim().replace(/"/g, '').replace(/^\uFEFF/, ''); });
      // MISSION 1 : Construire la carte canonique des colonnes
      colMap = buildColumnMap(headers);
      console.log('[CSV WORKER] Column map resolved:', JSON.stringify(colMap));
    } else {
      // P0 fix : ligne exclue par l'utilisateur depuis l'aperçu (corbeille). L'invariant
      // d'alignement des index tient parce que ce bloc `else` (ligne de donnée) n'est
      // atteint qu'après le header (lineCount===0, traité ci-dessus) ET après le `continue`
      // des lignes vides (ligne ~587, qui saute lineCount++ AVANT d'y arriver) — donc à cet
      // instant, lineCount vaut exactement 1 + (nombre de lignes de données déjà vues),
      // soit dataRowIndex = lineCount - 1 pour la ligne de donnée courante (0-based, même
      // ordre que preview.rows côté renderer). On incrémente lineCount manuellement avant
      // le `continue` car celui-ci saute l'incrément normal de fin de boucle (~ligne 780) —
      // sans ça, l'indexation de toutes les lignes suivantes serait décalée. Aucun compteur
      // de statistiques (processedRows, totalRejected, batch, anomaliesBatch) n'est touché
      // pour une ligne exclue : elle ne doit apparaître dans aucun total du Bilan de Migration.
      var dataRowIndex = lineCount - 1;
      if (excludedSet.has(dataRowIndex)) {
        lineCount++;
        continue;
      }
      try {
        var cols = line.split(sep).map(function(c) { return c.trim().replace(/^"|"$/g, ''); });

        // Lecture sécurisée des colonnes via colMap (insensible aux accents et casse)
        var noms     = removeAccents(getCol(cols, colMap, 'noms', 'nom') || '');
        var prenoms  = removeAccents(getCol(cols, colMap, 'prenoms', 'prenom') || '');
        var ddn      = cleanBirthDate(getCol(cols, colMap, 'date_de_naissance', 'ddn') || '');
        var lieuN    = removeAccents(getCol(cols, colMap, 'lieu_de_naissance') || '');
        var contact  = normalizeContact(getCol(cols, colMap, 'contact', 'telephone') || '');
        var lieuE    = removeAccents(getCol(cols, colMap, 'lieu_enrolement') || '');

        // ============================================================
        // MISSION 2 — ParseStatutSemantique : Arbre de décision complet
        // ============================================================
        var rawStatut = removeAccents((getCol(cols, colMap, 'statut', 'etat') || '').trim());

        // Lecture anticipée pour le contrôle de ligne vide (num_secu et date_delivrance ne sont
        // sinon lus qu'à l'intérieur de branches conditionnelles plus bas dans la boucle).
        var numSecuRaw = (getCol(cols, colMap, 'num_secu', 'num_secu') || '').trim();
        var dateDelivranceRaw = (getCol(cols, colMap, 'date_delivrance') || '').trim();

        // Ligne totalement vide (hors `rangement`, qui reçoit un défaut automatique et ne doit
        // donc jamais servir de preuve de contenu réel) : ignorée avant tout traitement, sans
        // jamais être insérée (ni t_cartes, ni t_import_anomalies). Incrément manuel de lineCount
        // avant `continue`, comme pour une ligne exclue par l'utilisateur (cf. commentaire plus haut
        // sur excludedSet), afin de préserver l'alignement des index de lignes suivantes.
        if (!noms && !prenoms && !ddn && !numSecuRaw && !lieuN && !contact && !lieuE && !rawStatut && !dateDelivranceRaw) {
          totalSkippedEmpty++;
          lineCount++;
          continue;
        }

        var finalStatut       = 'EN STOCK';
        var nomRetirant       = null;
        var numRetirant       = null;
        var dateDelivrance    = '';
        var agentDistributeur = null;

        if (rawStatut === 'ANNULE') {
          // Statut annulé — aucune extraction, conservé tel quel
          finalStatut = 'ANNULE';

        } else if (isRetraitIntelligent(rawStatut)) {
          // ============================================================
          // CHEMIN A — Retrait Intelligent
          // Déclenché par : PAR, LUI/MEME/ELLE, mot de parenté, numéro de téléphone
          // ============================================================
          finalStatut       = 'DELIVRE';
          nomRetirant       = extractNomRetirant(rawStatut, noms, prenoms);
          numRetirant       = extractPhone(rawStatut) || contact; // Q1 : numéro extrait sinon contact assuré
          // Tente la colonne date_delivrance CSV (normalizeDateDistribution filtre les mots parasites)
          // Si nulle ou invalide → fallback absolu sur la date du jour de l'import
          var rawDateA   = getCol(cols, colMap, 'date_delivrance') || '';
          dateDelivrance = normalizeDateDistribution(rawDateA) || TODAY_ISO;
          agentDistributeur = 'SYSTEME';

        } else if (isStatutDistribueSimple(rawStatut)) {
          // ============================================================
          // CHEMIN B — Statut Distribué Standard
          // Déclenché par : DELIVRE, DISTRIBUE, REMI, OK, RETIRE, OUI, RECU...
          // ============================================================
          finalStatut       = 'DELIVRE';
          nomRetirant       = (noms + ' ' + prenoms).trim(); // L'assuré lui-même par défaut
          numRetirant       = contact;
          agentDistributeur = 'SYSTEME';

          // normalizeDateDistribution rejette les mots parasites ('RETIRER', 'OK'...),
          // valide le format et garantit YYYY-MM-DD. Fallback absolu sur TODAY_ISO.
          var rawDateB   = getCol(cols, colMap, 'date_delivrance') || '';
          dateDelivrance = normalizeDateDistribution(rawDateB) || TODAY_ISO;

        } else {
          // ============================================================
          // CHEMIN C — Normalisation par défaut
          // Q2 arbitrage : statuts inconnus conservés en majuscules pour audit
          // FIX 3 : Si rawStatut n'est pas vide ET n'est dans aucune catégorie
          // connue (ni un préfixe Chemin B, ni une valeur Chemin C), on émet
          // une anomalie STATUT_INCONNU pour traçabilité opératrice.
          // ============================================================
          finalStatut = normaliserStatut(rawStatut);

          // Détection d'un statut véritablement inconnu : non vide, non trivial
          // et absent de STATUS_CONNUS (comparaison exacte ET par préfixe pour PREFIXES_LIVRE).
          var isTrivalEmpty = !rawStatut || rawStatut === '-' || rawStatut === '--' || rawStatut === 'N/A' || rawStatut === 'NA';
          if (!isTrivalEmpty) {
            var isKnown = STATUS_CONNUS.indexOf(rawStatut) !== -1;
            // Vérification par préfixe pour DELIV*, DISTRIB*, REMI* (couverts par Chemin B mais
            // listés ici pour exhaustivité — en pratique isStatutDistribueSimple les attrape avant).
            if (!isKnown) {
              for (var pi2 = 0; pi2 < PREFIXES_LIVRE.length; pi2++) {
                if (rawStatut.startsWith(PREFIXES_LIVRE[pi2])) { isKnown = true; break; }
              }
            }
            if (!isKnown) {
              var errMsg = 'Statut inconnu "' + rawStatut + '" normalisé en EN STOCK';
              console.warn('[CSV WORKER] STATUT_INCONNU détecté, création anomalie:', rawStatut);
              anomaliesBatch.push({
                carte_id: (getCol(cols, colMap, 'num_secu', 'num_secu') || '').trim() || (noms + '|' + prenoms + '|' + ddn),
                type_anomalie: 'STATUT_INCONNU',
                description: errMsg,
                noms: noms,
                prenoms: prenoms,
                date_de_naissance: ddn,
                num_secu: (getCol(cols, colMap, 'num_secu', 'num_secu') || '').trim(),
                contact: contact,
                site_id: siteId,
                erreur_message: errMsg,
                lieu_de_naissance: lieuN,
                rangement: (getCol(cols, colMap, 'rangement') || '').toUpperCase().trim(),
                lieu_enrolement: lieuE,
                statut: finalStatut,
                date_delivrance: dateDelivrance
              });
              totalRejected++;
            }
          }
        }

        var resolved = resolveRouting(getCol(cols, colMap, 'rangement') || '');

        // Validation stricte des dates
        let dateError = null;
        if (!isValidDate(ddn)) {
          dateError = `Date de naissance invalide ou absente : "${ddn || ''}"`;
        } else if (finalStatut === 'DELIVRE' && dateDelivrance && !isValidDate(dateDelivrance)) {
          dateError = `Date de délivrance invalide : "${dateDelivrance}"`;
        }

        if (dateError) {
          console.log(`[IMPORT DIAGNOSTIC] ❌ Ligne rejetée (Date Invalide) - Nom: ${noms} ${prenoms} | Erreur: ${dateError}`);
          totalRejected++;
          totalExcludedFromBatch++;
          anomaliesBatch.push({
            carte_id: (getCol(cols, colMap, 'num_secu', 'num_secu') || '').trim() || (noms + '|' + prenoms + '|' + ddn),
            type_anomalie: 'DATE_INVALIDE',
            description: dateError,
            noms: noms,
            prenoms: prenoms,
            date_de_naissance: ddn,
            num_secu: (getCol(cols, colMap, 'num_secu', 'num_secu') || '').trim(),
            contact: contact,
            site_id: siteId,
            erreur_message: dateError,
            lieu_de_naissance: lieuN,
            rangement: resolved.rangement,
            lieu_enrolement: lieuE,
            statut: finalStatut,
            date_delivrance: dateDelivrance
          });
        } else {
          batch.push({
            noms: noms,
            prenoms: prenoms,
            date_de_naissance: ddn,
            num_secu: (getCol(cols, colMap, 'num_secu', 'num_secu') || '').trim(),
            lieu_de_naissance: lieuN,
            contact: contact,
            lieu_enrolement: lieuE,
            rangement: resolved.rangement,
            statut: finalStatut,
            date_delivrance: dateDelivrance,
            agent_saisie: agent,
            agent_distributeur: agentDistributeur,
            site_id: resolved.site_id,
            centre_id: resolved.centre_id,
            cle_doublon: noms + '|' + prenoms + '|' + ddn + '|' + lieuN + '|' + contact,
            cle_doublon_flex: noms + '|' + prenoms + '|' + ddn + '|' + contact,
            nom_retirant: nomRetirant,
            num_retirant: numRetirant
          });
        }

        processedRows++;
      } catch (lineError) {
        totalRejected++;
        console.error(`[CSV WORKER] Ligne corrompue détectée à la ligne #${lineCount}: "${line}"`, lineError);
      }

      // Flush du batch EN DEHORS du try-catch per-ligne
      if (batch.length + anomaliesBatch.length >= BATCH_SIZE) {
        insertManyTx(batch, anomaliesBatch);
        totalTransactions++;
        batch = [];
        anomaliesBatch = [];

        // Force GC references clean-up
        if (global.gc) {
          global.gc();
        }

        var val = Math.min(Math.round((processedRows / total) * 80), 80);
        if (val !== lastProgressValue) {
          lastProgressValue = val;
          parentPort.postMessage({ type: 'progress', value: val });
        }

        // Micro-pause pour libérer l'Event Loop et permettre au GC d'agir
        await sleep(5);
      }
    }
    lineCount++;
    if (lineCount % 1000 === 0) {
      console.log(`[CSV WORKER] Traitement en cours... ${lineCount} lignes analysées.`);
    }
  }

  if (batch.length > 0 || anomaliesBatch.length > 0) {
    insertManyTx(batch, anomaliesBatch);
    totalTransactions++;
    batch = [];
    anomaliesBatch = [];
  }

  parentPort.postMessage({ type: 'progress', value: 82 });

  // Index composite pour accélérer le NOT EXISTS de la fusion
  db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_cle_site ON t_cartes(cle_doublon, site_id);');
  // Index sur la table temporaire
  db.exec("CREATE INDEX IF NOT EXISTS idx_import_temp_cle_flex ON t_import_temp(cle_doublon_flex);");

  // Garde anti-doublon intra-fichier : si le CSV contient plusieurs lignes strictement
  // identiques (même cle_doublon+site_id), un simple NOT EXISTS contre t_cartes ne les
  // détecte pas entre elles (aucune n'existe encore dans t_cartes au moment de l'INSERT),
  // donc chacune serait insérée comme fiche distincte. Correction en une passe globale
  // (GROUP BY, un seul index scan) plutôt qu'une sous-requête corrélée par ligne dans la
  // boucle de fusion — moins coûteux et ne laisse en base qu'une seule ligne (la première,
  // MIN id_tmp) par groupe de doublons avant que la fusion par chunks ne démarre.
  const dedupResult = db.prepare(`
    DELETE FROM t_import_temp
    WHERE id_tmp NOT IN (
      SELECT MIN(id_tmp) FROM t_import_temp GROUP BY cle_doublon, site_id
    )
  `).run();
  if (dedupResult.changes > 0) {
    console.log(`[CSV WORKER] ${dedupResult.changes} doublon(s) strict(s) retiré(s) de t_import_temp avant fusion.`);
  }

  // MISSION 4 — DétecterDoublonsProbables : calculé ICI, AVANT la boucle de fusion/insertion
  // ci-dessous, sur l'état de t_cartes tel qu'il existait avant que cet import n'y ajoute ses
  // propres nouvelles fiches. CORRECTIF : ce comptage était auparavant exécuté APRÈS la fusion,
  // ce qui faisait qu'une carte fraîchement insérée par CE MÊME import matchait sa PROPRE clé
  // exacte (cle_doublon) via le NOT EXISTS ci-dessous — invalidant la détection pour elle-même
  // et empêchant quasiment toujours ce compteur de se déclencher en pratique. On compte les
  // lignes qui vont finir par créer une NOUVELLE fiche (aucune correspondance exacte via
  // cle_doublon) mais qui partagent une identité approximative (cle_doublon_flex, sans le lieu
  // de naissance) avec une fiche déjà existante — signe d'un doublon probable (variante
  // d'orthographe/lieu) que la clé stricte ne peut pas détecter. Purement en lecture, aucun
  // impact sur la logique d'insertion/fusion qui suit.
  let probableDuplicatesCount = 0;
  try {
    const probableRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM t_import_temp t
      WHERE NOT EXISTS (
        SELECT 1 FROM t_cartes c WHERE c.cle_doublon = t.cle_doublon AND c.site_id = t.site_id
      )
      AND EXISTS (
        SELECT 1 FROM t_cartes c2
        WHERE c2.cle_doublon_flex = t.cle_doublon_flex AND c2.site_id = t.site_id AND c2.cle_doublon != t.cle_doublon
      )
    `).get();
    probableDuplicatesCount = (probableRow && probableRow.count) || 0;
  } catch (err) {
    console.error('[CSV WORKER] Échec du comptage des doublons probables:', err);
  }

  // Fusion phase - transactions courtes par chunk pour éviter la saturation du WAL
  var now = new Date().toISOString();

  // Get min and max id_tmp from t_import_temp to execute chunked queries
  const idRow = db.prepare('SELECT MIN(id_tmp) as minId, MAX(id_tmp) as maxId FROM t_import_temp').get();
  const minId = idRow?.minId || 0;
  const maxId = idRow?.maxId || 0;
  
  const CHUNK_SIZE = 10000;
  let totalUpdated = 0;
  let totalInserted = 0;

  // ============================================================
  // MISSION 3 — FusionnerImportVersCartes : Sécurisation SQL absolue
  //
  // RÈGLE DE SÉCURITÉ ABSOLUE :
  //   Un statut importé 'DELIVRE' met à jour t_cartes UNIQUEMENT si
  //   la carte existante est actuellement 'EN STOCK' (ou vide/NULL).
  //   Une carte déjà 'DELIVRE' ou 'ANNULE' dans t_cartes n'est JAMAIS
  //   réécrasée vers un statut inférieur.
  // ============================================================
  const updateChunkStmt = db.prepare(
    'UPDATE t_cartes ' +
    'SET statut             = t_import_temp.statut, ' +
    '    nom_retirant       = COALESCE(t_import_temp.nom_retirant, t_cartes.nom_retirant), ' +
    '    num_retirant       = COALESCE(t_import_temp.num_retirant, t_cartes.num_retirant), ' +
    '    agent_distributeur = COALESCE(t_import_temp.agent_distributeur, t_cartes.agent_distributeur), ' +
    '    centre_id          = COALESCE(t_cartes.centre_id, t_import_temp.centre_id), ' +
    // CORRECTION : NULLIF élimine les anciens tirets '-', '--' et chaînes vides '' avant le COALESCE.
    // Sans cela, COALESCE préserverait les valeurs pourries de t_cartes car elles ne sont pas NULL.
    // La vraie date calculée par le Worker (toujours YYYY-MM-DD) écrase ainsi les résidus parasites.
    '    date_delivrance    = COALESCE(' +
    '      NULLIF(NULLIF(NULLIF(TRIM(t_cartes.date_delivrance), \'\'), \'-\'), \'--\'),' +
    '      t_import_temp.date_delivrance' +
    '    ), ' +
    '    updated_at         = @now, is_dirty = 1 ' +
    'FROM t_import_temp ' +
    'WHERE t_cartes.cle_doublon = t_import_temp.cle_doublon ' +
    '  AND t_cartes.site_id     = t_import_temp.site_id ' +
    '  AND t_import_temp.id_tmp BETWEEN @startId AND @endId ' +
    // SÉCURITÉ : n'écraser QUE si la carte locale est EN STOCK (ou vide/NULL)
    "  AND (t_cartes.statut = 'EN STOCK' OR t_cartes.statut IS NULL OR t_cartes.statut = '') " +
    // ET seulement si l'import apporte une vraie livraison
    "  AND t_import_temp.statut = 'DELIVRE'"
  );

  const insertChunkStmt = db.prepare(
    'INSERT INTO t_cartes (noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance, ' +
    'contact, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie, agent_distributeur, site_id, centre_id, ' +
    'cle_doublon, cle_doublon_flex, nom_retirant, num_retirant, sync_id, created_at, updated_at, is_dirty) ' +
    'SELECT noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance, ' +
    'contact, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie, agent_distributeur, site_id, centre_id, ' +
    'cle_doublon, cle_doublon_flex, nom_retirant, num_retirant, lower(hex(randomblob(16))), ' +
    '@now, @now, 1 ' +
    'FROM t_import_temp ' +
    'WHERE t_import_temp.id_tmp BETWEEN @startId AND @endId ' +
    'AND NOT EXISTS (SELECT 1 FROM t_cartes WHERE t_cartes.cle_doublon = t_import_temp.cle_doublon AND t_cartes.site_id = t_import_temp.site_id)'
  );

  // Enfilage Outbox des cartes fusionnées par ce chunk (voir chunkTx plus bas) : sélectionne
  // les lignes t_cartes réellement touchées (jointure restreinte à la plage id_tmp de CE chunk,
  // et updated_at = @now pour exclure les lignes non modifiées par la garde métier du UPDATE
  // ci-dessus, ex: statut déjà DELIVRE/ANNULE). SELECT * (plutôt qu'une énumération manuelle de
  // colonnes) réplique fidèlement la structure de payload attendue par mapCardPayload() côté
  // outbox.service.ts, sans risque de drift si le schéma t_cartes évolue.
  const touchedCardsStmt = db.prepare(
    'SELECT t_cartes.* FROM t_cartes ' +
    'JOIN t_import_temp ON t_cartes.cle_doublon = t_import_temp.cle_doublon AND t_cartes.site_id = t_import_temp.site_id ' +
    'WHERE t_import_temp.id_tmp BETWEEN @startId AND @endId ' +
    '  AND t_cartes.updated_at = @now ' +
    '  AND t_cartes.sync_id IS NOT NULL'
  );

  // SQL dupliqué intentionnellement depuis enqueueOutbox() (src/main/sync/outbox.service.ts) —
  // ce worker JS pur non transpilé ne peut pas importer ce module TS. Tenir synchronisé si le
  // schéma t_outbox évolue. Journalisation volontairement omise ici (potentiellement des
  // milliers de cartes par import) pour ne pas dégrader les performances/IO.
  const outboxUpsertStmt = db.prepare(
    'INSERT INTO t_outbox (id, table_name, operation, payload, status, attempts, created_at, error_msg, depends_on) ' +
    "VALUES (@id, 't_cartes', 'UPDATE', @payload, 'PENDING', 0, datetime('now'), NULL, NULL) " +
    'ON CONFLICT(id) DO UPDATE SET ' +
    '  operation = excluded.operation, ' +
    '  payload = excluded.payload, ' +
    "  status = 'PENDING', " +
    '  attempts = 0, ' +
    '  error_msg = NULL, ' +
    '  created_at = excluded.created_at, ' +
    '  depends_on = excluded.depends_on'
  );

  if (maxId >= minId && minId > 0) {
    const totalChunks = Math.ceil((maxId - minId + 1) / CHUNK_SIZE);
    let chunkIndex = 0;

    // --- INSTRUMENTATION AVANCÉE (Phase 3) ---
    const { performance } = require('perf_hooks');
    const fs = require('fs');
    const walPath = workerData.sqlitePath + '-wal';
    
    let fusionStartTime = performance.now();
    let totalUpdateMs = 0;
    let totalInsertMs = 0;
    let totalCommitMs = 0;
    let totalBetweenMs = 0;
    let lastChunkEndTime = fusionStartTime;
    
    const getWalSize = () => {
      try { return fs.statSync(walPath).size; } catch(e) { return 0; }
    };

    // 10. Mesure des PRAGMAs liés à l'environnement d'exécution
    let pragmaStart = performance.now();
    const walAutoCheckpoint = db.pragma('wal_autocheckpoint', { simple: true });
    let pragmaAutoMs = performance.now() - pragmaStart;
    
    pragmaStart = performance.now();
    const journalMode = db.pragma('journal_mode', { simple: true });
    let pragmaJMs = performance.now() - pragmaStart;

    pragmaStart = performance.now();
    const syncMode = db.pragma('synchronous', { simple: true });
    let pragmaSMs = performance.now() - pragmaStart;

    console.log(`\\n[FUSION DIAGNOSTIC] PRAGMA vérifiés: journal_mode=${journalMode} (${pragmaJMs.toFixed(3)}ms), synchronous=${syncMode} (${pragmaSMs.toFixed(3)}ms), wal_autocheckpoint=${walAutoCheckpoint} (${pragmaAutoMs.toFixed(3)}ms)`);

    for (let startId = minId; startId <= maxId; startId += CHUNK_SIZE) {
      const endId = Math.min(maxId, startId + CHUNK_SIZE - 1);

      // 1. Début de la transaction & 4. Temps entre deux
      let chunkStart = performance.now();
      let betweenTxMs = chunkStart - lastChunkEndTime;
      totalBetweenMs += betweenTxMs;

      let chunkUpdateMs = 0;
      let chunkInsertMs = 0;
      let chunkUChanges = 0;
      let chunkIChanges = 0;

      // 8. Taille du fichier .wal avant le COMMIT
      let walSizeBefore = getWalSize();

      // Transaction courte par chunk
      const chunkTx = db.transaction(() => {
        // 2. Temps du UPDATE & 3. Nombre réel
        let uStart = performance.now();
        const uRes = updateChunkStmt.run({ now: now, startId: startId, endId: endId });
        chunkUpdateMs = performance.now() - uStart;
        chunkUChanges = uRes.changes;

        // 4. Temps du INSERT & 5. Nombre réel
        let iStart = performance.now();
        const iRes = insertChunkStmt.run({ now: now, startId: startId, endId: endId });
        chunkInsertMs = performance.now() - iStart;
        chunkIChanges = iRes.changes;

        // Enfilage Outbox (même transaction de chunk) : les cartes importées suivent
        // désormais le circuit standard t_outbox au lieu d'être poussées en direct par
        // upload-worker.js (voir filtre NOT EXISTS ajouté dans ce dernier).
        const touchedCards = touchedCardsStmt.all({ now: now, startId: startId, endId: endId });
        for (const card of touchedCards) {
          outboxUpsertStmt.run({ id: card.sync_id, payload: JSON.stringify(card) });
        }
      });
      
      // 6. Temps exact du COMMIT + 7. Temps du checkpoint WAL (inclus dans le commit SQLite)
      let txWrapperStart = performance.now();
      chunkTx();
      let txWrapperMs = performance.now() - txWrapperStart;
      let commitAndCheckpointMs = Math.max(0, txWrapperMs - chunkUpdateMs - chunkInsertMs);
      
      // 9. Taille du fichier .wal après le COMMIT
      let walSizeAfter = getWalSize();

      // 11. Temps total de chaque transaction
      let chunkTotalMs = performance.now() - chunkStart;

      totalUpdated += chunkUChanges;
      totalInserted += chunkIChanges;
      totalUpdateMs += chunkUpdateMs;
      totalInsertMs += chunkInsertMs;
      totalCommitMs += commitAndCheckpointMs;

      console.log(`[FUSION DIAGNOSTIC] Chunk ${chunkIndex+1}/${totalChunks} | Tx_Total: ${chunkTotalMs.toFixed(2)}ms | UPDATE: ${chunkUChanges} lig (${chunkUpdateMs.toFixed(2)}ms) | INSERT: ${chunkIChanges} lig (${chunkInsertMs.toFixed(2)}ms) | COMMIT/WAL: ${commitAndCheckpointMs.toFixed(2)}ms | WAL_Av: ${(walSizeBefore/1024/1024).toFixed(2)}MB | WAL_Ap: ${(walSizeAfter/1024/1024).toFixed(2)}MB | EntreTX: ${betweenTxMs.toFixed(2)}ms`);

      totalTransactions++;
      chunkIndex++;

      lastChunkEndTime = performance.now();
      const chunkProgress = 82 + Math.round((chunkIndex / totalChunks) * 16);
      parentPort.postMessage({ type: 'progress', value: chunkProgress });
    }

    // 12. Temps cumulé des transactions
    let fusionTotalMs = performance.now() - fusionStartTime;
    console.log(`[FUSION DIAGNOSTIC] === BILAN DE LA FUSION ===
Temps Total (49+ transactions) : ${fusionTotalMs.toFixed(2)}ms
Total UPDATE : ${totalUpdateMs.toFixed(2)}ms (${totalUpdated} lignes)
Total INSERT : ${totalInsertMs.toFixed(2)}ms (${totalInserted} lignes)
Total COMMIT & Auto-Checkpoint WAL : ${totalCommitMs.toFixed(2)}ms
Total Attente Entre Chunks : ${totalBetweenMs.toFixed(2)}ms
Seuil Auto-Checkpoint : ${walAutoCheckpoint} pages (~${(walAutoCheckpoint * 4096 / 1024 / 1024).toFixed(2)} MB)
`);
  }

  parentPort.postMessage({ type: 'progress', value: 98 });

  db.prepare('DELETE FROM t_import_temp').run();

  try {
    const purgeResult = db.prepare(`
      DELETE FROM t_cartes 
      WHERE (noms IS NULL OR noms = '') 
        AND (prenoms IS NULL OR prenoms = '') 
        AND (num_secu IS NULL OR num_secu = '') 
        AND (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')
    `).run();
    if (purgeResult.changes > 0) {
      console.log(`[AUTO-PURGE] ${purgeResult.changes} lignes fantômes supprimées après import.`);
    }
  } catch (err) {
    console.error("[AUTO-PURGE] Échec de la purge après import:", err);
  }

  db.close();

  const durationSeconds = Math.max(1, Math.round((Date.now() - startTime) / 1000));

  console.log(`[IMPORT DIAGNOSTIC] Après import :
Temps total : ${durationSeconds} s
Nombre transactions : ${totalTransactions}
Lignes traitées : ${processedRows}
Lignes vides ignorées : ${totalSkippedEmpty}`);

  parentPort.postMessage({ type: 'progress', value: 100 });
  parentPort.postMessage({
    type: 'done',
    result: { 
      updated: totalUpdated, 
      inserted: totalInserted,
      rejected: totalRejected,
      // totalExcludedFromBatch (dates invalides) est soustrait car ces lignes ne rentrent jamais
      // dans t_import_temp et ne peuvent donc jamais contribuer à totalInserted/totalUpdated ;
      // sans cette soustraction elles gonflaient artificiellement "duplicates". Les anomalies
      // STATUT_INCONNU restent importées malgré l'anomalie tracée, donc déjà comptées plus haut.
      duplicates: Math.max(0, processedRows - totalInserted - totalUpdated - totalExcludedFromBatch),
      probableDuplicates: probableDuplicatesCount,
      duration: durationSeconds,
      totalProcessed: processedRows
    }
  });
}

run().catch(function(e) {
  // Fermeture défensive du WAL : sans ça, une exception survenue en cours de traitement
  // (ex: SqliteError) laisse la connexion ouverte jusqu'à la destruction du thread, ce qui
  // peut laisser le fichier -wal dans un état non checkpointé pour la prochaine ouverture.
  if (workerDb) {
    try {
      workerDb.close();
    } catch (closeErr) {
      console.error('[CSV WORKER] Erreur lors de la fermeture de la base après échec:', closeErr);
    }
  }
  parentPort.postMessage({ type: 'error', error: String(e) });
});

