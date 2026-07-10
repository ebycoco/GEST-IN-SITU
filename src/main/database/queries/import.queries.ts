import { getDatabase } from '../connection';

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

export function clearImportTemp(siteId: number) {
  return getDatabase()!.prepare('DELETE FROM t_import_temp').run();
}

export function importBatch(rows: Record<string, string>[], agentSaisie: string, siteId: number) {
  const db = getDatabase()!;
  const insertStmt = db.prepare(`
    INSERT INTO t_import_temp (noms, prenoms, date_de_naissance, num_secu,
      lieu_de_naissance, contact, lieu_enrolement, rangement, statut,
      date_delivrance, agent_saisie, cle_doublon, cle_doublon_flex,
      nom_retirant, num_retirant, site_id)
    VALUES (@noms, @prenoms, @date_de_naissance, @num_secu,
      @lieu_de_naissance, @contact, @lieu_enrolement, @rangement, @statut,
      @date_delivrance, @agent_saisie, @cle_doublon, @cle_doublon_flex,
      @nom_retirant, @num_retirant, @siteId)
  `);

  const insertMany = db.transaction((items: Record<string, string>[]) => {
    for (const row of items) {
      const noms = removeAccents(row.noms || '');
      const prenoms = removeAccents(row.prenoms || '');
      const ddn = row.date_de_naissance || '';
      const lieuN = removeAccents(row.lieu_de_naissance || '');
      const contact = normalizeContact(row.contact || '');
      
      const cleDbl = `${noms}|${prenoms}|${ddn}|${lieuN}|${contact}`;
      const cleFlex = `${noms}|${prenoms}|${ddn}|${contact}`;

      const rawStatut = removeAccents((row.statut || '').toUpperCase().trim());
      let finalStatut = 'EN STOCK';
      let nomRetirant = null;
      let numRetirant = null;

      if (rawStatut.startsWith('DELIV') || 
          rawStatut.startsWith('DISTRIB') || 
          rawStatut.startsWith('REMI') || 
          rawStatut === 'OK' || 
          rawStatut === 'RECU' ||
          rawStatut.startsWith('RETIRE')) {
        finalStatut = 'DELIVRE';
      } else if (rawStatut === 'ANNULE') {
        finalStatut = 'ANNULE';
      } else if (rawStatut === 'STOCK' || rawStatut === 'EN STOCK' || !rawStatut) {
        finalStatut = 'EN STOCK';
      }

      if (rawStatut.startsWith('RETIRE PAR')) {
        finalStatut = 'DELIVRE';
        const detail = rawStatut.replace('RETIRE PAR', '').trim();
        
        if (detail === 'LUI MEME' || detail === 'ELLE MEME') {
          nomRetirant = `${noms} ${prenoms}`;
          numRetirant = contact;
        } else {
          const phoneMatch = detail.match(/(?:(?:\+|00)225)?\s?(\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d[\s\.]?\d?)/);
          if (phoneMatch) {
            numRetirant = phoneMatch[0].replace(/[\s\.]/g, '');
            nomRetirant = detail.replace(phoneMatch[0], '').replace(/[,]/g, '').trim();
          } else {
            nomRetirant = detail;
            numRetirant = contact;
          }
        }
      }

      insertStmt.run({
        noms, prenoms, date_de_naissance: ddn,
        num_secu: (row.num_secu || '').trim(),
        lieu_de_naissance: lieuN,
        contact,
        lieu_enrolement: (row.lieu_enrolement || '').toUpperCase().trim(),
        rangement: (row.rangement || '').toUpperCase().trim(),
        statut: finalStatut,
        date_delivrance: row.date_delivrance || (finalStatut === 'DELIVRE' ? new Date().toISOString().split('T')[0] : ''),
        agent_saisie: agentSaisie,
        cle_doublon: cleDbl,
        cle_doublon_flex: cleFlex,
        nom_retirant: nomRetirant,
        num_retirant: numRetirant,
        siteId
      });
    }
  });

  insertMany(rows);
  return rows.length;
}

export async function fusionnerImport(siteId: number): Promise<{ updated: number; inserted: number }> {
  const db = getDatabase()!;
  const now = new Date().toISOString();

  // Étape 1 : Mettre à jour les cartes locales existantes
  const updateResult = await new Promise<any>((resolve) => {
    setImmediate(() => {
      const res = db.prepare(`
        UPDATE t_cartes
        SET 
          statut = t_import_temp.statut,
          nom_retirant = t_import_temp.nom_retirant,
          num_retirant = t_import_temp.num_retirant,
          date_delivrance = COALESCE(t_cartes.date_delivrance, t_import_temp.date_delivrance),
          updated_at = @now,
          is_dirty = 1
        FROM t_import_temp
        WHERE t_cartes.cle_doublon = t_import_temp.cle_doublon
          AND t_cartes.site_id = @siteId
          AND t_import_temp.site_id = @siteId
          AND (t_cartes.statut = 'EN STOCK' OR t_cartes.statut IS NULL OR t_cartes.statut = '')
          AND t_import_temp.statut = 'DELIVRE'
      `).run({ now, siteId });
      resolve(res);
    });
  });

  // Pause asynchrone pour l'Event Loop
  await new Promise((resolve) => setImmediate(resolve));

  // Étape 2 : Insérer les nouvelles cartes
  const insertResult = await new Promise<any>((resolve) => {
    setImmediate(() => {
      const res = db.prepare(`
        INSERT INTO t_cartes (
          noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance,
          contact, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie,
          cle_doublon, cle_doublon_flex, nom_retirant, num_retirant, site_id, sync_id, created_at, updated_at, is_dirty
        )
        SELECT 
          noms, prenoms, date_de_naissance, num_secu, lieu_de_naissance,
          contact, lieu_enrolement, rangement, statut, date_delivrance, agent_saisie,
          cle_doublon, cle_doublon_flex, nom_retirant, num_retirant, @siteId, lower(hex(randomblob(16))),
          @now, @now, 1
        FROM t_import_temp
        WHERE t_import_temp.site_id = @siteId
          AND cle_doublon NOT IN (SELECT cle_doublon FROM t_cartes WHERE site_id = @siteId AND cle_doublon IS NOT NULL)
      `).run({ now, siteId });
      resolve(res);
    });
  });

  // Pause asynchrone
  await new Promise((resolve) => setImmediate(resolve));

  // Étape 3 : Nettoyer la table temporaire
  db.prepare('DELETE FROM t_import_temp WHERE site_id = ?').run(siteId);

  return { updated: updateResult.changes, inserted: insertResult.changes };
}

export function getImportAnomalies(siteId: number) {
  const db = getDatabase()!;
  return db.prepare('SELECT * FROM t_import_anomalies ORDER BY id DESC').all();
}

export function clearImportAnomalies(siteId: number) {
  const db = getDatabase()!;
  return db.prepare('DELETE FROM t_import_anomalies').run();
}
