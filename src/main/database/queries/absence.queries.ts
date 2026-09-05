import { getDatabase } from '../connection';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import { enqueueOutbox, scheduleOutboxProcessing } from '../../sync/outbox.service';
import { networkMonitor } from '../../sync/network-monitor';
import { nuclearResetFts5 } from './cartes.queries';

export function signalerAbsence(id: number, agentLogin: string, agentInfo: string, commentaire: string = '', currentUser?: { role: string; site_id?: number; id_user?: number; centre_id?: number }) {
  const db = getDatabase()!;
  return db.transaction(() => {
    const now = new Date().toISOString();

    // Verrou centre (cloisonnement §3, même pattern que delivrerCarte()/declarerDoublon() dans
    // cartes.queries.ts) : pour OPERATEUR_VERIFICATION/ADMIN_CENTRE, un signalement d'absence
    // hors du centre de l'appelant est refusé. SELECT préalable nécessaire (absent jusqu'ici
    // dans cette fonction, qui ne relisait la carte qu'après l'UPDATE) — exécuté dans la même
    // transaction que l'UPDATE ci-dessous pour éviter toute race condition entre la lecture et
    // l'écriture.
    if (currentUser && (currentUser.role === 'OPERATEUR_VERIFICATION' || currentUser.role === 'ADMIN_CENTRE')) {
      const carteAvant = db.prepare('SELECT centre_id, site_id FROM t_cartes WHERE id_carte = ?').get(id) as { centre_id: number | null; site_id: number } | undefined;
      if (carteAvant && (carteAvant.centre_id !== currentUser.centre_id || carteAvant.site_id !== currentUser.site_id)) {
        throw new Error("Action refusée : Cette carte appartient à un autre centre de distribution.");
      }
    }

    let query = `
      UPDATE t_cartes SET statut_physique = 'ABSENT',
        agent_signalement_absence = @agentLogin, date_signalement_absence = @now,
        note_signalement_absence = @commentaire, escalade_niveau = 'CENTRE',
        updated_at = @now, action_at = @now, is_dirty = 1
    `;
    const params: any = { agentLogin, now, commentaire, id };
    
    if (currentUser?.centre_id) {
      query += `, centre_id = @centre_id`;
      params.centre_id = currentUser.centre_id;
    }
    
    query += ` WHERE id_carte = @id`;
    
    if (currentUser && currentUser.role !== 'SUPER ADMIN') {
      query += ' AND site_id = @site_id';
      params.site_id = currentUser.site_id;
    }
    const result = db.prepare(query).run(params);
    if (result.changes === 0) {
      throw new Error("Accès non autorisé aux données de ce site");
    }

    const card = db.prepare('SELECT site_id, centre_id, noms, prenoms, sync_id FROM t_cartes WHERE id_carte = ?').get(id) as any;
    if (card) {
      const siteId = card.site_id;
      const centreId = card.centre_id;
      const message = `🚨 [SIGNALEMENT - ABSENCE] La carte de ${card.noms} ${card.prenoms} est signalée absente par ${agentInfo}. ${commentaire ? 'Note: ' + commentaire : ''}`;
      const userId = currentUser?.id_user || null;
      const userLogin = agentLogin;
      // centre_id inclus dans le payload : seul l'ADMIN_CENTRE de ce centre doit être notifié en temps réel
      const logPayload = JSON.stringify({ read: false, id_carte: id, centre_id: centreId });

      // Propagation vers Supabase : sans cet enqueue, le signalement reste local tant qu'aucun
      // envoi manuel en masse n'est déclenché (le cycle upstream automatique ne traite que t_outbox).
      // Payload complet (pas juste { sync_id }) : outbox.service.ts applique mapCardPayload()
      // au moment de l'envoi, qui exige site_id — un payload minimal fait échouer
      // systématiquement cette validation ("site_id manquant"), l'entrée outbox part en ERROR
      // définitif sans jamais atteindre Supabase (bug confirmé sur le même pattern dans
      // delivrerCarte(), voir cartes.queries.ts).
      if (card.sync_id) {
        const fullCard = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
        enqueueOutbox(card.sync_id, 't_cartes', 'UPDATE', fullCard);
        if (networkMonitor.getState() === 'ONLINE') {
          scheduleOutboxProcessing();
        }
      }

      try {
        db.prepare(`
          INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id, centre_id)
          VALUES (?, ?, 'CARTE_ABSENTE_SIGNALEE', ?, ?, ?, 1, ?, ?)
        `).run(userId, userLogin, message, logPayload, uuidv4(), siteId, centreId ?? null);
      } catch (err) {
        log.error('Failed to log CARTE_ABSENTE_SIGNALEE:', err);
      }

      return { ...result, centre_id: centreId ?? null };
    }

    return result;
  })();
}

export function getAbsencesReportees(siteId?: number): any[] {
  const db = getDatabase()!;
  let query = "SELECT * FROM t_cartes WHERE statut_physique = 'ABSENT'";
  const params: any[] = [];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND site_id = ?';
    params.push(Number(siteId));
  }
  query += ' ORDER BY date_signalement_absence DESC';
  return db.prepare(query).all(...params);
}

export function getAgentReportedAbsences(agent: string, siteId?: number): any[] {
  const db = getDatabase()!;
  let query = `SELECT * FROM t_cartes WHERE agent_signalement_absence = ? AND statut_physique IN ('ABSENT', 'RETROUVE', 'PERDUE')`;
  const params: any[] = [agent];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND site_id = ?';
    params.push(Number(siteId));
  }
  query += ' ORDER BY date_signalement_absence DESC LIMIT 50';
  return db.prepare(query).all(...params);
}

export function getAgentAbsences(agent: string, siteId?: number): any[] {
  const db = getDatabase()!;
  let query = "SELECT * FROM t_cartes WHERE agent_signalement_absence = ? AND statut_physique = 'ABSENT'";
  const params: any[] = [agent];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND site_id = ?';
    params.push(Number(siteId));
  }
  query += ' ORDER BY date_signalement_absence DESC';
  return db.prepare(query).all(...params);
}

// Tri sur `action_at` (et non `updated_at`, qui redevient un pur horodatage d'envoi réseau
// depuis le lot 1) : resoudreAbsence()/declarerPerdue() posent les deux colonnes à la même
// valeur `now` (voir plus bas dans ce fichier), donc `action_at` reflète fidèlement le moment
// réel de la résolution, contrairement à `updated_at` qui sera réécrit par la synchro — migration
// lot 2. SELECT * inchangé (renvoie déjà `action_at`, colonne réelle de t_cartes) : seul l'ORDER
// BY change, ResolusTab.tsx lit désormais `action_at` pour l'affichage "Résolue le".
export function getSignalementsResolus(agent: string, siteId?: number): any[] {
  const db = getDatabase()!;
  let query = "SELECT * FROM t_cartes WHERE agent_signalement_absence = ? AND escalade_niveau = 'RESOLU'";
  const params: any[] = [agent];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND site_id = ?';
    params.push(Number(siteId));
  }
  query += ' ORDER BY action_at DESC';
  return db.prepare(query).all(...params);
}

export function resoudreAbsence(id: number, data: { status: string; agent: string; note: string; rangement: string }, currentUser?: { role: string; site_id?: number; centre_id?: number }) {
  const db = getDatabase()!;
  const runTx = db.transaction(() => {
    const now = new Date().toISOString();
    let query = `
      UPDATE t_cartes 
      SET statut_physique = @status, rangement = @rangement, escalade_niveau = 'RESOLU', updated_at = @now, action_at = @now, is_dirty = 1
      WHERE id_carte = @id
    `;
    const params: any = { status: data.status, rangement: data.rangement ? data.rangement.toUpperCase().trim() : null, now, id };
    if (currentUser && currentUser.role !== 'SUPER ADMIN') {
      query += ' AND site_id = @site_id';
      params.site_id = currentUser.site_id;
      // Cloisonnement §3 (P1-1) : un ADMIN_CENTRE ne doit résoudre que les absences de son
      // propre centre — site_id seul laissait passer un id_carte forgé d'un autre centre du
      // même site. ADMINISTRATEUR_SITE/SUPER ADMIN restent volontairement non restreints par
      // centre (portée légitime sur tout le site). Même pattern que getAbsencesCentre.
      if (currentUser.role === 'ADMIN_CENTRE') {
        query += ' AND centre_id = @centre_id';
        params.centre_id = currentUser.centre_id;
      }
    }
    const result = db.prepare(query).run(params);
    if (result.changes === 0) {
      throw new Error("Accès non autorisé aux données de ce site");
    }

    const card = db.prepare('SELECT site_id, noms, prenoms, rangement, contact, sync_id FROM t_cartes WHERE id_carte = ?').get(id) as any;
    if (card) {
      const siteId = card.site_id;
      const message = `Carte de ${card.noms} ${card.prenoms} retrouvée (Rangement: ${card.rangement || 'non spécifié'}) par ${data.agent}.`;

      try {
        const unreadLog = db.prepare(`
          SELECT id_log FROM t_logs 
          WHERE action = 'CARTE_ABSENTE_SIGNALEE' 
          AND json_extract(valeur_apres, '$.read') = false
          AND json_extract(valeur_apres, '$.id_carte') = ?
        `).get(id) as { id_log: number } | undefined;

        if (unreadLog) {
          db.prepare(`
            UPDATE t_logs 
            SET valeur_apres = '{"read": true}', is_read = 1, is_dirty = 1 
            WHERE id_log = ?
          `).run(unreadLog.id_log);
        } else {
          log.error("Log introuvable pour la carte ID:", id);
        }

        const payload = {
          read: false,
          noms: card.noms,
          prenoms: card.prenoms,
          rangement: card.rangement,
          contact: card.contact,
          site_id: siteId
        };
        db.prepare(`
          INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id)
          VALUES (NULL, 'SYSTEM', 'CARTE_ABSENTE_RETROUVEE', ?, ?, ?, 1, ?)
        `).run(message, JSON.stringify(payload), uuidv4(), siteId);
      } catch (err) {
        log.error('Failed to log or notify CARTE_ABSENTE_RETROUVEE:', err);
      }
      
      if (card.sync_id) {
        // Payload complet requis (site_id manquant sinon -> rejet systématique par
        // mapCardPayload() dans outbox.service.ts, même défaut que delivrerCarte()).
        const fullCard = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
        enqueueOutbox(card.sync_id, 't_cartes', 'UPDATE', fullCard);
        scheduleOutboxProcessing();
      }
    }

    return result;
  });

  // Même garde-fou FTS5 que delivrerCarte() (cartes.queries.ts) : l'UPDATE ci-dessus touche
  // `rangement`, ce qui déclenche systématiquement trg_cartes_au et peut remonter "database
  // disk image is malformed" en cas de corruption des shadow tables FTS5 (incident confirmé
  // sur ce chemin précis, cartes:resoudreAbsence). Même remède éprouvé : supprimer le trigger
  // fautif, rejouer la même transaction (sûr — la première a été intégralement annulée par
  // SQLite, aucun état partiel), puis planifier un reset nucléaire FTS5 en arrière-plan.
  try {
    return runTx();
  } catch (err: any) {
    if (err.code === 'SQLITE_CORRUPT_VTAB' || (err.message && (err.message.includes('malformed') || err.message.includes('corrupt')))) {
      log.warn('[resoudreAbsence] FTS5 shadow tables corrompues. Suppression du trigger pour résolution sécurisée...');
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
      const result = runTx();
      log.info('[resoudreAbsence] Résolution exécutée sans FTS5. Reset nucléaire planifié en arrière-plan...');
      nuclearResetFts5();
      return result;
    }
    throw err;
  }
}

export function declarerPerdue(id: number, currentUser?: { role: string; site_id?: number; centre_id?: number }) {
  const db = getDatabase()!;
  // Quadriptyque transactionnel (skill moteur-sync-offline-first) : UPDATE + relecture +
  // INSERT t_logs + enqueueOutbox regroupés dans une transaction unique (même pattern que
  // resoudreAbsence()/reactiverCarte() ci-dessus) — un échec à n'importe quelle étape
  // (notamment enqueueOutbox, hors try/catch mais à l'intérieur de la transaction) annule
  // intégralement l'UPDATE sur t_cartes, plutôt que de le laisser commité isolément. Pas de
  // garde-fou FTS5 ici : statut_physique/escalade_niveau ne sont pas surveillés par
  // trg_cartes_au (contrairement à `rangement` dans resoudreAbsence()/reactiverCarte()).
  const runTx = db.transaction(() => {
    const now = new Date().toISOString();
    let query = `
      UPDATE t_cartes
      SET statut_physique = 'PERDUE', escalade_niveau = 'RESOLU', updated_at = @now, action_at = @now, is_dirty = 1
      WHERE id_carte = @id
    `;
    const params: any = { now, id };
    if (currentUser && currentUser.role !== 'SUPER ADMIN') {
      query += ' AND site_id = @site_id';
      params.site_id = currentUser.site_id;
      // Cloisonnement §3 (P1-1) : restreint également par centre pour un ADMIN_CENTRE (même
      // raisonnement que resoudreAbsence() ci-dessus) — ADMINISTRATEUR_SITE/SUPER ADMIN non
      // restreints par centre.
      if (currentUser.role === 'ADMIN_CENTRE') {
        query += ' AND centre_id = @centre_id';
        params.centre_id = currentUser.centre_id;
      }
    }
    const result = db.prepare(query).run(params);
    if (result.changes === 0) {
      throw new Error("Accès non autorisé aux données de ce site");
    }

    const card = db.prepare('SELECT site_id, noms, prenoms, contact, agent_signalement_absence, sync_id FROM t_cartes WHERE id_carte = ?').get(id) as any;
    if (card) {
      const siteId = card.site_id;
      const message = `La carte de ${card.noms} ${card.prenoms} a été confirmée PERDUE par l'administration.`;
      const payload = {
        read: false,
        noms: card.noms,
        prenoms: card.prenoms,
        contact: card.contact || '—',
        isLost: true,
        site_id: siteId
      };
      try {
        const unreadLog = db.prepare(`
          SELECT id_log FROM t_logs
          WHERE action = 'CARTE_ABSENTE_SIGNALEE'
          AND json_extract(valeur_apres, '$.read') = false
          AND json_extract(valeur_apres, '$.id_carte') = ?
        `).get(id) as { id_log: number } | undefined;

        if (unreadLog) {
          db.prepare(`
            UPDATE t_logs
            SET valeur_apres = '{"read": true}', is_read = 1, is_dirty = 1
            WHERE id_log = ?
          `).run(unreadLog.id_log);
        } else {
          log.error("Log introuvable pour la carte ID:", id);
        }

        db.prepare(`
          INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id)
          VALUES (NULL, 'SYSTEM', 'CARTE_PERDUE_CONFIRMEE', ?, ?, ?, 1, ?)
        `).run(message, JSON.stringify(payload), uuidv4(), siteId);
      } catch (err) {
        log.error('Failed to log or update on declarerPerdue:', err);
      }

      // Propagation vers Supabase : même défaut confirmé que resoudreAbsence()/escaladerAuSite()
      // ci-dessus — sans cet enqueue, la confirmation de perte reste locale tant qu'aucun envoi
      // manuel en masse n'est déclenché. Payload complet requis (site_id manquant sinon -> rejet
      // systématique par mapCardPayload() dans outbox.service.ts).
      if (card.sync_id) {
        const fullCard = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
        enqueueOutbox(card.sync_id, 't_cartes', 'UPDATE', fullCard);
        scheduleOutboxProcessing();
      }
    }

    return result;
  });

  return runTx();
}

export function getHistoriquePertes(siteId?: number): any[] {
  const db = getDatabase()!;
  let query = `
    SELECT c.id_carte, c.noms, c.prenoms, c.contact, c.num_secu, c.rangement, s.nom as site_nom,
           l.date_heure as date_perte
    FROM t_cartes c
    LEFT JOIN t_sites s ON c.site_id = s.id
    LEFT JOIN t_logs l ON l.action = 'CARTE_PERDUE_CONFIRMEE' AND json_extract(l.valeur_apres, '$.id_carte') = c.id_carte
    WHERE c.statut_physique = 'PERDUE'
  `;
  const params: any[] = [];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND c.site_id = ?';
    params.push(Number(siteId));
  }
  query += ' ORDER BY l.date_heure DESC';
  return db.prepare(query).all(...params);
}

export function reactiverCarte(id: number, nouveauRangement: string, currentUser?: { role: string; site_id?: number; centre_id?: number }) {
  const db = getDatabase()!;
  const runTx = db.transaction(() => {
    const now = new Date().toISOString();
    let updateQuery = `
      UPDATE t_cartes 
      SET statut_physique = 'OK', statut = 'EN STOCK', rangement = @rangement, updated_at = @now, action_at = @now, is_dirty = 1
      WHERE id_carte = @id
    `;
    const params: any = { now, id, rangement: nouveauRangement ? nouveauRangement.toUpperCase().trim() : null };
    if (currentUser && currentUser.role !== 'SUPER ADMIN') {
      updateQuery += ' AND site_id = @site_id';
      params.site_id = currentUser.site_id;
      // Cloisonnement §3 (P1-1) : restreint également par centre pour un ADMIN_CENTRE (même
      // raisonnement que resoudreAbsence()/declarerPerdue() ci-dessus) — ADMINISTRATEUR_SITE/
      // SUPER ADMIN non restreints par centre.
      if (currentUser.role === 'ADMIN_CENTRE') {
        updateQuery += ' AND centre_id = @centre_id';
        params.centre_id = currentUser.centre_id;
      }
    }
    const result = db.prepare(updateQuery).run(params);
    if (result.changes === 0) {
      throw new Error("Accès non autorisé aux données de ce site");
    }

    const card = db.prepare('SELECT site_id, noms, prenoms, rangement, contact, sync_id FROM t_cartes WHERE id_carte = ?').get(id) as any;
    if (card) {
      const siteId = card.site_id;
      const message = `La carte de ${card.noms} ${card.prenoms} a été confirmée RETROUVÉE (Rangement: ${card.rangement || 'non spécifié'}) par l'administration.`;
      const payload = {
        read: false,
        noms: card.noms,
        prenoms: card.prenoms,
        rangement: card.rangement || 'Non classé',
        contact: card.contact || '—',
        site_id: siteId
      };

      db.prepare(`
        INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id)
        VALUES (NULL, 'SYSTEM', 'CARTE_PERDUE_RETROUVEE', ?, ?, ?, 1, ?)
      `).run(message, JSON.stringify(payload), uuidv4(), siteId);

      // Propagation vers Supabase (même modèle que signalerAbsence() ci-dessus) : sans cet
      // enqueue, la réactivation (retour en stock) restait locale, désynchronisant durablement
      // la carte entre postes. Payload complet requis par mapCardPayload() (site_id).
      if (card.sync_id) {
        const fullCard = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
        enqueueOutbox(card.sync_id, 't_cartes', 'UPDATE', fullCard);
        if (networkMonitor.getState() === 'ONLINE') {
          scheduleOutboxProcessing();
        }
      }
    }

    return result;
  });

  // Même garde-fou FTS5 que delivrerCarte()/resoudreAbsence() (voir plus haut) : l'UPDATE
  // ci-dessus touche `rangement`, ce qui déclenche systématiquement trg_cartes_au et peut
  // remonter "database disk image is malformed" en cas de corruption des shadow tables FTS5
  // (incident confirmé sur ce chemin précis, cartes:reactiverCarte). Même remède éprouvé :
  // supprimer le trigger fautif, rejouer la même transaction (sûr — la première a été
  // intégralement annulée par SQLite, aucun état partiel), puis planifier un reset nucléaire
  // FTS5 en arrière-plan.
  try {
    return runTx();
  } catch (err: any) {
    if (err.code === 'SQLITE_CORRUPT_VTAB' || (err.message && (err.message.includes('malformed') || err.message.includes('corrupt')))) {
      log.warn('[reactiverCarte] FTS5 shadow tables corrompues. Suppression du trigger pour réactivation sécurisée...');
      db.exec('DROP TRIGGER IF EXISTS trg_cartes_au;');
      const result = runTx();
      log.info('[reactiverCarte] Réactivation exécutée sans FTS5. Reset nucléaire planifié en arrière-plan...');
      nuclearResetFts5();
      return result;
    }
    throw err;
  }
}

export function getAbsencesCentre(centreId: number): any[] {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT c.*, 
           u.nom_user || ' ' || u.prenom_user as agent_nom_complet,
           u.role as agent_role
    FROM t_cartes c
    LEFT JOIN t_users u ON c.agent_signalement_absence = u.login
    WHERE c.statut_physique = 'ABSENT' 
      AND c.escalade_niveau = 'CENTRE' 
      AND c.centre_id = ? 
    ORDER BY c.date_signalement_absence DESC
  `).all(centreId);
}

// Visibilité ADMIN_CENTRE des signalements que ce centre a escaladés au site puis qui ont été
// résolus (peu importe l'issue finale : retrouvée ou perdue, voir escalade_niveau='RESOLU'
// désormais posé par resoudreAbsence()/declarerPerdue()/reactiverCarte()). L'EXISTS sur t_logs
// (action='CARTE_ABSENTE_ESCALADEE', json_extract sur valeur_apres.id_carte) reprend exactement
// le pattern déjà utilisé par resoudreAbsence()/declarerPerdue() ci-dessus pour retrouver un log
// par id_carte.
// Tri sur `action_at` (et non `updated_at`) : même raisonnement que getSignalementsResolus
// ci-dessus (migration lot 2) — resoudreAbsence()/declarerPerdue() posent les deux colonnes à la
// même valeur `now`. SELECT c.* inchangé (renvoie déjà `action_at`) : seul l'ORDER BY change,
// EscaladesResoluesTab.tsx lit désormais `action_at` pour l'affichage "Résolue le".
export function getEscaladesResoluesCentre(centreId: number): any[] {
  const db = getDatabase()!;
  return db.prepare(`
    SELECT c.*,
           u.nom_user || ' ' || u.prenom_user as agent_nom_complet,
           u.role as agent_role
    FROM t_cartes c
    LEFT JOIN t_users u ON c.agent_signalement_absence = u.login
    WHERE c.escalade_niveau = 'RESOLU'
      AND c.centre_id = ?
      AND EXISTS (
        SELECT 1 FROM t_logs l
        WHERE l.action = 'CARTE_ABSENTE_ESCALADEE'
          AND json_extract(l.valeur_apres, '$.id_carte') = c.id_carte
      )
    ORDER BY c.action_at DESC
  `).all(centreId);
}

export function getAbsencesSite(siteId?: number): any[] {
  const db = getDatabase()!;
  let query = `
    SELECT c.*,
           u.nom_user || ' ' || u.prenom_user as agent_nom_complet,
           u.role as agent_role
    FROM t_cartes c
    LEFT JOIN t_users u ON c.agent_signalement_absence = u.login
    WHERE c.statut_physique = 'ABSENT' 
      AND c.escalade_niveau = 'SITE'
  `;
  const params: any[] = [];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND c.site_id = ?';
    params.push(Number(siteId));
  }
  query += ' ORDER BY c.date_signalement_absence DESC';
  return db.prepare(query).all(...params);
}

export function escaladerAuSite(id: number, currentUser?: { id_user?: number; login?: string; site_id?: number; centre_id?: number; role?: string }) {
  const db = getDatabase()!;
  // Quadriptyque transactionnel (skill moteur-sync-offline-first) : UPDATE + relecture +
  // INSERT t_logs + enqueueOutbox regroupés dans une transaction unique (même pattern que
  // resoudreAbsence()/reactiverCarte()/declarerPerdue() ci-dessus) — un échec à n'importe
  // quelle étape (notamment enqueueOutbox, hors try/catch mais à l'intérieur de la
  // transaction) annule intégralement l'UPDATE sur t_cartes, plutôt que de le laisser commité
  // isolément. Pas de garde-fou FTS5 ici : escalade_niveau n'est pas surveillé par
  // trg_cartes_au (contrairement à `rangement` dans resoudreAbsence()/reactiverCarte()).
  const runTx = db.transaction(() => {
    const now = new Date().toISOString();

    let query = `
      UPDATE t_cartes
      SET escalade_niveau = 'SITE', updated_at = @now, action_at = @now, is_dirty = 1
      WHERE id_carte = @id AND statut_physique = 'ABSENT' AND escalade_niveau = 'CENTRE'
    `;
    const params: any = { now, id };
    // Sécurité (cloisonnement §3, même modèle que resoudreAbsence/declarerPerdue/reactiverCarte
    // ci-dessus) : pour tout rôle non-SUPER-ADMIN, restreint l'escalade aux cartes du site de
    // l'appelant — absent avant ce correctif (aucun filtrage site_id n'existait ici).
    if (currentUser && currentUser.role !== 'SUPER ADMIN') {
      query += ' AND site_id = @site_id';
      params.site_id = currentUser.site_id;
      // Cloisonnement §3 (P1-1) : restreint également par centre pour un ADMIN_CENTRE (même
      // raisonnement que resoudreAbsence()/declarerPerdue()/reactiverCarte() ci-dessus) —
      // ADMINISTRATEUR_SITE/SUPER ADMIN non restreints par centre.
      if (currentUser.role === 'ADMIN_CENTRE') {
        query += ' AND centre_id = @centre_id';
        params.centre_id = currentUser.centre_id;
      }
    }
    const result = db.prepare(query).run(params);

    if (result.changes > 0) {
      const card = db.prepare('SELECT site_id, noms, prenoms, sync_id FROM t_cartes WHERE id_carte = ?').get(id) as any;
      if (card) {
        const siteId = card.site_id;
        const agent = currentUser?.login || 'ADMIN_CENTRE';
        const message = `⚠️ [ESCALADE] La carte de ${card.noms} ${card.prenoms} a été escaladée à l'Administrateur Site par ${agent}.`;
        try {
          db.prepare(`
            INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id)
            VALUES (?, ?, 'CARTE_ABSENTE_ESCALADEE', ?, ?, ?, 1, ?)
          `).run(currentUser?.id_user || null, agent, message, JSON.stringify({ read: false, id_carte: id }), uuidv4(), siteId);
        } catch (err) {
          log.error('Failed to log CARTE_ABSENTE_ESCALADEE:', err);
        }

        // Propagation vers Supabase : sans cet enqueue, l'escalade reste locale et un
        // ADMINISTRATEUR_SITE sur un autre poste ne voit jamais la carte dans sa file
        // d'attente (défaut confirmé, même pattern que signalerAbsence/resoudreAbsence
        // ci-dessus). Payload complet requis (site_id manquant sinon -> rejet systématique
        // par mapCardPayload() dans outbox.service.ts).
        if (card.sync_id) {
          const fullCard = db.prepare('SELECT * FROM t_cartes WHERE id_carte = ?').get(id) as any;
          enqueueOutbox(card.sync_id, 't_cartes', 'UPDATE', fullCard);
          scheduleOutboxProcessing();
        }
      }
    }
    return result;
  });

  return runTx();
}

export function archiveSignalement(id_carte: number, login_user: string) {
  const db = getDatabase()!;
  try {
    db.prepare(`
      INSERT OR IGNORE INTO t_agent_archives (id_carte, login_user)
      VALUES (?, ?)
    `).run(id_carte, login_user);
    return true;
  } catch (err) {
    log.error('Failed to archive signalement:', err);
    return false;
  }
}

export function getArchivedSignalements(login_user: string): number[] {
  const db = getDatabase()!;
  try {
    const records = db.prepare(`SELECT id_carte FROM t_agent_archives WHERE login_user = ?`).all(login_user) as {id_carte: number}[];
    return records.map(r => r.id_carte);
  } catch (err) {
    // Si la table n'existe pas encore
    return [];
  }
}
