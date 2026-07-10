import { getDatabase } from '../connection';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';

export function signalerAbsence(id: number, agent: string, currentUser?: { role: string; site_id?: number; id_user?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  let query = `
    UPDATE t_cartes SET statut_physique = 'ABSENT',
      agent_signalement_absence = @agent, date_signalement_absence = @now,
      updated_at = @now, is_dirty = 1
    WHERE id_carte = @id
  `;
  const params: any = { agent, now, id };
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
    const message = `🚨 [SIGNALEMENT - ABSENCE] La carte de ${card.noms} ${card.prenoms} est signalée absente par ${agent}.`;
    const userId = currentUser?.id_user || null;
    const userLogin = agent;
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

export function resoudreAbsence(id: number, data: { status: string; agent: string; note: string; rangement: string }, currentUser?: { role: string; site_id?: number }) {
  const db = getDatabase()!;
  const now = new Date().toISOString();
  let query = `
    UPDATE t_cartes 
    SET statut_physique = @status, rangement = @rangement, updated_at = @now, is_dirty = 1
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
