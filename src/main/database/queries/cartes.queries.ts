import { getDatabase } from '../connection';
import { v4 as uuidv4 } from 'uuid';
import { enqueueOutbox, scheduleOutboxProcessing, cancelPendingInsert } from '../../sync/outbox.service';
import { networkMonitor } from '../../sync/network-monitor';
import { mapCardPayload } from '../../sync/payload-mapper';
import { insertAuditLog } from './audit.queries';
import { QualityFilters } from '../../../shared/types/quality.types';
import log from 'electron-log';
import { isValidDateStrict } from '../../../shared/utils/validators';
import { normalizeDate } from '../../../shared/utils/date';

/**
 * Enfile automatiquement une carte tout juste corrigée (Qualité) vers t_outbox pour une
 * synchronisation cloud immédiate, à condition qu'elle n'ait plus de doublon (strict ou
 * probable) non résolu. Les données manquantes ne bloquent PAS l'enfilage (règle métier
 * déjà validée pour le bouton "Envoyer les corrections") ; une date encore invalide ou une
 * identité totalement vide fait échouer mapCardPayload, ce qui est volontaire : la carte
 * reste is_dirty=1 et sera reprise plus tard par l'envoi manuel groupé.
 */
function autoEnqueueCorrection(id_carte: number): void {
  try {
    const db = getDatabase()!;
    const card = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id_carte) as any;
    if (!card || !card.sync_id || !card.site_id) return;

    if (card.cle_doublon && card.cle_doublon !== '' && card.cle_doublon !== '||||') {
      const strictDup = db.prepare(`
        SELECT COUNT(*) as c FROM t_cartes WHERE site_id = ? AND cle_doublon = ?
      `).get(card.site_id, card.cle_doublon) as { c: number };
      if (strictDup.c > 1) return;
    }

    const probableDup = db.prepare(`
      SELECT COUNT(DISTINCT cle_doublon) as c FROM t_cartes
      WHERE site_id = ? AND noms = ? AND prenoms = ? AND date_de_naissance = ?
    `).get(card.site_id, card.noms, card.prenoms, card.date_de_naissance) as { c: number };
    if (probableDup.c > 1) return;

    // Validation uniquement (voir commentaire ci-dessus) : le résultat mappé
    // n'est PAS ce qui est enfilé — outbox.service.ts applique déjà
    // mapCardPayload() lui-même au moment de l'envoi. L'enfiler une seconde
    // fois ici casserait la validation ("site_id manquant") car le payload
    // mappé porte id_site/id_centre, pas site_id/centre_id (double-mapping,
    // bug confirmé).
    mapCardPayload(card);
    enqueueOutbox(card.sync_id, 't_cartes', 'UPDATE', card);
    if (networkMonitor.getState() === 'ONLINE') {
      // forceCards=true : ce helper ne traite QUE des corrections unitaires (jamais un
      // import massif — le worker d'import a son propre chemin d'écriture direct, distinct
      // de autoEnqueueCorrection), donc l'envoi immédiat doit être forcé indépendamment du
      // toggle "Envoi Automatique" du compte, qui ne doit protéger que les imports massifs.
      scheduleOutboxProcessing(true);
    }
  } catch (e: any) {
    log.warn(`[AutoSync] Carte ${id_carte} non enfilée automatiquement après correction : ${e.message || e}`);
  }
}

/** Reset nucléaire de l'index FTS5 : DROP + CREATE + REBUILD pour réparer une corruption profonde */
export function nuclearResetFts5(): void {
  setImmediate(() => {
    const db = getDatabase();
    if (!db) return;
    try {
      log.warn('[FTS5] Début du reset nucléaire (DROP + CREATE + REBUILD)...');
      // 1. Supprimer les 3 triggers FTS5 liés à t_cartes
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_ai;');
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_ad;');
      // 2. Supprimer la table virtuelle FTS5 (et toutes ses shadow tables)
      db.exec('DROP TABLE IF EXISTS t_cartes_fts;');
      // 3. Recréer la table FTS5 proprement
      db.exec(`CREATE VIRTUAL TABLE t_cartes_fts USING fts5(
        noms, prenoms, num_secu, contact, lieu_de_naissance, rangement,
        content='t_cartes', content_rowid='id_carte'
      );`);
      // 4. Repeupler depuis t_cartes (content table)
      db.exec("INSERT INTO t_cartes_fts(t_cartes_fts) VALUES('rebuild');");
      // 5. Recréer les 3 triggers
      db.exec(`CREATE TRIGGER trg_cartes_ai AFTER INSERT ON t_cartes BEGIN
        INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
        VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
      END;`);
      db.exec(`CREATE TRIGGER trg_cartes_ad AFTER DELETE ON t_cartes BEGIN
        DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
      END;`);
      db.exec(`CREATE TRIGGER trg_cartes_au AFTER UPDATE ON t_cartes BEGIN
        DELETE FROM t_cartes_fts WHERE rowid = old.id_carte;
        INSERT INTO t_cartes_fts(rowid, noms, prenoms, num_secu, contact, lieu_de_naissance, rangement)
        VALUES (new.id_carte, new.noms, new.prenoms, new.num_secu, new.contact, new.lieu_de_naissance, new.rangement);
      END;`);
      log.info('[FTS5] Reset nucléaire terminé avec succès. Recherche plein texte restaurée.');
    } catch (resetErr) {
      log.error('[FTS5] Échec du reset nucléaire FTS5 :', resetErr);
    }
  });
}

function removeAccents(str: string): string {
  if (!str) return '';
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function normalizeContact(contactStr: string): string {
  if (!contactStr) return '';
  let cleaned = contactStr.replace(/\D/g, '');
  if (cleaned.startsWith('225') && cleaned.length > 10) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.length > 10) {
    cleaned = cleaned.substring(cleaned.length - 10);
  }
  return cleaned;
}

// Cache pour optimiser la pagination (les requêtes COUNT(*) peuvent être lourdes sur de grandes tables)
const paginationCountCache = new Map<string, { count: number; timestamp: number }>();
const COUNT_CACHE_TTL = 10000; // 10 secondes

function getCachedCount(db: any, query: string, params: any): number {
  const cacheKey = query + JSON.stringify(params);
  const now = Date.now();
  const cached = paginationCountCache.get(cacheKey);
  
  if (cached && (now - cached.timestamp < COUNT_CACHE_TTL)) {
    return cached.count;
  }
  
  const result = (Array.isArray(params) 
    ? db.prepare(query).get(...params) 
    : db.prepare(query).get(params)) as { count: number };
  
  // Nettoyage basique pour éviter une fuite de mémoire (limite empirique à 500 requêtes en cache)
  if (paginationCountCache.size > 500) {
    paginationCountCache.clear();
  }
  
  paginationCountCache.set(cacheKey, { count: result.count, timestamp: now });
  return result.count;
}

export function getCartesPage(offset: number, limit: number, filters?: Record<string, string>) {
  const db = getDatabase()!;
  let where = 'WHERE is_dirty != -1';
  const params: any = {};

  if (filters?.statut) { where += ' AND statut = @statut'; params.statut = filters.statut; }
  if (filters?.site_id) { where += ' AND site_id = @site_id'; params.site_id = Number(filters.site_id); }
  if (filters?.centre_id) { where += ' AND centre_id = @centre_id'; params.centre_id = Number(filters.centre_id); }
  if (filters?.rangement) { where += " AND rangement LIKE @rangement"; params.rangement = `%${filters.rangement}%`; }
  if (filters?.statut_physique) { where += ' AND statut_physique = @statut_physique'; params.statut_physique = filters.statut_physique; }
  if (filters?.created_by) { where += ' AND created_by = @created_by'; params.created_by = Number(filters.created_by); }
  if (filters?.agent_saisie) { where += ' AND agent_saisie = @agent_saisie'; params.agent_saisie = filters.agent_saisie; }
  
  if (filters?.q || filters?.search) {
    const q = filters.q || filters.search;
    where += " AND (noms LIKE @q OR prenoms LIKE @q OR (noms || ' ' || prenoms) LIKE @q OR (prenoms || ' ' || noms) LIKE @q OR num_secu LIKE @q OR contact LIKE @q OR lieu_de_naissance LIKE @q OR rangement LIKE @q)";
    params.q = `%${q}%`;
  }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const totalCount = getCachedCount(db, countQuery, params);
  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  return { rows, total: totalCount, offset, limit };
}

export function searchCartesFTS(query: string, limit = 100, filters?: Record<string, string>) {
  const db = getDatabase()!;
  
  const params: Record<string, any> = { limit };
  let hasFilters = false;
  let filtersSql = ' AND t_cartes.is_dirty != -1';

  if (filters?.date_de_naissance) {
    filtersSql += ' AND t_cartes.date_de_naissance = @date_de_naissance';
    params.date_de_naissance = normalizeDate(filters.date_de_naissance);
    hasFilters = true;
  }
  if (filters?.lieu_de_naissance) {
    filtersSql += ' AND t_cartes.lieu_de_naissance LIKE @lieu_de_naissance';
    params.lieu_de_naissance = `%${filters.lieu_de_naissance}%`;
    hasFilters = true;
  }
  if (filters?.contact) {
    filtersSql += ' AND t_cartes.contact LIKE @contact';
    let finalContactParam = filters.contact;
    if (finalContactParam) {
      if (!finalContactParam.startsWith('%')) {
        finalContactParam = `%${finalContactParam}%`;
      }
    }
    params.contact = finalContactParam;
    hasFilters = true;
  }
  if (filters?.site_id) {
    filtersSql += ' AND t_cartes.site_id = @site_id';
    params.site_id = Number(filters.site_id);
    hasFilters = true;
  }

  // Sécurité (cloisonnement §3, P0-5) : filtre centre_id — additif, ignoré par tous les appels
  // existants qui ne le fournissent pas (cmu:searchCarte notamment), n'altère donc aucun
  // comportement en place. Ajouté pour permettre à cartes:search de restreindre les résultats
  // au centre réel de la session ADMIN_CENTRE (fuite PII confirmée : téléphone/num CMU d'un
  // bénéficiaire d'un autre centre remontés en recherche normale sans ce filtre).
  if (filters?.centre_id) {
    filtersSql += ' AND t_cartes.centre_id = @centre_id';
    params.centre_id = Number(filters.centre_id);
    hasFilters = true;
  }

  if (filters?.exclude_delivered === 'true') {
    filtersSql += " AND t_cartes.statut = 'EN STOCK'";
    hasFilters = true;
  }

  if (!query.trim()) {
    let nonFtsQuery = `SELECT t_cartes.*, t_sites.nom as site_nom, t_centres.nom as centre_nom FROM t_cartes LEFT JOIN t_sites ON t_cartes.site_id = t_sites.id LEFT JOIN t_centres ON t_cartes.centre_id = t_centres.id WHERE t_cartes.is_dirty != -1`;
    if (filters?.date_de_naissance) nonFtsQuery += ' AND t_cartes.date_de_naissance = @date_de_naissance';
    if (filters?.lieu_de_naissance) nonFtsQuery += ' AND t_cartes.lieu_de_naissance LIKE @lieu_de_naissance';
    if (filters?.contact) nonFtsQuery += ' AND t_cartes.contact LIKE @contact';
    if (filters?.site_id) nonFtsQuery += ' AND t_cartes.site_id = @site_id';
    if (filters?.centre_id) nonFtsQuery += ' AND t_cartes.centre_id = @centre_id';
    if (filters?.exclude_delivered === 'true') nonFtsQuery += " AND t_cartes.statut = 'EN STOCK'";
    nonFtsQuery += ' ORDER BY t_cartes.id_carte DESC LIMIT @limit';
    
    return db.prepare(nonFtsQuery).all(params);
  }

  const ftsQuery = query.split(/\s+/).map(w => `"${w}"*`).join(' ');
  params.query = ftsQuery;
  
  return db.prepare(`
    SELECT t_cartes.*, t_sites.nom as site_nom, t_centres.nom as centre_nom FROM t_cartes_fts
    JOIN t_cartes ON t_cartes_fts.rowid = t_cartes.id_carte
    LEFT JOIN t_sites ON t_cartes.site_id = t_sites.id
    LEFT JOIN t_centres ON t_cartes.centre_id = t_centres.id
    WHERE t_cartes_fts MATCH @query
    ${filtersSql}
    ORDER BY rank
    LIMIT @limit
  `).all(params);
}

export function getCarteById(id: number, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    const row = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ? AND site_id = ? AND is_dirty != -1').get(id, currentUser.site_id);
    if (!row) throw new Error("Accès non autorisé aux données de ce site");
    return row;
  }
  return db.prepare('SELECT * FROM t_cartes WHERE id_carte = ? AND is_dirty != -1').get(id);
}



export function createCarte(data: Record<string, unknown>, siteIdToUse: number) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const syncId = uuidv4();
  
  const noms = removeAccents(data.noms as string || '');
  const prenoms = removeAccents(data.prenoms as string || '');
  const ddn = data.date_de_naissance as string || '';
  const lieuN = removeAccents(data.lieu_de_naissance as string || '');
  const contact = normalizeContact(data.contact as string || '');

  // Règle métier brouillon (cf. SaisiePage.tsx handleSave) : en mode BROUILLON, aucun champ
  // n'est obligatoire (seul un nom/prénom/CMU minimal est requis côté renderer). La validation
  // stricte de la date ne doit donc s'appliquer qu'en mode final (statut !== 'BROUILLON') ;
  // elle sera de toute façon réappliquée à la publication du brouillon.
  if (data.statut !== 'BROUILLON' && !isValidDateStrict(ddn)) {
    throw new Error("Date de naissance invalide. Format attendu : AAAA-MM-JJ (ex : 1990-12-31).");
  }

  const dateDelivrance = data.date_delivrance as string || '';
  if (dateDelivrance && !isValidDateStrict(dateDelivrance)) {
    throw new Error("Date de délivrance invalide. Format attendu : AAAA-MM-JJ.");
  }

  const cleDbl = `${noms}|${prenoms}|${ddn}|${lieuN}|${contact}`;
  const cleFlex = `${noms}|${prenoms}|${ddn}|${contact}`;

  // Vérification stricte de doublon avant insertion
  const existingStrict = db.prepare(`
    SELECT id_carte, noms, prenoms FROM t_cartes 
    WHERE cle_doublon = ? AND is_dirty != -1
  `).get(cleDbl) as { id_carte: number; noms: string; prenoms: string } | undefined;

  if (existingStrict) {
    throw new Error(
      `DOUBLON_STRICT: La carte de ${existingStrict.noms} ${existingStrict.prenoms} ` +
      `(ID: ${existingStrict.id_carte}) existe déjà dans la base locale.`
    );
  }

  const stmt = db.prepare(`
    INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
      lieu_enrolement, contact, rangement, statut, agent_saisie, centre_id, poste_id,
      cle_doublon, cle_doublon_flex, sync_id, site_id, created_at, updated_at, is_dirty, created_by)
    VALUES (@noms, @prenoms, @date_de_naissance, @lieu_de_naissance, @num_secu,
      @lieu_enrolement, @contact, @rangement, @statut, @agent_saisie, @centre_id, @poste_id,
      @cle_doublon, @cle_doublon_flex, @sync_id, @site_id, @created_at, @updated_at, 1, @created_by)
  `);

  const result = stmt.run({
    noms,
    prenoms,
    date_de_naissance: ddn || null,
    lieu_de_naissance: lieuN,
    num_secu: data.num_secu || null,
    lieu_enrolement: removeAccents(data.lieu_enrolement as string || ''),
    contact,
    rangement: removeAccents(data.rangement as string || ''),
    statut: data.statut || 'EN STOCK',
    agent_saisie: data.agent_saisie || 'SYSTEM',
    centre_id: data.centre_id || null,
    poste_id: data.poste_id || null,
    cle_doublon: cleDbl,
    cle_doublon_flex: cleFlex,
    sync_id: syncId,
    site_id: siteIdToUse,
    created_at: now,
    updated_at: now,
    created_by: data.created_by || null
  });

  // L'envoi automatique est désactivé pour permettre un workflow de synchronisation 100% manuel via le bouton Envoyer vers le Cloud.
  // Toute carte insérée a is_dirty = 1, ce qui permet à l'action manuelle de la détecter.

  return { id: result.lastInsertRowid, sync_id: syncId };
}

export function updateCarte(id: number, data: Record<string, unknown>, currentUser?: { role: string; site_id?: number; login?: string; id_user?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();

  if ('date_de_naissance' in data) {
    const ddn = data.date_de_naissance as string;
    if (ddn && !isValidDateStrict(ddn)) {
      throw new Error("Date de naissance invalide. Format attendu : AAAA-MM-JJ (ex : 1990-12-31).");
    }
  }

  if ('date_delivrance' in data) {
    const dateDelivrance = data.date_delivrance as string;
    if (dateDelivrance && !isValidDateStrict(dateDelivrance)) {
      throw new Error("Date de délivrance invalide. Format attendu : AAAA-MM-JJ.");
    }
  }

  // Revalidation serveur des formats sensibles (P0-2) : ne pas se reposer uniquement sur la
  // validation du formulaire client (CorrectionSidePanel). Mêmes regex que qualite:corrigerFormat
  // (handlers.ts) pour rester cohérent — appliquée avant toute écriture, pour les deux branches
  // ci-dessous (standard et transfert d'anomalie).
  if ('num_secu' in data) {
    const numSecu = data.num_secu as string | null | undefined;
    if (numSecu && !/^\d{13}$/.test(numSecu)) {
      throw new Error('Le numéro de sécurité sociale doit faire exactement 13 chiffres.');
    }
  }
  if ('contact' in data) {
    const contact = data.contact as string | null | undefined;
    if (contact && !/^\d{10}$/.test(contact)) {
      throw new Error('Le contact doit faire exactement 10 chiffres locaux.');
    }
  }

  const isAnomaly = data._recordType === 'En Anomalie' || data._recordType === 'AnomalieImport';

  if (isAnomaly) {
    const tx = db.transaction(() => {
      // 1. Lire l'anomalie d'origine
      const anomaly = db.prepare('SELECT * FROM t_import_anomalies WHERE id = ?').get(id) as any;
      if (!anomaly) {
        throw new Error("Anomalie introuvable ou déjà corrigée.");
      }

      // Cloisonnement site (P0-1) : une anomalie n'appartenant pas au site de l'utilisateur
      // (hors SUPER ADMIN) ne doit jamais pouvoir être transférée vers t_cartes par ce canal.
      // Même logique que la vérification déjà appliquée par qualite:fusionnerDoublons (handlers.ts).
      if (currentUser && currentUser.role !== 'SUPER ADMIN' && anomaly.site_id !== currentUser.site_id) {
        throw new Error("Accès refusé : cette anomalie n'appartient pas à votre site.");
      }

      // 2. Fusionner avec les nouvelles données
      const mergedData = { ...anomaly, ...data };
      
      const noms = removeAccents(mergedData.noms || anomaly.noms || '');
      const prenoms = removeAccents(mergedData.prenoms || anomaly.prenoms || '');
      const ddn = mergedData.date_de_naissance || anomaly.date_de_naissance || null;
      const lieuN = removeAccents(mergedData.lieu_de_naissance || anomaly.lieu_de_naissance || '');
      const num_secu = mergedData.num_secu || anomaly.num_secu || null;
      const contact = normalizeContact(mergedData.contact || anomaly.contact || '');
      const rangement = removeAccents(mergedData.rangement || anomaly.rangement || '');
      const lieu_enrolement = removeAccents(mergedData.lieu_enrolement || anomaly.lieu_enrolement || '');
      
      const cleDbl = `${noms}|${prenoms}|${ddn || ''}|${lieuN}|${contact}`;
      const cleFlex = `${noms}|${prenoms}|${ddn || ''}|${contact}`;
      
      const newSyncId = uuidv4();
      const siteId = anomaly.site_id || (currentUser?.site_id || 1);
      
      // 3. Insérer dans t_cartes avec statut EN STOCK
      const stmt = db.prepare(`
        INSERT INTO t_cartes (noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
          lieu_enrolement, contact, rangement, statut, sync_id, site_id, cle_doublon, cle_doublon_flex, is_dirty, updated_at)
        VALUES (@noms, @prenoms, @date_de_naissance, @lieu_de_naissance, @num_secu,
          @lieu_enrolement, @contact, @rangement, 'EN STOCK', @sync_id, @site_id, @cle_doublon, @cle_doublon_flex, 1, @updated_at)
      `);
      stmt.run({
        noms, prenoms, date_de_naissance: ddn, lieu_de_naissance: lieuN,
        num_secu, lieu_enrolement, contact, rangement, sync_id: newSyncId,
        site_id: siteId, cle_doublon: cleDbl, cle_doublon_flex: cleFlex, updated_at: now
      });

      // 4. Supprimer de t_import_anomalies
      db.prepare('DELETE FROM t_import_anomalies WHERE id = ?').run(id);

      // 5. Trace d'audit
      insertAuditLog(
        currentUser?.login || 'SYSTEM',
        'VALIDATION',
        `[CORRECTION ANOMALIE] Anomalie (ID: ${id}) corrigée et transférée vers t_cartes avec le sync_id: ${newSyncId}`
      );
      
      return { changes: 1 };
    });
    return tx();
  }

  // Comportement standard pour t_cartes

  // Recalcul de la clé anti-doublon si un champ d'identité est modifié (ex: correction
  // d'un brouillon). Sans cela, cle_doublon reste figée sur les anciennes valeurs et le
  // contrôle de doublon à la création (createCarte) devient inopérant pour cette fiche.
  const identityFields = ['noms', 'prenoms', 'date_de_naissance', 'lieu_de_naissance', 'contact'];
  if (identityFields.some(f => f in data)) {
    const current = db.prepare(
      'SELECT noms, prenoms, date_de_naissance, lieu_de_naissance, contact FROM t_cartes WHERE id_carte = ?'
    ).get(id) as { noms: string; prenoms: string; date_de_naissance: string; lieu_de_naissance: string; contact: string } | undefined;

    if (current) {
      const noms = removeAccents((('noms' in data ? data.noms : current.noms) as string) || '');
      const prenoms = removeAccents((('prenoms' in data ? data.prenoms : current.prenoms) as string) || '');
      const ddn = (('date_de_naissance' in data ? data.date_de_naissance : current.date_de_naissance) as string) || '';
      const lieuN = removeAccents((('lieu_de_naissance' in data ? data.lieu_de_naissance : current.lieu_de_naissance) as string) || '');
      const contact = normalizeContact((('contact' in data ? data.contact : current.contact) as string) || '');

      const cleDbl = `${noms}|${prenoms}|${ddn}|${lieuN}|${contact}`;
      const cleFlex = `${noms}|${prenoms}|${ddn}|${contact}`;

      const existingStrict = db.prepare(`
        SELECT id_carte, noms, prenoms FROM t_cartes
        WHERE cle_doublon = ? AND is_dirty != -1 AND id_carte != ?
      `).get(cleDbl, id) as { id_carte: number; noms: string; prenoms: string } | undefined;

      if (existingStrict) {
        throw new Error(
          `DOUBLON_STRICT: La carte de ${existingStrict.noms} ${existingStrict.prenoms} ` +
          `(ID: ${existingStrict.id_carte}) existe déjà dans la base locale.`
        );
      }

      data.cle_doublon = cleDbl;
      data.cle_doublon_flex = cleFlex;
    }
  }

  const allowedColumns = [
    'noms', 'prenoms', 'date_de_naissance', 'lieu_de_naissance', 'num_secu',
    'lieu_enrolement', 'contact', 'rangement', 'statut', 'date_delivrance',
    'agent_saisie', 'nom_retirant', 'num_retirant', 'agent_distributeur',
    'centre_retrait', 'cle_doublon', 'cle_doublon_flex', 'statut_physique',
    'site_id', 'centre_id', 'poste_id', 'qr_code_data', 'sync_id', 'is_dirty', 'is_exported', 'created_by', 'updated_by'
  ];
  
  if (currentUser && (currentUser as any).id_user) {
    data.updated_by = (currentUser as any).id_user;
  }
  const filteredKeys = Object.keys(data).filter(k => k !== '_recordType' && allowedColumns.includes(k));
  if (filteredKeys.length === 0) {
    return { changes: 0 };
  }
  
  const fields = filteredKeys.map(k => `${k} = @${k}`).join(', ');
  
  let query = `UPDATE t_cartes SET ${fields}, updated_at = @updated_at, is_dirty = 1 WHERE id_carte = @id`;
  const params: any = {};
  filteredKeys.forEach(k => {
    params[k] = data[k];
  });
  params.updated_at = now;
  params.id = id;
  
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    query += ' AND site_id = @site_id';
    params.site_id = currentUser.site_id;
  }

  // Verrou serveur pour l'opérateur de saisie : ne peut modifier que ses propres
  // fiches encore non synchronisées (is_dirty = 1), même si l'appel IPC est forgé.
  if (currentUser && currentUser.role === 'OPERATEUR_SAISIE') {
    query += ' AND is_dirty = 1 AND created_by = @created_by_check';
    params.created_by_check = currentUser.id_user ?? null;
  }

  let result: any;
  try {
    result = db.prepare(query).run(params);
  } catch (err: any) {
    if (err.code === 'SQLITE_CORRUPT_VTAB' || (err.message && (err.message.includes('malformed') || err.message.includes('corrupt')))) {
      log.warn('[updateCarte] FTS5 shadow tables corrompues. Suppression du trigger pour UPDATE sécurisé...');
      // Étape 1 : supprimer IMMÉDIATEMENT le trigger de mise à jour FTS5
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
      // Étape 2 : exécuter l'UPDATE sans trigger (pas de contact avec FTS5)
      result = db.prepare(query).run(params);
      log.info('[updateCarte] Mise à jour exécutée sans FTS5. Reset nucléaire planifié en arrière-plan...');
      // Étape 3 : reset nucléaire complet FTS5 en arrière-plan (non bloquant)
      nuclearResetFts5();
    } else {
      throw err;
    }
  }
  if (!result || result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site ou ligne introuvable.");
  }

  // La synchronisation automatique a été désactivée.
  // L'envoi vers Supabase est 100% manuel et basé sur is_dirty = 1.

  return result;
}

export function deleteCarte(id: number, currentUser?: { role: string; site_id?: number; login?: string }) {
  const db = getDatabase()!;

  // Lire les données de la carte en premier pour vérifier son statut
  const carte = db.prepare('SELECT sync_id, site_id, centre_id, statut FROM t_cartes WHERE id_carte = ?').get(id) as { sync_id: string | null; site_id: number; centre_id: number; statut: string } | undefined;
  if (!carte) {
    return { changes: 0 };
  }

  // 1. Validation de l'autorisation : réservé aux administrateurs et opérateurs qualité
  // OU si c'est un OPERATEUR_SAISIE qui supprime un BROUILLON
  let isAllowed = false;
  if (!currentUser) {
    isAllowed = true;
  } else if (['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE', 'OPERATEUR_QUALITE'].includes(currentUser.role)) {
    isAllowed = true;
  } else if (currentUser.role === 'OPERATEUR_SAISIE' && carte.statut === 'BROUILLON') {
    isAllowed = true;
  }

  if (!isAllowed) {
    throw new Error("Accès non autorisé : Rôle insuffisant pour supprimer une carte.");
  }

  if (currentUser && currentUser.role !== 'SUPER ADMIN' && carte.site_id !== currentUser.site_id) {
    throw new Error("Accès non autorisé aux données de ce site");
  }

  // Trace d'audit
  insertAuditLog(
    currentUser?.login || 'ADMIN',
    'VALIDATION',
    `[SUPPRESSION] Par ${currentUser?.login || 'ADMIN'} sur t_cartes (ID: ${id})`
  );

  // 2. Marquer la carte en pending_delete local (is_dirty = -1) au lieu de la supprimer
  // physiquement, et enfiler l'outbox DELETE correspondant dans la même transaction SQLite
  // (P2-2) : l'UPDATE is_dirty et l'enfilage t_outbox doivent réussir ou échouer ensemble,
  // à l'image du pattern déjà utilisé dans qualite:fusionnerDoublons (handlers.ts).
  const tx = db.transaction(() => {
    const res = db.prepare("UPDATE t_cartes SET is_dirty = -1, updated_at = datetime('now') WHERE id_carte = ?").run(id);
    if (res.changes === 0) {
      throw new Error("Accès non autorisé aux données de ce site");
    }

    // 3. Enfilage Outbox DELETE
    if (carte.sync_id) {
      const wasLocalOnly = cancelPendingInsert(carte.sync_id, 't_cartes');
      if (!wasLocalOnly) {
        enqueueOutbox(carte.sync_id, 't_cartes', 'DELETE', { sync_id: carte.sync_id });
        if (networkMonitor.getState() === 'ONLINE') {
          // forceCards=true : suppression unitaire d'une carte (une seule par appel), jamais
          // un import massif — doit échapper au toggle "Envoi Automatique" (même principe que
          // autoEnqueueCorrection() plus haut).
          scheduleOutboxProcessing(true);
        }
      } else {
        // Si la carte n'a jamais été synchronisée (local uniquement), suppression physique immédiate
        db.prepare('DELETE FROM t_cartes WHERE id_carte = ?').run(id);
      }
    }

    return res;
  });

  return tx();
}

export function delivrerCarte(
  id: number, 
  data: { nom_retirant: string; num_retirant: string; contact_retirant?: string; type_retirant?: string; agent_distributeur: string; centre_retrait?: string; rangement?: string }, 
  currentUser?: { role: string; site_id?: number; id_user?: number; login?: string; centre_id?: number }
) {
  const db = getDatabase()!;
  
  const siteIdToUse = currentUser?.role === 'SUPER ADMIN' ? null : (currentUser?.site_id ?? null);

  const runTx = db.transaction(() => {
    // Vérifier l'existence et l'accès à la carte
    const carte = db.prepare('SELECT contact, sync_id, site_id, centre_id, statut, rangement FROM t_cartes WHERE id_carte = ? AND (? IS NULL OR site_id = ?)').get(id, siteIdToUse, siteIdToUse) as { contact: string | null; sync_id: string | null; site_id: number; centre_id: number | null; statut: string; rangement: string | null } | undefined;

    if (!carte) {
      throw new Error("Carte introuvable, déjà distribuée, ou accès non autorisé pour votre site.");
    }

    // Même règle que isUnclassifiedCard côté front (useDeliveryFlow.ts) : une carte sans
    // rangement exploitable est considérée non classée.
    const isUnclassified = !carte.rangement || carte.rangement.trim() === '' || carte.rangement.trim().toUpperCase() === 'NON CLASSE';

    // Garde serveur (tous rôles) : le rangement d'urgence, déjà imposé côté client pour une
    // carte non classée, doit aussi l'être ici — un appel IPC direct ne doit pas pouvoir le contourner.
    if (isUnclassified && (!data.rangement || data.rangement.trim() === '')) {
      throw new Error("Le rangement d'urgence est obligatoire pour cette carte.");
    }

    if (currentUser && (currentUser.role === 'OPERATEUR_VERIFICATION' || currentUser.role === 'ADMIN_CENTRE')) {
      if (carte.site_id !== currentUser.site_id) {
        throw new Error("Action refusée : Cette carte appartient à un autre site.");
      }
      if (!isUnclassified && carte.centre_id !== currentUser.centre_id) {
        throw new Error("Action refusée : Cette carte appartient à un autre centre de distribution.");
      }
    }

    // Double verrou DOUBLON (plan validé) : une carte déclarée DOUBLON (déclaration manuelle,
    // cf. declarerDoublon() ci-dessous) ne doit plus jamais être délivrable, quel que soit le
    // circuit emprunté — celui-ci (délivrance classique) ou updateApurementHistorique()
    // (cahier historique). Blocage immédiat, avant toute écriture.
    if (carte.statut === 'DOUBLON') {
      throw new Error("Action refusée : cette carte est déclarée en doublon et ne peut plus être délivrée. Contactez un administrateur pour vérifier ou annuler cette déclaration.");
    }

    let contactToUpdate = null;
    let contactChanged = false;

    // Si le retirant est l'ASSURE, on met à jour le contact si celui fourni est différent
    if (data.type_retirant === 'ASSURE' && data.num_retirant) {
      if (carte.contact !== data.num_retirant) {
        contactToUpdate = data.num_retirant;
        contactChanged = true;
      }
    }

    const now = new Date().toISOString();
    
    // Traçabilité de la modification
    if (contactChanged) {
      insertAuditLog(
        currentUser?.login || 'ADMIN',
        'UPDATE_CONTACT',
        `[MISE A JOUR CONTACT] Retrait par l'assuré: ancien ${carte.contact || 'vide'}, nouveau ${contactToUpdate} (ID: ${id})`
      );
    }

    // Rattachement centre_id : une carte non classée délivrée avec un rangement d'urgence
    // saisi se voit désormais affecter le centre de l'opérateur qui l'a physiquement retrouvée
    // (elle n'en avait pas de fiable jusqu'ici) ; sinon centre_id reste inchangé (COALESCE).
    const centreIdOverride = (isUnclassified && data.rangement && data.rangement.trim() !== '' && currentUser?.centre_id != null && (currentUser.role === 'OPERATEUR_VERIFICATION' || currentUser.role === 'ADMIN_CENTRE'))
      ? currentUser.centre_id
      : null;

    const query = `
      UPDATE t_cartes SET
        statut = 'DELIVRE',
        date_delivrance = @now,
        nom_retirant = @nom_retirant,
        num_retirant = @num_retirant,
        contact_retirant = @contact_retirant,
        contact = COALESCE(@contact_to_update, contact),
        agent_distributeur = @agent_distributeur,
        centre_retrait = @centre_retrait,
        rangement = COALESCE(@rangement, rangement),
        centre_id = COALESCE(@centre_id_override, centre_id),
        updated_at = @now,
        updated_by = @updated_by,
        is_dirty = 1
      WHERE id_carte = @id
    `;

    const params: any = {
      id,
      nom_retirant: data.nom_retirant,
      num_retirant: data.num_retirant,
      contact_retirant: data.contact_retirant || null,
      contact_to_update: contactToUpdate,
      agent_distributeur: data.agent_distributeur,
      centre_retrait: data.centre_retrait || null,
      rangement: data.rangement || null,
      centre_id_override: centreIdOverride,
      now,
      updated_by: currentUser?.id_user || null
    };
    
    const result = db.prepare(query).run(params);

    if (result.changes === 0) {
      throw new Error("Erreur lors de la mise à jour de la carte.");
    }

    // Synchroniser vers Supabase — on relit la ligne fraîchement mise à jour
    // (payload complet, avec site_id) : un payload minimal { sync_id } fait
    // systématiquement échouer mapCardPayload() côté outbox.service.ts ("site_id
    // manquant"), l'entrée outbox part alors en ERROR définitif sans jamais
    // atteindre Supabase via ce chemin immédiat (bug confirmé, voir historique).
    if (carte.sync_id) {
      const updatedCarte = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
      enqueueOutbox(carte.sync_id, 't_cartes', 'UPDATE', updatedCarte);
      if (networkMonitor.getState() === 'ONLINE') {
        // forceCards=true : délivrance unitaire d'une carte (une seule par appel), jamais un
        // import massif — doit échapper au toggle "Envoi Automatique" (même principe que
        // autoEnqueueCorrection() plus haut).
        scheduleOutboxProcessing(true);
      }
    }

    return result;
  });

  // Miroir du garde-fou déjà en place dans updateCarte() (ligne ~463 plus haut) :
  // trg_cartes_au (déclenché ici par le UPDATE ci-dessus, qui touche toujours contact/
  // rangement via COALESCE) peut remonter "database disk image is malformed" en cas de
  // corruption des shadow tables FTS5 — un incident déjà rencontré et documenté sur
  // updateCarte(), mais qui plantait ici de façon non rattrapée (transaction annulée dans
  // son intégralité, l'utilisateur perd son action de délivrance sans recours). On applique
  // le même remède éprouvé : supprimer le trigger fautif, rejouer la même transaction
  // (sûr — le premier essai a été intégralement annulé par SQLite, aucun état partiel),
  // puis planifier un reset nucléaire FTS5 en arrière-plan.
  try {
    return runTx();
  } catch (err: any) {
    if (err.code === 'SQLITE_CORRUPT_VTAB' || (err.message && (err.message.includes('malformed') || err.message.includes('corrupt')))) {
      log.warn('[delivrerCarte] FTS5 shadow tables corrompues. Suppression du trigger pour délivrance sécurisée...');
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
      const result = runTx();
      log.info('[delivrerCarte] Délivrance exécutée sans FTS5. Reset nucléaire planifié en arrière-plan...');
      nuclearResetFts5();
      return result;
    }
    throw err;
  }
}

/**
 * Déclare manuellement une carte comme DOUBLON — blocage immédiat de la délivrance, sur les
 * deux circuits existants (délivrance classique via delivrerCarte() ET émargement rétroactif
 * du cahier historique via updateApurementHistorique(), voir les verrous ajoutés dans ces deux
 * fonctions ci-dessus/ci-dessous). Traçabilité obligatoire (auteur + date + motif), jamais
 * écrasée silencieusement, même après une annulation ultérieure (cf.
 * annulerDeclarationDoublon()). Utilisée par l'Opérateur Vérification (le requérant affirme
 * déjà détenir la carte, faite ailleurs) et l'Opérateur Apurement (cahier d'émargement
 * rétroactif) — le RBAC exact (rôles autorisés) est appliqué côté IPC handler
 * (cartes:declarerDoublon), jamais ici.
 */
export function declarerDoublon(
  id: number,
  motif: string,
  currentUser?: { role: string; site_id?: number; id_user?: number; login?: string; centre_id?: number }
) {
  const db = getDatabase()!;

  const siteIdToUse = currentUser?.role === 'SUPER ADMIN' ? null : (currentUser?.site_id ?? null);

  const runTx = db.transaction(() => {
    // Vérifier l'existence et l'accès à la carte — même modèle de cloisonnement que delivrerCarte()
    const carte = db.prepare('SELECT sync_id, site_id, centre_id, statut, doublon_declare_par, doublon_declare_le, rangement FROM t_cartes WHERE id_carte = ? AND (? IS NULL OR site_id = ?)').get(id, siteIdToUse, siteIdToUse) as { sync_id: string | null; site_id: number; centre_id: number | null; statut: string; doublon_declare_par: string | null; doublon_declare_le: string | null; rangement: string | null } | undefined;

    if (!carte) {
      throw new Error("Carte introuvable, ou accès non autorisé pour votre site.");
    }

    // Même règle que isUnclassifiedCard côté front (useDeliveryFlow.ts) et que delivrerCarte()
    // ci-dessus : une carte sans rangement exploitable est considérée non classée, et ne doit
    // pas être bloquée par le centre_id d'import par défaut de la carte.
    const isUnclassified = !carte.rangement || carte.rangement.trim() === '' || carte.rangement.trim().toUpperCase() === 'NON CLASSE';

    if (currentUser && (currentUser.role === 'OPERATEUR_VERIFICATION' || currentUser.role === 'ADMIN_CENTRE')) {
      if (carte.site_id !== currentUser.site_id) {
        throw new Error("Action refusée : Cette carte appartient à un autre site.");
      }
      if (!isUnclassified && carte.centre_id !== currentUser.centre_id) {
        throw new Error("Action refusée : Cette carte appartient à un autre centre de distribution.");
      }
    }

    if (carte.statut === 'DELIVRE') {
      throw new Error("Cette carte a déjà été délivrée — utilisez la preuve de retrait existante, contactez un administrateur en cas de suspicion de fraude.");
    }

    if (carte.statut === 'DOUBLON') {
      throw new Error(`Cette carte est déjà déclarée en doublon depuis le ${carte.doublon_declare_le || 'date inconnue'} par ${carte.doublon_declare_par || 'un agent inconnu'}.`);
    }

    const now = new Date().toISOString();

    const query = `
      UPDATE t_cartes SET
        statut = 'DOUBLON',
        statut_avant_doublon = @statut_avant_doublon,
        doublon_declare_par = @declare_par,
        doublon_declare_le = @now,
        doublon_motif = @motif,
        updated_at = @now,
        updated_by = @updated_by,
        is_dirty = 1
      WHERE id_carte = @id
    `;

    const params: any = {
      id,
      statut_avant_doublon: carte.statut,
      declare_par: currentUser?.login || 'ADMIN',
      motif,
      now,
      updated_by: currentUser?.id_user || null
    };

    const result = db.prepare(query).run(params);

    if (result.changes === 0) {
      throw new Error("Erreur lors de la déclaration du doublon.");
    }

    // Synchroniser vers Supabase — même mécanisme (payload complet relu) que delivrerCarte(),
    // pour les mêmes raisons (un payload minimal { sync_id } fait échouer mapCardPayload()).
    if (carte.sync_id) {
      const updatedCarte = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
      enqueueOutbox(carte.sync_id, 't_cartes', 'UPDATE', updatedCarte);
      if (networkMonitor.getState() === 'ONLINE') {
        // forceCards=true : déclaration de doublon unitaire (une seule carte par appel),
        // jamais un import massif — doit échapper au toggle "Envoi Automatique" (même
        // principe que autoEnqueueCorrection() plus haut).
        scheduleOutboxProcessing(true);
      }
    }

    return result;
  });

  // Filet de rattrapage FTS5 repris de delivrerCarte() par cohérence avec le mécanisme déjà
  // éprouvé sur ce trigger. Coût nul en pratique : cette UPDATE ne touche pas les colonnes
  // surveillées par trg_cartes_au (noms/prenoms/num_secu/contact/lieu_de_naissance/rangement),
  // le trigger ne se déclenchant donc pas ici — filet purement défensif si sa définition venait
  // à évoluer.
  try {
    return runTx();
  } catch (err: any) {
    if (err.code === 'SQLITE_CORRUPT_VTAB' || (err.message && (err.message.includes('malformed') || err.message.includes('corrupt')))) {
      log.warn('[declarerDoublon] FTS5 shadow tables corrompues. Suppression du trigger pour déclaration sécurisée...');
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
      const result = runTx();
      log.info('[declarerDoublon] Déclaration exécutée sans FTS5. Reset nucléaire planifié en arrière-plan...');
      nuclearResetFts5();
      return result;
    }
    throw err;
  }
}

/**
 * Annule une déclaration de doublon — restaure le statut antérieur exact
 * (statut_avant_doublon, ou 'EN STOCK' par défaut si absent faute d'historique) et journalise
 * l'annulation (auteur + date + motif). Les colonnes de la déclaration d'origine
 * (doublon_declare_par/le/motif) ne sont JAMAIS effacées ni réécrites ici : l'historique de la
 * déclaration initiale reste consultable même après annulation. Réservé aux rôles SUPER ADMIN /
 * ADMINISTRATEUR_SITE / ADMIN_CENTRE (jamais l'opérateur qui a déclaré) — le RBAC exact est
 * appliqué côté IPC handler (cartes:annulerDoublon), jamais ici.
 */
export function annulerDeclarationDoublon(
  id: number,
  motifAnnulation: string,
  currentUser?: { role: string; site_id?: number; id_user?: number; login?: string; centre_id?: number }
) {
  const db = getDatabase()!;

  const siteIdToUse = currentUser?.role === 'SUPER ADMIN' ? null : (currentUser?.site_id ?? null);

  const runTx = db.transaction(() => {
    const carte = db.prepare('SELECT sync_id, site_id, centre_id, statut FROM t_cartes WHERE id_carte = ? AND (? IS NULL OR site_id = ?)').get(id, siteIdToUse, siteIdToUse) as { sync_id: string | null; site_id: number; centre_id: number | null; statut: string } | undefined;

    if (!carte) {
      throw new Error("Carte introuvable, ou accès non autorisé pour votre site.");
    }

    if (currentUser && currentUser.role === 'ADMIN_CENTRE') {
      if (carte.centre_id !== currentUser.centre_id || carte.site_id !== currentUser.site_id) {
        throw new Error("Action refusée : Cette carte appartient à un autre centre de distribution.");
      }
    }

    if (carte.statut !== 'DOUBLON') {
      throw new Error("Cette carte n'est pas déclarée en doublon — aucune annulation à effectuer.");
    }

    const now = new Date().toISOString();

    const query = `
      UPDATE t_cartes SET
        statut = COALESCE(statut_avant_doublon, 'EN STOCK'),
        doublon_annule_par = @annule_par,
        doublon_annule_le = @now,
        doublon_motif_annulation = @motif_annulation,
        updated_at = @now,
        updated_by = @updated_by,
        is_dirty = 1
      WHERE id_carte = @id
    `;

    const params: any = {
      id,
      annule_par: currentUser?.login || 'ADMIN',
      motif_annulation: motifAnnulation,
      now,
      updated_by: currentUser?.id_user || null
    };

    const result = db.prepare(query).run(params);

    if (result.changes === 0) {
      throw new Error("Erreur lors de l'annulation de la déclaration de doublon.");
    }

    if (carte.sync_id) {
      const updatedCarte = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
      enqueueOutbox(carte.sync_id, 't_cartes', 'UPDATE', updatedCarte);
      if (networkMonitor.getState() === 'ONLINE') {
        // forceCards=true : annulation de déclaration de doublon unitaire (une seule carte par
        // appel), jamais un import massif — doit échapper au toggle "Envoi Automatique" (même
        // principe que autoEnqueueCorrection() plus haut).
        scheduleOutboxProcessing(true);
      }
    }

    return result;
  });

  // Filet de rattrapage FTS5 — voir commentaire équivalent dans declarerDoublon() ci-dessus.
  try {
    return runTx();
  } catch (err: any) {
    if (err.code === 'SQLITE_CORRUPT_VTAB' || (err.message && (err.message.includes('malformed') || err.message.includes('corrupt')))) {
      log.warn('[annulerDeclarationDoublon] FTS5 shadow tables corrompues. Suppression du trigger pour annulation sécurisée...');
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
      const result = runTx();
      log.info('[annulerDeclarationDoublon] Annulation exécutée sans FTS5. Reset nucléaire planifié en arrière-plan...');
      nuclearResetFts5();
      return result;
    }
    throw err;
  }
}

export function transfererCarte(
  id: number,
  data: { centre_id: number; rangement?: string; agent_transfert: string },
  currentUser?: { role: string; site_id?: number, login?: string, id_user?: number }
) {
  const db = getDatabase()!;
  const now = new Date().toISOString();

  // Sécurité (cloisonnement §3, même modèle que delivrerCarte() ci-dessus) : pour tout rôle
  // non-SUPER-ADMIN, vérifie côté serveur que la carte source ET le centre cible appartiennent
  // bien au site_id de l'appelant — avant ce correctif, aucune de ces deux appartenances
  // n'était contrôlée, permettant un transfert cross-site via un id/centre_id forgé.
  const siteIdToUse = currentUser?.role === 'SUPER ADMIN' ? null : (currentUser?.site_id ?? null);

  if (siteIdToUse !== null) {
    const carte = db.prepare('SELECT site_id, sync_id FROM t_cartes WHERE id_carte = ? AND statut = ?').get(id, 'EN STOCK') as { site_id: number; sync_id: string | null } | undefined;
    if (!carte || carte.site_id !== siteIdToUse) {
      throw new Error("Carte introuvable, déjà distribuée, ou accès non autorisé pour votre site.");
    }

    const centre = db.prepare('SELECT site_id FROM t_centres WHERE id = ?').get(data.centre_id) as { site_id: number } | undefined;
    if (!centre || centre.site_id !== siteIdToUse) {
      throw new Error("Action refusée : le centre de destination n'appartient pas à votre site.");
    }
  }

  const query = `
    UPDATE t_cartes SET
      centre_id = @centre_id,
      rangement = COALESCE(@rangement, rangement),
      updated_at = @now,
      updated_by = @updated_by,
      is_dirty = 1
    WHERE id_carte = @id AND statut = 'EN STOCK'
  `;
  const params: any = {
    id,
    centre_id: data.centre_id,
    rangement: data.rangement || null,
    now,
    updated_by: currentUser?.id_user || null
  };

  // Même garde-fou FTS5 que delivrerCarte()/updateCarte() : cette UPDATE touche toujours
  // `rangement` (COALESCE), donc déclenche systématiquement trg_cartes_au.
  let result: any;
  try {
    result = db.prepare(query).run(params);
  } catch (err: any) {
    if (err.code === 'SQLITE_CORRUPT_VTAB' || (err.message && (err.message.includes('malformed') || err.message.includes('corrupt')))) {
      log.warn('[transfererCarte] FTS5 shadow tables corrompues. Suppression du trigger pour transfert sécurisé...');
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
      result = db.prepare(query).run(params);
      log.info('[transfererCarte] Transfert exécuté sans FTS5. Reset nucléaire planifié en arrière-plan...');
      nuclearResetFts5();
    } else {
      throw err;
    }
  }

  if (result.changes === 0) {
    throw new Error("Carte introuvable ou n'est plus EN STOCK.");
  }

  // Synchronisation Supabase (même modèle que delivrerCarte() ci-dessus) — placé après
  // confirmation du succès de l'UPDATE (guard FTS5 + vérification result.changes ci-dessus).
  // Relecture complète du sync_id ici (plutôt que de dépendre de la variable `carte` du bloc
  // de garde ci-dessus, qui n'existe que pour les rôles non-SUPER-ADMIN) pour couvrir tous les
  // appelants, y compris SUPER ADMIN.
  const updatedCarte = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
  if (updatedCarte?.sync_id) {
    enqueueOutbox(updatedCarte.sync_id, 't_cartes', 'UPDATE', updatedCarte);
    if (networkMonitor.getState() === 'ONLINE') {
      // forceCards=true : transfert unitaire d'une carte (une seule par appel), jamais un
      // import massif — doit échapper au toggle "Envoi Automatique" (même principe que
      // autoEnqueueCorrection() plus haut).
      scheduleOutboxProcessing(true);
    }
  }

  return result;
}

export function getExportRows(filters?: Record<string, string>) {
  const db = getDatabase()!;
  let where = 'WHERE 1=1';
  const params: Record<string, any> = {};

  if (filters?.site_id) {
    where += ' AND site_id = @siteId';
    params.siteId = Number(filters.site_id);
  }
  if (filters?.statut) {
    where += ' AND statut = @statut';
    params.statut = filters.statut;
  }
  if (filters?.export_status === 'exported') {
    where += ' AND is_exported = 1';
  } else if (filters?.export_status === 'pending') {
    where += ' AND (is_exported = 0 OR is_exported IS NULL)';
  }

  return db.prepare(`
    SELECT noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
      contact, rangement, statut, date_delivrance, nom_retirant, num_retirant,
      agent_saisie, agent_distributeur, centre_retrait, created_at, site_id, cle_doublon
    FROM t_cartes ${where}
    ORDER BY id_carte
  `).all(params);
}

export function getDistinctRangements(siteId?: number) {
  const db = getDatabase()!;
  let query = `
    SELECT DISTINCT rangement 
    FROM t_cartes 
    WHERE rangement IS NOT NULL AND rangement != '' AND rangement != 'NON CLASSE'
  `;
  const params: Record<string, any> = {};
  if (siteId) {
    query += ' AND site_id = @siteId';
    params.siteId = siteId;
  }
  query += ' ORDER BY rangement ASC';
  return db.prepare(query).all(params).map((row: any) => row.rangement);
}

export function marquerCartesExporte(ids: number[]) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE t_cartes SET is_exported = 1, is_dirty = 1, updated_at = ? WHERE id_carte = ?');
  const runTx = db.transaction((idList: number[]) => {
    for (const id of idList) {
      stmt.run(now, id);
    }
  });
  runTx(ids);
}

export function exportCartes(ids: number[]) {
  return marquerCartesExporte(ids);
}


export function getInvalidDateRecords(siteId?: number, offset = 0, limit = 50, query?: string) {
  const db = getDatabase()!;
  const params: any[] = [];
  
  let baseWhere = "";
  if (siteId) {
    baseWhere = "AND site_id = ?";
    params.push(siteId);
    params.push(siteId); // For the second part of UNION
  }
  
  let searchWhere = "";
  if (query && query.trim()) {
    const tokens = query.trim().split(/\s+/);
    tokens.forEach(t => {
      searchWhere += " AND ((COALESCE(noms, '') || ' ' || COALESCE(prenoms, '')) LIKE ? OR COALESCE(contact, '') LIKE ? OR COALESCE(num_secu, '') LIKE ? OR CAST(id_carte AS TEXT) LIKE ?)";
      const q = `%${t}%`;
      params.push(q, q, q, q);
    });
  }

  // Common CTE to unify both tables
  const sql = `
    WITH UnifiedInvalidDates AS (
      SELECT
        id_carte,
        noms,
        prenoms,
        date_de_naissance,
        num_secu,
        contact,
        site_id,
        rangement,
        lieu_de_naissance,
        lieu_enrolement,
        statut,
        't_cartes' AS source
      FROM t_cartes
      WHERE (date_de_naissance IS NULL OR TRIM(date_de_naissance) = '' OR LENGTH(TRIM(date_de_naissance)) < 10 OR date_de_naissance NOT LIKE '%-%-%')
        ${baseWhere}
        
      UNION ALL
      
      SELECT
        id AS id_carte,
        noms,
        prenoms,
        date_de_naissance,
        num_secu,
        contact,
        site_id,
        rangement,
        lieu_de_naissance,
        NULL AS lieu_enrolement,
        NULL AS statut,
        't_import_anomalies' AS source
      FROM t_import_anomalies
      WHERE type_anomalie = 'DATE_INVALIDE'
        ${baseWhere}
    )
  `;

  const totalRow = db.prepare(`${sql} SELECT COUNT(*) as count FROM UnifiedInvalidDates WHERE 1=1 ${searchWhere}`).get(...params) as { count: number };
  const total = totalRow?.count || 0;

  const rows = db.prepare(`${sql} SELECT * FROM UnifiedInvalidDates WHERE 1=1 ${searchWhere} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { rows, total };
}

export function getDatesVidesPage(siteId?: number, offset = 0, limit = 50, query?: string) {
  const db = getDatabase()!;
  const params: any[] = [];
  
  let baseWhere = "";
  if (siteId) {
    baseWhere = "AND site_id = ?";
    params.push(siteId);
  }
  
  let searchWhere = "";
  if (query && query.trim()) {
    const tokens = query.trim().split(/\s+/);
    tokens.forEach(t => {
      searchWhere += " AND ((COALESCE(noms, '') || ' ' || COALESCE(prenoms, '')) LIKE ? OR COALESCE(contact, '') LIKE ? OR COALESCE(num_secu, '') LIKE ? OR CAST(id_carte AS TEXT) LIKE ?)";
      const q = `%${t}%`;
      params.push(q, q, q, q);
    });
  }

  const sql = `
    SELECT
      id_carte, noms, prenoms, date_de_naissance, num_secu, contact, site_id, rangement, lieu_de_naissance, lieu_enrolement, statut, 't_cartes' AS source
    FROM t_cartes
    WHERE (date_de_naissance IS NULL OR TRIM(date_de_naissance) = '')
      ${baseWhere}
  `;

  const totalRow = db.prepare(`SELECT COUNT(*) as count FROM (${sql}) WHERE 1=1 ${searchWhere}`).get(...params) as { count: number };
  const total = totalRow?.count || 0;

  const rows = db.prepare(`SELECT * FROM (${sql}) WHERE 1=1 ${searchWhere} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { rows, total };
}

export function updateDateDeNaissance(id: number, newDate: string) {
  const db = getDatabase()!;
  const now = new Date().toISOString();

  // Vérifier si la fiche correspond à une anomalie d'importation (DLQ)
  const anomaly = db.prepare('SELECT * FROM t_import_anomalies WHERE id = ?').get(id) as any;

  if (anomaly) {
    const runTx = db.transaction(() => {
      const noms = removeAccents(anomaly.noms || '');
      const prenoms = removeAccents(anomaly.prenoms || '');
      const ddn = newDate;
      const lieuN = removeAccents(anomaly.lieu_de_naissance || '');
      const contact = normalizeContact(anomaly.contact || '');
      
      const cleDbl = `${noms}|${prenoms}|${ddn}|${lieuN}|${contact}`;
      const cleFlex = `${noms}|${prenoms}|${ddn}|${contact}`;
      const syncId = uuidv4();

      const insertRes = db.prepare(`
        INSERT INTO t_cartes (
          noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu,
          lieu_enrolement, contact, rangement, statut, agent_saisie,
          cle_doublon, cle_doublon_flex, sync_id, site_id, created_at, updated_at, is_dirty, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        noms,
        prenoms,
        ddn,
        lieuN,
        anomaly.num_secu || null,
        removeAccents(anomaly.lieu_enrolement || ''),
        contact,
        removeAccents(anomaly.rangement || ''),
        anomaly.statut || 'EN STOCK',
        'CORRECTION',
        cleDbl,
        cleFlex,
        syncId,
        anomaly.site_id,
        now,
        now,
        'CORRECTION'
      );

      db.prepare('DELETE FROM t_import_anomalies WHERE id = ?').run(id);

      // Écriture atomique (P2-2) : l'enfilage outbox de la carte tout juste transférée fait
      // désormais partie de la même transaction SQLite que l'INSERT/DELETE ci-dessus, au lieu
      // d'être exécuté après coup — même exigence que le pattern qualite:fusionnerDoublons.
      // autoEnqueueCorrection avale déjà ses propres erreurs en interne (voir sa doc : une
      // donnée encore invalide ne doit pas bloquer le transfert, la carte reste is_dirty=1),
      // donc cet appel ne peut pas provoquer de rollback inattendu de la transaction.
      autoEnqueueCorrection(Number(insertRes.lastInsertRowid));

      return insertRes;
    });

    const res = runTx();
    console.log(`[CORRECTION DIAGNOSTIC] ✨ Anomalie ID ${id} corrigée. Carte transférée avec succès vers t_cartes et purgée de la DLQ.`);
    return res;
  }

  const res = db.prepare(`
    UPDATE t_cartes
    SET date_de_naissance = ?, updated_at = ?, is_dirty = 1
    WHERE id_carte = ?
  `).run(newDate, now, id);
  autoEnqueueCorrection(id);
  return res;
}

export function getDoublonsStrictsPage(siteId: number, offset: number, limit: number, query?: string, filters?: QualityFilters) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND is_dirty != -1 AND cle_doublon IS NOT NULL AND cle_doublon != '' AND cle_doublon != '||||'";
  const params: any[] = [siteId];

  const effectiveNom = filters?.nom || query || '';
  if (effectiveNom.trim()) {
    const tokens = effectiveNom.trim().split(/\\s+/);
    tokens.forEach(t => {
      where += " AND ((COALESCE(noms, '') || ' ' || COALESCE(prenoms, '')) LIKE ? OR (COALESCE(prenoms, '') || ' ' || COALESCE(noms, '')) LIKE ? OR contact LIKE ?)";
      const q = `%${t}%`;
      params.push(q, q, q);
    });
  }
  if (filters?.contact?.trim()) { where += " AND contact LIKE ?"; params.push(`%${filters.contact}%`); }
  if (filters?.ddn?.trim())     { where += " AND date_de_naissance = ?"; params.push(filters.ddn.trim()); }
  if (filters?.lieu?.trim())    { where += " AND lieu_de_naissance LIKE ?"; params.push(`%${filters.lieu}%`); }

  const totalRow = db.prepare(`
    SELECT SUM(c - 1) as count FROM (
      SELECT COUNT(*) as c FROM t_cartes ${where} GROUP BY cle_doublon HAVING COUNT(*) > 1
    )
  `).get(...params) as { count: number | null };
  const total = totalRow?.count || 0;

  const duplicateKeys = db.prepare(`
    SELECT cle_doublon, COUNT(*) as count 
    FROM t_cartes 
    ${where}
    GROUP BY cle_doublon 
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset) as { cle_doublon: string, count: number }[];

  const rows: any[] = [];
  if (duplicateKeys.length > 0) {
    const keys = duplicateKeys.map(k => k.cle_doublon);
    const placeholders = keys.map(() => '?').join(',');
    const sql = `SELECT * FROM t_cartes WHERE site_id = ? AND cle_doublon IN (${placeholders}) ORDER BY cle_doublon, id_carte`;
    rows.push(...db.prepare(sql).all(siteId, ...keys));
  }

  return { rows, total };
}

export function getDoublonsProbablesPage(siteId: number, offset: number, limit: number, query?: string, filters?: QualityFilters) {
  const db = getDatabase()!;
  
  let filterClause = "";
  const filterParams: any[] = [];
  
  const effectiveNom = filters?.nom || query || '';
  if (effectiveNom.trim()) {
    const tokens = effectiveNom.trim().split(/\\s+/);
    tokens.forEach(t => {
      filterClause += " AND ((COALESCE(noms, '') || ' ' || COALESCE(prenoms, '')) LIKE ? OR (COALESCE(prenoms, '') || ' ' || COALESCE(noms, '')) LIKE ? OR contact LIKE ?)";
      const q = `%${t}%`;
      filterParams.push(q, q, q);
    });
  }
  if (filters?.contact?.trim()) { filterClause += " AND contact LIKE ?"; filterParams.push(`%${filters.contact}%`); }
  if (filters?.ddn?.trim())     { filterClause += " AND date_de_naissance = ?"; filterParams.push(filters.ddn.trim()); }
  if (filters?.lieu?.trim())    { filterClause += " AND lieu_de_naissance LIKE ?"; filterParams.push(`%${filters.lieu}%`); }

  const totalQuery = `
    SELECT SUM(c - 1) as count FROM (
      SELECT COUNT(*) as c
      FROM t_cartes
      WHERE site_id = ? AND is_dirty != -1 ${filterClause}
      GROUP BY noms, prenoms, date_de_naissance
      HAVING COUNT(DISTINCT cle_doublon) > 1
    )
  `;
  const totalRow = db.prepare(totalQuery).get(siteId, ...filterParams) as { count: number | null };
  const total = totalRow?.count || 0;

  const groupsQuery = `
    SELECT noms, prenoms, date_de_naissance
    FROM t_cartes
    WHERE site_id = ? AND is_dirty != -1 ${filterClause}
    GROUP BY noms, prenoms, date_de_naissance
    HAVING COUNT(DISTINCT cle_doublon) > 1
    ORDER BY noms ASC, prenoms ASC
    LIMIT ? OFFSET ?
  `;
  const groups = db.prepare(groupsQuery).all(siteId, ...filterParams, limit, offset) as any[];

  const rows: any[] = [];
  if (groups.length > 0) {
    const subClauses: string[] = [];
    const subParams: any[] = [siteId];
    
    groups.forEach(g => {
      subClauses.push("(noms = ? AND prenoms = ? AND date_de_naissance = ?)");
      subParams.push(g.noms, g.prenoms, g.date_de_naissance);
    });

    const sql = `
      SELECT * 
      FROM t_cartes 
      WHERE site_id = ? AND is_dirty != -1
        AND (${subClauses.join(' OR ')})
      ORDER BY noms ASC, prenoms ASC, id_carte ASC
    `;
    rows.push(...db.prepare(sql).all(...subParams));
  }

  return { rows, total };
}

export function getDoublonsProbablesPage_UNUSED_KEEP(siteId: number, offset: number, limit: number, query?: string) { // kept for reference
  return { rows: [], total: 0 };
}

export function getSansNumSecuPage(siteId: number, offset: number, limit: number, query?: string, filters?: QualityFilters) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND is_dirty != -1 AND (num_secu IS NULL OR num_secu = '' OR num_secu LIKE '-%')";
  const params: any[] = [siteId];

  const effectiveNom = filters?.nom || query || '';
  if (effectiveNom.trim()) {
    const tokens = effectiveNom.trim().split(/\\s+/);
    tokens.forEach(t => {
      where += " AND ((COALESCE(noms, '') || ' ' || COALESCE(prenoms, '')) LIKE ? OR (COALESCE(prenoms, '') || ' ' || COALESCE(noms, '')) LIKE ? OR contact LIKE ?)";
      const q = `%${t}%`;
      params.push(q, q, q);
    });
  }
  if (filters?.contact?.trim()) { where += " AND contact LIKE ?"; params.push(`%${filters.contact}%`); }
  if (filters?.ddn?.trim())     { where += " AND date_de_naissance = ?"; params.push(filters.ddn.trim()); }
  if (filters?.lieu?.trim())    { where += " AND lieu_de_naissance LIKE ?"; params.push(`%${filters.lieu}%`); }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const total = getCachedCount(db, countQuery, params) || 0;
  
  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function getSansRangementPage(siteId: number, offset: number, limit: number, query?: string, filters?: QualityFilters) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND is_dirty != -1 AND (rangement IS NULL OR rangement = '' OR rangement = 'NON CLASSE')";
  const params: any[] = [siteId];

  const effectiveNom = filters?.nom || query || '';
  if (effectiveNom.trim()) {
    const tokens = effectiveNom.trim().split(/\\s+/);
    tokens.forEach(t => {
      where += " AND ((COALESCE(noms, '') || ' ' || COALESCE(prenoms, '')) LIKE ? OR (COALESCE(prenoms, '') || ' ' || COALESCE(noms, '')) LIKE ? OR contact LIKE ?)";
      const q = `%${t}%`;
      params.push(q, q, q);
    });
  }
  if (filters?.contact?.trim()) { where += " AND contact LIKE ?"; params.push(`%${filters.contact}%`); }
  if (filters?.ddn?.trim())     { where += " AND date_de_naissance = ?"; params.push(filters.ddn.trim()); }
  if (filters?.lieu?.trim())    { where += " AND lieu_de_naissance LIKE ?"; params.push(`%${filters.lieu}%`); }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const total = getCachedCount(db, countQuery, params) || 0;

  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function getSansNomPage(siteId: number, offset: number, limit: number, query?: string, filters?: QualityFilters) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND is_dirty != -1 AND (noms IS NULL OR noms = '')";
  const params: any[] = [siteId];

  const effectiveNom = filters?.nom || query || '';
  if (effectiveNom.trim()) {
    const tokens = effectiveNom.trim().split(/\\s+/);
    tokens.forEach(t => {
      where += " AND (prenoms LIKE ? OR contact LIKE ?)";
      const q = `%${t}%`;
      params.push(q, q);
    });
  }
  if (filters?.contact?.trim()) { where += " AND contact LIKE ?"; params.push(`%${filters.contact}%`); }
  if (filters?.ddn?.trim())     { where += " AND date_de_naissance = ?"; params.push(filters.ddn.trim()); }
  if (filters?.lieu?.trim())    { where += " AND lieu_de_naissance LIKE ?"; params.push(`%${filters.lieu}%`); }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const total = getCachedCount(db, countQuery, params) || 0;

  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function getSansPrenomPage(siteId: number, offset: number, limit: number, query?: string, filters?: QualityFilters) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND is_dirty != -1 AND (prenoms IS NULL OR prenoms = '')";
  const params: any[] = [siteId];

  const effectiveNom = filters?.nom || query || '';
  if (effectiveNom.trim()) {
    const tokens = effectiveNom.trim().split(/\\s+/);
    tokens.forEach(t => {
      where += " AND (noms LIKE ? OR contact LIKE ?)";
      const q = `%${t}%`;
      params.push(q, q);
    });
  }
  if (filters?.contact?.trim()) { where += " AND contact LIKE ?"; params.push(`%${filters.contact}%`); }
  if (filters?.ddn?.trim())     { where += " AND date_de_naissance = ?"; params.push(filters.ddn.trim()); }
  if (filters?.lieu?.trim())    { where += " AND lieu_de_naissance LIKE ?"; params.push(`%${filters.lieu}%`); }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const total = getCachedCount(db, countQuery, params) || 0;

  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function updateQuickFields(id: number, fields: {
  num_secu?: string;
  rangement?: string;
  noms?: string;
  prenoms?: string;
  contact?: string;
  lieu_de_naissance?: string;
  date_de_naissance?: string;
  sexe?: string;
  lieu_enrolement?: string;
}) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?', 'is_dirty = 1'];
  const params: any[] = [now];

  if (fields.num_secu !== undefined) {
    sets.push('num_secu = ?');
    params.push(fields.num_secu.trim());
  }
  if (fields.rangement !== undefined) {
    sets.push('rangement = ?');
    params.push(fields.rangement.trim().toUpperCase());
  }
  if (fields.noms !== undefined) {
    sets.push('noms = ?');
    params.push(removeAccents(fields.noms));
  }
  if (fields.prenoms !== undefined) {
    sets.push('prenoms = ?');
    params.push(removeAccents(fields.prenoms));
  }
  if (fields.contact !== undefined) {
    sets.push('contact = ?');
    // Normalisation : on stocke uniquement les 10 chiffres locaux (format CI)
    params.push(normalizeContact(fields.contact));
  }
  if (fields.lieu_de_naissance !== undefined) {
    sets.push('lieu_de_naissance = ?');
    params.push(removeAccents(fields.lieu_de_naissance));
  }
  if (fields.date_de_naissance !== undefined) {
    sets.push('date_de_naissance = ?');
    params.push(fields.date_de_naissance.trim());
  }
  if (fields.sexe !== undefined) {
    sets.push('sexe = ?');
    params.push(fields.sexe.trim().toUpperCase());
  }
  if (fields.lieu_enrolement !== undefined) {
    sets.push('lieu_enrolement = ?');
    // Même normalisation que lieu_de_naissance (removeAccents) et que le worker d'import
    // (import-worker.js:629) qui applique déjà removeAccents() sur ce champ à l'ingestion.
    params.push(removeAccents(fields.lieu_enrolement));
  }

  params.push(id);
  const res = db.prepare(`UPDATE t_cartes SET ${sets.join(', ')} WHERE id_carte = ?`).run(...params);
  autoEnqueueCorrection(id);
  return res;
}

export function getSansContactPage(siteId: number, offset: number, limit: number, query?: string) {
  const db = getDatabase()!;
  // Contact manquant : null, vide, ou format invalide (+225 00 00 00 00 00 est la valeur de fallback du worker)
  let where = "WHERE site_id = ? AND is_dirty != -1 AND (contact IS NULL OR contact = '' OR contact = '+225 00 00 00 00 00' OR contact = '0000000000')";
  const params: any[] = [siteId];

  if (query && query.trim()) {
    const tokens = query.trim().split(/\\s+/);
    tokens.forEach(t => {
      where += " AND ((COALESCE(noms, '') || ' ' || COALESCE(prenoms, '')) LIKE ? OR (COALESCE(prenoms, '') || ' ' || COALESCE(noms, '')) LIKE ? OR num_secu LIKE ?)";
      const q = `%${t}%`;
      params.push(q, q, q);
    });
  }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const total = getCachedCount(db, countQuery, params) || 0;

  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function getSansLieuNaissancePage(siteId: number, offset: number, limit: number, query?: string) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND is_dirty != -1 AND (lieu_de_naissance IS NULL OR lieu_de_naissance = '')";
  const params: any[] = [siteId];

  if (query && query.trim()) {
    const tokens = query.trim().split(/\\s+/);
    tokens.forEach(t => {
      where += " AND ((COALESCE(noms, '') || ' ' || COALESCE(prenoms, '')) LIKE ? OR (COALESCE(prenoms, '') || ' ' || COALESCE(noms, '')) LIKE ? OR num_secu LIKE ?)";
      const q = `%${t}%`;
      params.push(q, q, q);
    });
  }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const total = getCachedCount(db, countQuery, params) || 0;

  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function getSansLieuEnrolementPage(siteId: number, offset: number, limit: number, query?: string) {
  const db = getDatabase()!;
  let where = "WHERE site_id = ? AND is_dirty != -1 AND (lieu_enrolement IS NULL OR lieu_enrolement = '')";
  const params: any[] = [siteId];

  if (query && query.trim()) {
    const tokens = query.trim().split(/\\s+/);
    tokens.forEach(t => {
      where += " AND ((COALESCE(noms, '') || ' ' || COALESCE(prenoms, '')) LIKE ? OR (COALESCE(prenoms, '') || ' ' || COALESCE(noms, '')) LIKE ? OR num_secu LIKE ?)";
      const q = `%${t}%`;
      params.push(q, q, q);
    });
  }

  const countQuery = `SELECT COUNT(*) as count FROM t_cartes ${where}`;
  const total = getCachedCount(db, countQuery, params) || 0;

  const rows = db.prepare(`SELECT * FROM t_cartes ${where} ORDER BY id_carte DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { rows, total };
}

export function searchQuickLogistique(siteId: number, critere: string) {
  const db = getDatabase()!;
  const cleaned = critere.trim();
  if (!cleaned) return [];

  const searchPattern = `%${cleaned}%`;
  
  return db.prepare(`
    SELECT id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, rangement, statut, statut_physique
    FROM t_cartes
    WHERE site_id = ? 
      AND (
        UPPER(num_secu) = UPPER(?) 
        OR contact = ? 
        OR date_de_naissance = ? 
        OR (noms || ' ' || prenoms LIKE ?)
        OR (prenoms || ' ' || noms LIKE ?)
        OR lieu_de_naissance LIKE ?
      )
    ORDER BY noms ASC, prenoms ASC, id_carte ASC
    LIMIT 20
  `).all(siteId, cleaned, cleaned, cleaned, searchPattern, searchPattern, searchPattern);
}

export function updateRangementEtFiche(id: number, fields: { rangement: string, num_secu?: string }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?', 'is_dirty = 1', 'rangement = ?'];
  const params: any[] = [now, fields.rangement.trim().toUpperCase()];

  if (fields.num_secu !== undefined) {
    sets.push('num_secu = ?');
    params.push(fields.num_secu.trim());
  }

  params.push(id);
  const res = db.prepare(`UPDATE t_cartes SET ${sets.join(', ')} WHERE id_carte = ?`).run(...params);
  autoEnqueueCorrection(id);
  return res;
}

export function searchCombinedInventaire(siteId: number, queryNomsPrenoms: string, dateNaissance?: string, lieuNaissance?: string) {
  const db = getDatabase()!;
  let where = 'WHERE site_id = ?';
  const params: any[] = [siteId];

  const cleanedQuery = queryNomsPrenoms.trim();
  if (cleanedQuery) {
    // Migration LIKE binaire -> FTS5 (bug confirmé : LIKE sur noms||' '||prenoms échouait sur
    // prénoms composés saisis partiellement/dans un autre ordre et sur les écarts d'accentuation,
    // cf. diagnostic). Réutilise exactement le motif de tokenisation/échappement déjà en
    // production dans searchAllRecords (plus bas dans ce fichier) : tokens nettoyés des guillemets
    // internes, wildcard préfixe par token, jointure AND explicite — aucun nouveau motif inventé.
    // Le tokenizer unicode61 de t_cartes_fts normalise les diacritiques, ce qui résout aussi
    // l'écart d'accentuation entre saisie et donnée stockée. site_id, tri alphabétique et LIMIT 20
    // restent inchangés (décision produit : pas de tri par pertinence FTS).
    const tokens = cleanedQuery.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length > 0) {
      const ftsQuery = tokens.map(t => `"${t.replace(/"/g, '')}"*`).join(' AND ');
      where += ' AND id_carte IN (SELECT rowid FROM t_cartes_fts WHERE t_cartes_fts MATCH ?)';
      params.push(ftsQuery);
    }
  }

  if (dateNaissance && dateNaissance.trim()) {
    where += ' AND date_de_naissance = ?';
    params.push(normalizeDate(dateNaissance.trim()));
  }

  if (lieuNaissance && lieuNaissance.trim()) {
    where += ' AND lieu_de_naissance LIKE ?';
    params.push(`%${lieuNaissance.trim()}%`);
  }

  // date_delivrance/agent_distributeur/nom_retirant : ajout pur pour permettre au renderer
  // (InventaireApurement.tsx::selectCard) d'avertir l'agent quand une fiche DELIVRE est
  // sélectionnée pour ré-émargement — comportement de filtre/tri inchangé.
  return db.prepare(`
    SELECT id_carte, noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, rangement, statut, statut_physique,
           date_delivrance, agent_distributeur, nom_retirant
    FROM t_cartes
    ${where}
    ORDER BY noms ASC, prenoms ASC, id_carte ASC
    LIMIT 20
  `).all(...params);
}

export function updateApurementHistorique(id: number, fields: { date_delivrance: string, nom_retirant: string, num_retirant: string, relation_retirant: string, agent_distributeur: string }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();

  // Double verrou DOUBLON (plan validé) : même verrou que delivrerCarte() — une carte déclarée
  // DOUBLON ne doit plus jamais être délivrable, y compris via l'émargement rétroactif du
  // cahier historique (Apurement). Vérifié avant toute écriture.
  const carte = db.prepare('SELECT statut, sync_id FROM t_cartes WHERE id_carte = ?').get(id) as { statut: string; sync_id: string | null } | undefined;
  if (carte?.statut === 'DOUBLON') {
    throw new Error("Action refusée : cette carte est déclarée en doublon et ne peut plus être émargée. Contactez un administrateur pour vérifier ou annuler cette déclaration.");
  }

  // Verrou DELIVRE (plan de correction/annulation d'un émargement Apurement erroné, validé) :
  // la resaisie silencieuse d'une fiche déjà déchargée écrasait auparavant l'émargement existant
  // sans trace d'audit (bug d'origine documenté dans le plan). Redirection explicite vers le
  // nouveau flux tracé (corrigerApurementRetirant/annulerApurementDechargement ci-dessous),
  // seul moyen désormais de modifier une fiche DELIVRE.
  if (carte?.statut === 'DELIVRE') {
    throw new Error("Action refusée : cette carte a déjà été déchargée. Utilisez l'onglet \"Cartes déchargées\" pour corriger ou annuler cet émargement (action tracée).");
  }

  const result = db.prepare(`
    UPDATE t_cartes
    SET statut = 'DELIVRE',
        date_delivrance = ?,
        nom_retirant = ?,
        num_retirant = ?,
        relation_retirant = ?,
        agent_distributeur = ?,
        updated_at = ?,
        is_dirty = 1
    WHERE id_carte = ?
  `).run(
    fields.date_delivrance,
    fields.nom_retirant.trim().toUpperCase(),
    fields.num_retirant.trim(),
    fields.relation_retirant.trim(),
    fields.agent_distributeur.trim(),
    now,
    id
  );

  // Synchronisation Supabase (même modèle que delivrerCarte()/transfererCarte() ci-dessus) :
  // l'émargement rétroactif du cahier historique (Apurement) modifiait t_cartes localement
  // sans jamais enfiler l'UPDATE vers Supabase — carte durablement désynchronisée entre postes.
  if (carte?.sync_id) {
    const updatedCarte = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
    enqueueOutbox(carte.sync_id, 't_cartes', 'UPDATE', updatedCarte);
    if (networkMonitor.getState() === 'ONLINE') {
      // forceCards=true : correction/mutation unitaire (émargement rétroactif du cahier
      // historique), jamais un import massif — doit échapper au toggle "Envoi Automatique"
      // (même principe que autoEnqueueCorrection() plus haut).
      scheduleOutboxProcessing(true);
    }
  }

  return result;
}

/**
 * Vérifie la fenêtre de tolérance "jour même" pour la correction/annulation d'un émargement
 * Apurement (plan validé — correction/annulation d'un émargement Apurement erroné).
 * Comparaison sur `updated_at` (horodatage serveur de l'émargement), pas sur `date_delivrance`
 * (saisie libre du cahier historique) — même convention que getApurementStats/
 * getApurementCardsTodayPaginated (stats.queries.ts). Liste blanche explicite des rôles admin
 * (SUPER ADMIN/ADMINISTRATEUR_SITE/ADMIN_CENTRE) : eux seuls n'ont aucune fenêtre de temps ni
 * d'auteur à respecter (déjà cloisonnés par site/centre en amont). Tout rôle non-admin —
 * OPERATEUR_APUREMENT comme tout rôle actif imprévu (ex. compte multi-rôle dont le rôle actif
 * de session diffère du rôle nominal détenteur du gate IPC grossier) — est restreint par défaut
 * à ses propres émargements du jour même. Correctif P0 (audit sécurité août 2026) : l'ancienne
 * logique en liste noire (`role !== 'OPERATEUR_APUREMENT'`) laissait passer sans restriction tout
 * rôle actif autre que ces deux catégories.
 */
function assertApurementToleranceWindow(
  carte: { agent_distributeur: string | null; updated_at: string | null },
  currentUser?: { role: string; login?: string }
): void {
  const ADMIN_ROLES = ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'];
  if (!currentUser || ADMIN_ROLES.includes(currentUser.role)) return;

  if ((carte.agent_distributeur || '').trim().toUpperCase() !== (currentUser.login || '').trim().toUpperCase()) {
    throw new Error("Action refusée : vous ne pouvez corriger ou annuler que vos propres émargements. Contactez un administrateur.");
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const dTomorrow = new Date();
  dTomorrow.setDate(dTomorrow.getDate() + 1);
  const tomorrowStr = dTomorrow.toISOString().split('T')[0];
  const updatedAt = carte.updated_at || '';
  if (!(updatedAt >= todayStr && updatedAt < tomorrowStr)) {
    throw new Error("Action refusée : le délai de correction du jour même est dépassé. Contactez un administrateur (SUPER ADMIN / ADMINISTRATEUR_SITE / ADMIN_CENTRE) pour corriger cet émargement.");
  }
}

/**
 * Cas B (plan validé — correction/annulation d'un émargement Apurement erroné) : corrige les
 * champs du retirant d'une carte déjà déchargée (statut DELIVRE inchangé) — mauvaise carte non
 * concernée, seules les informations saisies étaient erronées. Ne touche JAMAIS
 * `agent_distributeur` (trace historique de qui a déchargé initialement, jamais réécrite — même
 * principe que `doublon_declare_par` face à `doublon_annule_par`). Motif obligatoire. RBAC mixte
 * vérifié dans la même transaction que la lecture de la carte (élimine tout TOCTOU) :
 * OPERATEUR_APUREMENT limité à ses propres émargements du jour même (assertApurementToleranceWindow
 * ci-dessus), sinon réservé aux rôles admin. Le RBAC grossier (liste de rôles autorisés) reste
 * appliqué côté handler IPC (cartes:corrigerApurement), jamais ici — architecture identique à
 * declarerDoublon/annulerDeclarationDoublon ci-dessus. Retourne `{ result, before }` : `before`
 * (valeurs des champs retirant avant correction) alimente le JSON `details` de l'audit
 * (t_audit_log/t_logs), même convention que declarerDoublon pour `statut_avant_doublon`.
 */
export function corrigerApurementRetirant(
  id: number,
  fields: { date_delivrance: string; nom_retirant: string; num_retirant: string; relation_retirant: string },
  motif: string,
  currentUser?: { role: string; site_id?: number; id_user?: number; login?: string; centre_id?: number }
) {
  const db = getDatabase()!;

  const siteIdToUse = currentUser?.role === 'SUPER ADMIN' ? null : (currentUser?.site_id ?? null);

  const runTx = db.transaction(() => {
    const carte = db.prepare(`
      SELECT sync_id, site_id, centre_id, statut, agent_distributeur, updated_at,
             date_delivrance, nom_retirant, num_retirant, relation_retirant
      FROM t_cartes WHERE id_carte = ? AND (? IS NULL OR site_id = ?)
    `).get(id, siteIdToUse, siteIdToUse) as {
      sync_id: string | null; site_id: number; centre_id: number | null; statut: string;
      agent_distributeur: string | null; updated_at: string | null;
      date_delivrance: string | null; nom_retirant: string | null; num_retirant: string | null; relation_retirant: string | null;
    } | undefined;

    if (!carte) {
      throw new Error("Carte introuvable, ou accès non autorisé pour votre site.");
    }

    if (currentUser && currentUser.role === 'ADMIN_CENTRE') {
      if (carte.centre_id !== currentUser.centre_id || carte.site_id !== currentUser.site_id) {
        throw new Error("Action refusée : Cette carte appartient à un autre centre de distribution.");
      }
    }

    if (carte.statut !== 'DELIVRE') {
      throw new Error("Cette carte n'est pas (ou plus) déchargée — aucune correction à effectuer.");
    }

    assertApurementToleranceWindow(carte, currentUser);

    const now = new Date().toISOString();
    const before = {
      date_delivrance: carte.date_delivrance,
      nom_retirant: carte.nom_retirant,
      num_retirant: carte.num_retirant,
      relation_retirant: carte.relation_retirant
    };

    const query = `
      UPDATE t_cartes SET
        date_delivrance = @date_delivrance,
        nom_retirant = @nom_retirant,
        num_retirant = @num_retirant,
        relation_retirant = @relation_retirant,
        apurement_correction_par = @correction_par,
        apurement_correction_le = @now,
        apurement_correction_motif = @motif,
        updated_at = @now,
        updated_by = @updated_by,
        is_dirty = 1
      WHERE id_carte = @id
    `;

    const params: any = {
      id,
      date_delivrance: fields.date_delivrance,
      nom_retirant: fields.nom_retirant.trim().toUpperCase(),
      num_retirant: fields.num_retirant.trim(),
      relation_retirant: fields.relation_retirant.trim(),
      correction_par: currentUser?.login || 'ADMIN',
      motif,
      now,
      updated_by: currentUser?.id_user || null
    };

    const result = db.prepare(query).run(params);

    if (result.changes === 0) {
      throw new Error("Erreur lors de la correction de l'émargement.");
    }

    if (carte.sync_id) {
      const updatedCarte = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
      enqueueOutbox(carte.sync_id, 't_cartes', 'UPDATE', updatedCarte);
      if (networkMonitor.getState() === 'ONLINE') {
        // forceCards=true : correction unitaire (retirant), jamais un import massif — doit
        // échapper au toggle "Envoi Automatique" (même principe que autoEnqueueCorrection()).
        scheduleOutboxProcessing(true);
      }
    }

    return { result, before };
  });

  // Filet de rattrapage FTS5 — voir commentaire équivalent dans declarerDoublon() ci-dessus.
  try {
    return runTx();
  } catch (err: any) {
    if (err.code === 'SQLITE_CORRUPT_VTAB' || (err.message && (err.message.includes('malformed') || err.message.includes('corrupt')))) {
      log.warn('[corrigerApurementRetirant] FTS5 shadow tables corrompues. Suppression du trigger pour correction sécurisée...');
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
      const result = runTx();
      log.info('[corrigerApurementRetirant] Correction exécutée sans FTS5. Reset nucléaire planifié en arrière-plan...');
      nuclearResetFts5();
      return result;
    }
    throw err;
  }
}

/**
 * Cas A (plan validé — correction/annulation d'un émargement Apurement erroné) : annule
 * complètement un déchargement erroné (mauvaise carte émargée) — retour à `EN STOCK`, champs du
 * retirant remis à NULL (une carte redevenue disponible n'affiche plus un retirant erroné,
 * valeur effacée conservée dans le JSON d'audit). Motif obligatoire. Même architecture RBAC que
 * corrigerApurementRetirant ci-dessus (fenêtre de tolérance jour même pour OPERATEUR_APUREMENT,
 * vérifiée dans la même transaction que la lecture de la carte). Retourne `{ result, before }`.
 */
export function annulerApurementDechargement(
  id: number,
  motif: string,
  currentUser?: { role: string; site_id?: number; id_user?: number; login?: string; centre_id?: number }
) {
  const db = getDatabase()!;

  const siteIdToUse = currentUser?.role === 'SUPER ADMIN' ? null : (currentUser?.site_id ?? null);

  const runTx = db.transaction(() => {
    const carte = db.prepare(`
      SELECT sync_id, site_id, centre_id, statut, agent_distributeur, updated_at,
             date_delivrance, nom_retirant, num_retirant, relation_retirant, centre_retrait
      FROM t_cartes WHERE id_carte = ? AND (? IS NULL OR site_id = ?)
    `).get(id, siteIdToUse, siteIdToUse) as {
      sync_id: string | null; site_id: number; centre_id: number | null; statut: string;
      agent_distributeur: string | null; updated_at: string | null;
      date_delivrance: string | null; nom_retirant: string | null; num_retirant: string | null;
      relation_retirant: string | null; centre_retrait: string | null;
    } | undefined;

    if (!carte) {
      throw new Error("Carte introuvable, ou accès non autorisé pour votre site.");
    }

    if (currentUser && currentUser.role === 'ADMIN_CENTRE') {
      if (carte.centre_id !== currentUser.centre_id || carte.site_id !== currentUser.site_id) {
        throw new Error("Action refusée : Cette carte appartient à un autre centre de distribution.");
      }
    }

    if (carte.statut !== 'DELIVRE') {
      throw new Error("Cette carte n'est pas (ou plus) déchargée — aucune annulation à effectuer.");
    }

    assertApurementToleranceWindow(carte, currentUser);

    const now = new Date().toISOString();
    const before = {
      statut: carte.statut,
      date_delivrance: carte.date_delivrance,
      nom_retirant: carte.nom_retirant,
      num_retirant: carte.num_retirant,
      relation_retirant: carte.relation_retirant,
      agent_distributeur: carte.agent_distributeur,
      centre_retrait: carte.centre_retrait
    };

    const query = `
      UPDATE t_cartes SET
        statut = 'EN STOCK',
        date_delivrance = NULL,
        nom_retirant = NULL,
        num_retirant = NULL,
        relation_retirant = NULL,
        agent_distributeur = NULL,
        centre_retrait = NULL,
        apurement_annulation_par = @annulation_par,
        apurement_annulation_le = @now,
        apurement_annulation_motif = @motif,
        updated_at = @now,
        updated_by = @updated_by,
        is_dirty = 1
      WHERE id_carte = @id
    `;

    const params: any = {
      id,
      annulation_par: currentUser?.login || 'ADMIN',
      motif,
      now,
      updated_by: currentUser?.id_user || null
    };

    const result = db.prepare(query).run(params);

    if (result.changes === 0) {
      throw new Error("Erreur lors de l'annulation de l'émargement.");
    }

    if (carte.sync_id) {
      const updatedCarte = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
      enqueueOutbox(carte.sync_id, 't_cartes', 'UPDATE', updatedCarte);
      if (networkMonitor.getState() === 'ONLINE') {
        // forceCards=true : annulation unitaire d'un émargement, jamais un import massif —
        // doit échapper au toggle "Envoi Automatique" (même principe que autoEnqueueCorrection()).
        scheduleOutboxProcessing(true);
      }
    }

    return { result, before };
  });

  // Filet de rattrapage FTS5 — voir commentaire équivalent dans declarerDoublon() ci-dessus.
  try {
    return runTx();
  } catch (err: any) {
    if (err.code === 'SQLITE_CORRUPT_VTAB' || (err.message && (err.message.includes('malformed') || err.message.includes('corrupt')))) {
      log.warn('[annulerApurementDechargement] FTS5 shadow tables corrompues. Suppression du trigger pour annulation sécurisée...');
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
      const result = runTx();
      log.info('[annulerApurementDechargement] Annulation exécutée sans FTS5. Reset nucléaire planifié en arrière-plan...');
      nuclearResetFts5();
      return result;
    }
    throw err;
  }
}

export function updateCarteRangementAndStatusRapid(identifiant: string, rangement: string, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  const cleanedId = identifiant.trim().toUpperCase();
  const targetRangement = rangement.trim().toUpperCase();

  // Sécurité (cloisonnement §3) : pour tout rôle non-SUPER-ADMIN, la recherche par identifiant
  // (num_secu) est restreinte au site de l'appelant — absent avant ce correctif (seul appelant :
  // cartes:inventairePhysiqueScan, aucun autre consommateur trouvé dans le code).
  const scoped = currentUser && currentUser.role !== 'SUPER ADMIN';
  const carte = scoped
    ? db.prepare(`SELECT id_carte, noms, prenoms, num_secu, rangement, sync_id FROM t_cartes WHERE UPPER(num_secu) = ? AND site_id = ? LIMIT 1`).get(cleanedId, currentUser!.site_id) as any
    : db.prepare(`SELECT id_carte, noms, prenoms, num_secu, rangement, sync_id FROM t_cartes WHERE UPPER(num_secu) = ? LIMIT 1`).get(cleanedId) as any;

  if (!carte) {
    return { success: false, message: "Carte introuvable avec cet identifiant." };
  }

  const query = `
    UPDATE t_cartes
    SET statut = 'EN STOCK',
        rangement = ?,
        updated_at = ?,
        is_dirty = 1
    WHERE id_carte = ?
  `;

  // Même garde-fou FTS5 que delivrerCarte()/transfererCarte()/updateCarte() (voir plus haut) :
  // cette UPDATE touche toujours `rangement`, donc déclenche systématiquement trg_cartes_au,
  // qui peut remonter "database disk image is malformed" en cas de corruption des shadow
  // tables FTS5 (incident confirmé sur ce chemin précis, cartes:inventairePhysiqueScan).
  try {
    db.prepare(query).run(targetRangement, now, carte.id_carte);
  } catch (err: any) {
    if (err.code === 'SQLITE_CORRUPT_VTAB' || (err.message && (err.message.includes('malformed') || err.message.includes('corrupt')))) {
      log.warn('[updateCarteRangementAndStatusRapid] FTS5 shadow tables corrompues. Suppression du trigger pour mise à jour sécurisée...');
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
      db.prepare(query).run(targetRangement, now, carte.id_carte);
      log.info('[updateCarteRangementAndStatusRapid] Mise à jour exécutée sans FTS5. Reset nucléaire planifié en arrière-plan...');
      nuclearResetFts5();
    } else {
      throw err;
    }
  }

  // Synchronisation Supabase (même modèle que delivrerCarte()/transfererCarte() ci-dessus) —
  // placé après confirmation du succès de l'UPDATE (guard FTS5 ci-dessus) pour ne jamais
  // enfiler un payload correspondant à une écriture qui aurait échoué.
  if (carte.sync_id) {
    const updatedCarte = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(carte.id_carte) as any;
    enqueueOutbox(carte.sync_id, 't_cartes', 'UPDATE', updatedCarte);
    if (networkMonitor.getState() === 'ONLINE') {
      // forceCards=true : correction unitaire (scan d'inventaire physique), jamais un import
      // massif — doit échapper au toggle "Envoi Automatique" (même principe que autoEnqueueCorrection()).
      scheduleOutboxProcessing(true);
    }
  }

  return {
    success: true,
    carte: {
      ...carte,
      rangement: targetRangement
    }
  };
}

export function searchAllRecords(siteId: number, filters: QualityFilters, limit: number = 50) {
  const db = getDatabase()!;
  
  let conditionsCartes = 'site_id = @siteId';
  let conditionsAnomalies = 'site_id = @siteId';
  const params: any = { siteId, limit };
  
  if (filters?.nom) {
    const tokens = filters.nom.trim().split(/\s+/).filter(t => t.length > 0);
    if (tokens.length > 0) {
      const ftsString = tokens.map(t => `"${t.replace(/"/g, '')}"*`).join(' AND ');
      conditionsCartes += ` AND id_carte IN (SELECT rowid FROM t_cartes_fts WHERE t_cartes_fts MATCH @ftsQuery)`;
      conditionsAnomalies += ` AND id IN (SELECT rowid FROM t_anomalies_fts WHERE t_anomalies_fts MATCH @ftsQuery)`;
      params.ftsQuery = ftsString;
    }
  }
  if (filters?.contact) {
    conditionsCartes += ` AND contact LIKE @contact`;
    conditionsAnomalies += ` AND contact LIKE @contact`;
    params.contact = `%${filters.contact}%`;
  }
  if (filters?.ddn) {
    conditionsCartes += ` AND date_de_naissance = @ddn`;
    conditionsAnomalies += ` AND date_de_naissance = @ddn`;
    params.ddn = filters.ddn;
  }
  if (filters?.lieu) {
    conditionsCartes += ` AND lieu_de_naissance LIKE @lieu`;
    conditionsAnomalies += ` AND lieu_de_naissance LIKE @lieu`;
    params.lieu = `%${filters.lieu}%`;
  }

  const query = `
    SELECT 
      'carte_' || id_carte AS virtual_id,
      id_carte AS original_id,
      noms,
      prenoms,
      date_de_naissance,
      num_secu,
      contact,
      'Valide' AS record_type,
      statut AS status_or_anomaly
    FROM t_cartes
    WHERE ${conditionsCartes}
    
    UNION ALL
    
    SELECT 
      'anomalie_' || id AS virtual_id,
      id AS original_id,
      noms,
      prenoms,
      date_de_naissance,
      num_secu,
      contact,
      'En Anomalie' AS record_type,
      type_anomalie AS status_or_anomaly
    FROM t_import_anomalies
    WHERE ${conditionsAnomalies}
    
    ORDER BY noms, prenoms
    LIMIT @limit
  `;

  return db.prepare(query).all(params);
}

export function getRecordForCorrection(originalId: number | string, recordType: string, siteId?: number) {
  const db = getDatabase()!;
  if (recordType === 'Valide') {
    if (siteId !== undefined && siteId !== null) {
      return db.prepare(`SELECT * FROM t_cartes WHERE id_carte = ? AND site_id = ?`).get(originalId, siteId);
    }
    return db.prepare(`SELECT * FROM t_cartes WHERE id_carte = ?`).get(originalId);
  } else if (recordType === 'En Anomalie') {
    if (siteId !== undefined && siteId !== null) {
      return db.prepare(`SELECT * FROM t_import_anomalies WHERE id = ? AND site_id = ?`).get(originalId, siteId);
    }
    return db.prepare(`SELECT * FROM t_import_anomalies WHERE id = ?`).get(originalId);
  }
  return null;
}

/**
 * Compte le nombre de brouillons pour un agent sur un site.
 */
export function countDrafts(siteId: number, userId: number): number {
  const db = getDatabase()!;
  const row = db.prepare(`
    SELECT COUNT(*) as c FROM t_cartes 
    WHERE site_id = ? AND created_by = ? AND statut = 'BROUILLON' AND is_dirty != -1
  `).get(siteId, userId) as { c: number };
  return row?.c || 0;
}

/**
 * Publie tous les brouillons d'un agent pour un site.
 * Change leur statut en 'EN STOCK' et les enfile dans la t_outbox.
 *
 * Garde-fou (non-régression) : un BROUILLON dont la date de naissance est
 * invalide/vide n'est PAS promu en EN STOCK (une carte "réelle" ne doit
 * jamais entrer en base avec une date invalide) — il reste BROUILLON,
 * is_dirty=1, et n'est pas enfilé dans l'outbox (pas besoin de synchro
 * puisqu'il reste un brouillon local). Ces cartes sont comptabilisées à
 * part dans skippedInvalidDateCount pour que l'agent sache qu'il doit
 * encore les corriger. Les cartes déjà EN STOCK/DELIVRE re-modifiées ne
 * sont pas des brouillons : elles ne sont pas concernées par cette
 * validation et continuent d'être enfilées normalement.
 */
export function publishDrafts(siteId: number, userId: number): { publishedCount: number; skippedInvalidDateCount: number } {
  const db = getDatabase()!;
  const now = new Date().toISOString();

  // Scanner uniquement les cartes modifiées appartenant à cet agent (brouillons ou corrections)
  const modifiedCartes = db.prepare(`
    SELECT * FROM t_cartes
    WHERE site_id = ? AND is_dirty = 1 AND created_by = ?
  `).all(siteId, userId) as any[];

  if (modifiedCartes.length === 0) {
    return { publishedCount: 0, skippedInvalidDateCount: 0 };
  }

  let skippedInvalidDateCount = 0;

  const tx = db.transaction(() => {
    const updateBrouillonStmt = db.prepare(`
      UPDATE t_cartes
      SET statut = 'EN STOCK', updated_at = ?
      WHERE id_carte = ? AND statut = 'BROUILLON'
    `);

    for (const carte of modifiedCartes) {
      if (carte.statut === 'BROUILLON') {
        if (!isValidDateStrict(carte.date_de_naissance)) {
          // Date invalide/vide : le brouillon reste BROUILLON et n'est pas
          // enfilé vers l'outbox (rien à synchroniser tant qu'il n'est pas corrigé).
          skippedInvalidDateCount++;
          continue;
        }
        updateBrouillonStmt.run(now, carte.id_carte);
        carte.statut = 'EN STOCK';
        carte.updated_at = now;
      }

      const updatedCarte = db.prepare('SELECT noms, prenoms, date_de_naissance, lieu_de_naissance, num_secu, lieu_enrolement, contact, rangement, statut, date_delivrance, agent_saisie, nom_retirant, num_retirant, agent_distributeur, centre_retrait, cle_doublon, cle_doublon_flex, statut_physique, site_id, centre_id, poste_id, qr_code_data, created_by FROM t_cartes WHERE id_carte = ?').get(carte.id_carte) as any;

      enqueueOutbox(carte.sync_id, 't_cartes', 'UPDATE', {
        sync_id: carte.sync_id,
        ...updatedCarte,
        updated_at: carte.updated_at
      });
    }
  });

  tx();

  if (networkMonitor.getState() === 'ONLINE') {
    scheduleOutboxProcessing();
  }

  return { publishedCount: modifiedCartes.length - skippedInvalidDateCount, skippedInvalidDateCount };
}
