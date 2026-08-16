// ATTENTION SYNCHRONISATION MANUELLE : ce mapping est dupliqué (par nécessité
// technique, pas par choix) dans src/main/sync/upstream.ts (fonction locale
// mapCardPayload) ET dans src/main/workers/upload-worker.js (const mappedCards).
// upload-worker.js tourne dans un worker_threads séparé, copié tel quel sans
// passer par le bundler TS (voir copyWorkerPlugin dans electron.vite.config.ts)
// — il ne peut donc pas importer directement ce fichier .ts. Tout ajout/retrait
// de champ carte->Supabase doit être répercuté MANUELLEMENT dans les 3 endroits.
export function mapCardPayload(c: any): any {
  if (!c.site_id) throw new Error("Erreur de validation de la carte : site_id manquant.");
  
  const rawNoms = (c.noms == null) ? '' : String(c.noms);
  const rawPrenoms = (c.prenoms == null) ? '' : String(c.prenoms);
  let rawDate = (c.date_de_naissance == null) ? '' : String(c.date_de_naissance);
  
  rawDate = rawDate.trim();
  const finalDate = rawDate === '' ? null : rawDate;
  
  if (finalDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(finalDate)) {
      throw new Error("Format de date invalide, correction requise avant envoi");
  }
  
  if (rawNoms.trim() === '' && rawPrenoms.trim() === '' && finalDate === null) {
      throw new Error("Carte sans identité exploitable — noms, prénoms et date de naissance tous vides");
  }

  return {
    sync_id: c.sync_id, noms: c.noms, prenoms: c.prenoms || '',
    date_naissance: finalDate, lieu_naissance: c.lieu_de_naissance || null,
    num_secu: c.num_secu || null, lieu_enrolement: c.lieu_enrolement || null, contact: c.contact || null,
    rangement: c.rangement || null, statut: c.statut || 'EN STOCK', statut_physique: c.statut_physique || 'OK',
    date_delivrance: c.date_delivrance || null, agent_saisie: c.agent_saisie || null,
    agent_distributeur: c.agent_distributeur || null, centre_retrait: c.centre_retrait || null,
    nom_retirant: c.nom_retirant || null, num_retirant: c.num_retirant || null,
    contact_retirant: c.contact_retirant || null, relation_retirant: c.relation_retirant || null,
    cle_doublon: c.cle_doublon || null, cle_doublon_flex: c.cle_doublon_flex || null,
    doublon_declare_par: c.doublon_declare_par || null, doublon_declare_le: c.doublon_declare_le || null,
    doublon_motif: c.doublon_motif || null, statut_avant_doublon: c.statut_avant_doublon || null,
    doublon_annule_par: c.doublon_annule_par || null, doublon_annule_le: c.doublon_annule_le || null,
    doublon_motif_annulation: c.doublon_motif_annulation || null,
    agent_signalement_absence: c.agent_signalement_absence || null,
    date_signalement_absence: c.date_signalement_absence || null,
    date_resolution_absence: c.date_resolution_absence || null,
    agent_resolution_absence: c.agent_resolution_absence || null,
    note_resolution: c.note_resolution || null,
    note_signalement_absence: c.note_signalement_absence || null,
    escalade_niveau: c.escalade_niveau || 'CENTRE', has_invalid_date: c.has_invalid_date ?? 0,
    notif_lue: c.notif_lue ?? 1,
    id_site: c.site_id, id_centre: c.centre_id || null, id_poste: c.poste_id || null,
    qr_code_data: c.qr_code_data || null, is_exported: c.is_exported || 0,
    created_by: c.created_by || null, updated_at: c.updated_at || new Date().toISOString()
  };
}
