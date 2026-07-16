import { getDatabase } from '../connection';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';

export function signalerAbsence(id: number, agentLogin: string, agentInfo: string, commentaire: string = '', currentUser?: { role: string; site_id?: number; id_user?: number; centre_id?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  let query = `
    UPDATE t_cartes SET statut_physique = 'ABSENT',
      agent_signalement_absence = @agentLogin, date_signalement_absence = @now,
      note_signalement_absence = @commentaire, escalade_niveau = 'CENTRE',
      updated_at = @now, is_dirty = 1
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

  const card = db.prepare('SELECT site_id, noms, prenoms FROM t_cartes WHERE id_carte = ?').get(id) as any;
  if (card) {
    const siteId = card.site_id;
    const message = `🚨 [SIGNALEMENT - ABSENCE] La carte de ${card.noms} ${card.prenoms} est signalée absente par ${agentInfo}. ${commentaire ? 'Note: ' + commentaire : ''}`;
    const userId = currentUser?.id_user || null;
    const userLogin = agentLogin;
    const logPayload = JSON.stringify({ read: false, id_carte: id });

    try {
      db.prepare(`
        INSERT INTO t_logs (id_user, login_user, action, detail, valeur_apres, sync_id, is_dirty, site_id)
        VALUES (?, ?, 'CARTE_ABSENTE_SIGNALEE', ?, ?, ?, 1, ?)
      `).run(userId, userLogin, message, logPayload, uuidv4(), siteId);
    } catch (err) {
      log.error('Failed to log CARTE_ABSENTE_SIGNALEE:', err);
    }
  }

  return result;
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

export function getSignalementsResolus(agent: string, siteId?: number): any[] {
  const db = getDatabase()!;
  let query = "SELECT * FROM t_cartes WHERE agent_signalement_absence = ? AND escalade_niveau = 'RESOLU'";
  const params: any[] = [agent];
  if (siteId !== undefined && siteId !== null) {
    query += ' AND site_id = ?';
    params.push(Number(siteId));
  }
  query += ' ORDER BY updated_at DESC';
  return db.prepare(query).all(...params);
}

export function resoudreAbsence(id: number, data: { status: string; agent: string; note: string; rangement: string }, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  let query = `
    UPDATE t_cartes 
    SET statut_physique = @status, rangement = @rangement, escalade_niveau = 'RESOLU', updated_at = @now, is_dirty = 1
    WHERE id_carte = @id
  `;
  const params: any = { status: data.status, rangement: data.rangement ? data.rangement.toUpperCase().trim() : null, now, id };
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    query += ' AND site_id = @site_id';
    params.site_id = currentUser.site_id;
  }
  const result = db.prepare(query).run(params);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }

  const card = db.prepare('SELECT site_id, noms, prenoms, rangement, contact FROM t_cartes WHERE id_carte = ?').get(id) as any;
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
  }

  return result;
}

export function declarerPerdue(id: number, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  let query = `
    UPDATE t_cartes 
    SET statut_physique = 'PERDUE', updated_at = @now, is_dirty = 1
    WHERE id_carte = @id
  `;
  const params: any = { now, id };
  if (currentUser && currentUser.role !== 'SUPER ADMIN') {
    query += ' AND site_id = @site_id';
    params.site_id = currentUser.site_id;
  }
  const result = db.prepare(query).run(params);
  if (result.changes === 0) {
    throw new Error("Accès non autorisé aux données de ce site");
  }

  const card = db.prepare('SELECT site_id, noms, prenoms, contact, agent_signalement_absence FROM t_cartes WHERE id_carte = ?').get(id) as any;
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
  }

  return result;
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

export function reactiverCarte(id: number, nouveauRangement: string, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  return db.transaction(() => {
    const now = new Date().toISOString();
    let updateQuery = `
      UPDATE t_cartes 
      SET statut_physique = 'OK', statut = 'EN STOCK', rangement = @rangement, updated_at = @now, is_dirty = 1
      WHERE id_carte = @id
    `;
    const params: any = { now, id, rangement: nouveauRangement ? nouveauRangement.toUpperCase().trim() : null };
    if (currentUser && currentUser.role !== 'SUPER ADMIN') {
      updateQuery += ' AND site_id = @site_id';
      params.site_id = currentUser.site_id;
    }
    const result = db.prepare(updateQuery).run(params);
    if (result.changes === 0) {
      throw new Error("Accès non autorisé aux données de ce site");
    }

    const card = db.prepare('SELECT site_id, noms, prenoms, rangement, contact FROM t_cartes WHERE id_carte = ?').get(id) as any;
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
    }

    return result;
  })();
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

export function escaladerAuSite(id: number, currentUser?: { id_user?: number; login?: string; site_id?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  
  let query = `
    UPDATE t_cartes 
    SET escalade_niveau = 'SITE', updated_at = @now, is_dirty = 1
    WHERE id_carte = @id AND statut_physique = 'ABSENT' AND escalade_niveau = 'CENTRE'
  `;
  const params: any = { now, id };
  const result = db.prepare(query).run(params);
  
  if (result.changes > 0) {
    const card = db.prepare('SELECT site_id, noms, prenoms FROM t_cartes WHERE id_carte = ?').get(id) as any;
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
    }
  }
  return result;
}
