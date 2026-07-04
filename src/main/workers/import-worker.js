// GEST-IN-SITU Import Worker
// Runs in a separate thread to avoid blocking the Electron UI
const { parentPort, workerData } = require('worker_threads');
const Database = require(workerData.sqlitePath);
const { createReadStream, openSync, readSync, closeSync } = require('fs');
const readline = require('readline');

async function run() {
  const { dbPath, filePath, agent, totalEstimate, siteId, routingTable } = workerData;
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
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      for (let i = 0; i < chunk.length; ++i) {
        if (chunk[i] === 10) count++; // Code ASCII de \n
      }
    });
    stream.on('end', () => resolve(count));
    stream.on('error', (err) => reject(err));
  });

  const rawCount = await countLinesFast(filePath);
  const total = rawCount > 0 ? rawCount - 1 : 220000;

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

  function resolveRouting(rawRangement) {
    const cleanRangement = removeAccents(rawRangement || '');
    if (!cleanRangement) {
      return { site_id: siteId, centre_id: null, rangement: 'NON CLASSE' };
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
    return { site_id: siteId, centre_id: null, rangement: upper };
  }

  const db = new Database(dbPath);
  db.pragma('busy_timeout = 60000');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');
  db.pragma('foreign_keys = OFF');

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

  const BATCH_SIZE = 5000;
  const insertManyTx = db.transaction(function(items) {
    for (var i = 0; i < items.length; i++) {
      insertStmt.run(items[i]);
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

  function normalizeContact(contactStr) {
    if (!contactStr) return '+225 00 00 00 00 00';
    let digits = contactStr.toString().replace(/\D/g, '');
    let localNumber = '';

    if (digits.startsWith('225')) {
      localNumber = digits.slice(3);
    } else {
      localNumber = digits;
    }

    if (localNumber.length !== 10) {
      return '+225 00 00 00 00 00';
    }

    const part1 = localNumber.slice(0, 2);
    const part2 = localNumber.slice(2, 4);
    const part3 = localNumber.slice(4, 6);
    const part4 = localNumber.slice(6, 8);
    const part5 = localNumber.slice(8, 10);

    return `+225 ${part1} ${part2} ${part3} ${part4} ${part5}`;
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
    num_secu:          ['NUM SECU', 'NUM_SECU', 'NUMERO SECURITE', 'ID CMU', 'NUMERO CMU', 'NUM CMU'],
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
    return normalizeContact(digits); // → format +225 XX XX XX XX XX
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
  var lineCount = 0;
  var processedRows = 0;
  var sep = ';';

  // Date du jour précalculée une seule fois pour toute la session d'import.
  // Réutilisée comme fallback absolu dans les Chemins A et B.
  var TODAY_ISO = new Date().toISOString().split('T')[0]; // ex: '2026-07-02'

  for await (const line of rl) {
    if (!line.trim()) continue;
    if (lineCount === 0) {
      // Détection du séparateur
      sep = line.includes(';') ? ';' : ',';
      headers = line.split(sep).map(function(h) { return h.trim().replace(/"/g, ''); });
      // MISSION 1 : Construire la carte canonique des colonnes
      colMap = buildColumnMap(headers);
      console.log('[CSV WORKER] Column map resolved:', JSON.stringify(colMap));
    } else {
      try {
        var cols = line.split(sep).map(function(c) { return c.trim().replace(/^"|"$/g, ''); });

        // Lecture sécurisée des colonnes via colMap (insensible aux accents et casse)
        var noms     = removeAccents(getCol(cols, colMap, 'noms', 'nom') || '');
        var prenoms  = removeAccents(getCol(cols, colMap, 'prenoms', 'prenom') || '');
        var ddn      = cleanBirthDate(getCol(cols, colMap, 'date_de_naissance', 'ddn') || '');
        var lieuN    = removeAccents(getCol(cols, colMap, 'lieu_de_naissance') || '');
        var contact  = normalizeContact(getCol(cols, colMap, 'contact', 'telephone') || '');

        // ============================================================
        // MISSION 2 — ParseStatutSemantique : Arbre de décision complet
        // ============================================================
        var rawStatut = removeAccents((getCol(cols, colMap, 'statut', 'etat') || '').trim());

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
          // ============================================================
          finalStatut = normaliserStatut(rawStatut);
        }

        var resolved = resolveRouting(getCol(cols, colMap, 'rangement') || '');

        batch.push({
          noms: noms,
          prenoms: prenoms,
          date_de_naissance: ddn,
          num_secu: (getCol(cols, colMap, 'num_secu', 'num_secu') || '').trim(),
          lieu_de_naissance: lieuN,
          contact: contact,
          lieu_enrolement: removeAccents(getCol(cols, colMap, 'lieu_enrolement') || ''),
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

        processedRows++;
      } catch (lineError) {
        console.error(`[CSV WORKER] Ligne corrompue détectée à la ligne #${lineCount}: "${line}"`, lineError);
      }

      // Flush du batch EN DEHORS du try-catch per-ligne — synchrone direct, aucune Promise
      if (batch.length >= BATCH_SIZE) {
        insertManyTx(batch);
        batch = [];
        var val = Math.min(Math.round((processedRows / total) * 80), 80);
        if (val !== lastProgressValue) {
          lastProgressValue = val;
          parentPort.postMessage({ type: 'progress', value: val });
        }
      }
    }
    lineCount++;
    if (lineCount % 1000 === 0) {
      console.log(`[CSV WORKER] Traitement en cours... ${lineCount} lignes analysées.`);
    }
  }

  if (batch.length > 0) {
    insertManyTx(batch);
  }

  parentPort.postMessage({ type: 'progress', value: 82 });

  // Index composite pour accélérer le NOT EXISTS de la fusion
  db.exec('CREATE INDEX IF NOT EXISTS idx_cartes_cle_site ON t_cartes(cle_doublon, site_id);');
  // Index sur la table temporaire
  db.exec("CREATE INDEX IF NOT EXISTS idx_import_temp_cle_flex ON t_import_temp(cle_doublon_flex);");

  // Fusion phase - transactions courtes par chunk pour éviter la saturation du WAL
  var now = new Date().toISOString();
  
  // Désactiver les triggers de modification de cartes pour éviter de surcharger FTS5 durant la fusion en lot
  db.exec('DROP TRIGGER IF EXISTS trg_cartes_ai;');
  db.exec('DROP TRIGGER IF EXISTS trg_cartes_ad;');
  db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');

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

  if (maxId >= minId && minId > 0) {
    const totalChunks = Math.ceil((maxId - minId + 1) / CHUNK_SIZE);
    let chunkIndex = 0;

    for (let startId = minId; startId <= maxId; startId += CHUNK_SIZE) {
      const endId = Math.min(maxId, startId + CHUNK_SIZE - 1);

      // Transaction courte par chunk : commit fréquent = WAL ne sature jamais
      const chunkTx = db.transaction(() => {
        const uRes = updateChunkStmt.run({ now: now, startId: startId, endId: endId });
        const iRes = insertChunkStmt.run({ now: now, startId: startId, endId: endId });
        totalUpdated += uRes.changes;
        totalInserted += iRes.changes;
      });
      chunkTx();

      chunkIndex++;
      const chunkProgress = 82 + Math.round((chunkIndex / totalChunks) * 16);
      parentPort.postMessage({ type: 'progress', value: chunkProgress });
    }
  }

  parentPort.postMessage({ type: 'progress', value: 98 });

  // Recréer les déclencheurs standards
  db.exec(`
    CREATE TRIGGER trg_cartes_ai AFTER INSERT ON t_cartes BEGIN
      INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
    END;
  `);
  db.exec(`
    CREATE TRIGGER trg_cartes_ad AFTER DELETE ON t_cartes BEGIN
      DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
    END;
  `);
  db.exec(`
    CREATE TRIGGER trg_cartes_au AFTER UPDATE ON t_cartes BEGIN
      DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
      INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
      VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
    END;
  `);

  // Reconstruction FTS5 via commande native 'rebuild' — ultra-rapide, pas de DROP/CREATE
  db.exec("INSERT INTO t_cartes_fts(t_cartes_fts) VALUES('rebuild');");


  db.prepare('DELETE FROM t_import_temp').run();
  db.close();

  parentPort.postMessage({ type: 'progress', value: 100 });
  parentPort.postMessage({
    type: 'done',
    result: { updated: totalUpdated, inserted: totalInserted }
  });
}

run().catch(function(e) {
  parentPort.postMessage({ type: 'error', error: String(e) });
});

