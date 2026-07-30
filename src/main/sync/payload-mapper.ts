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
    cle_doublon: c.cle_doublon || null, cle_doublon_flex: c.cle_doublon_flex || null,
    agent_signalement_absence: c.agent_signalement_absence || null,
    date_signalement_absence: c.date_signalement_absence || null,
    date_resolution_absence: c.date_resolution_absence || null,
    agent_resolution_absence: c.agent_resolution_absence || null,
    note_resolution: c.note_resolution || null, notif_lue: c.notif_lue ?? 1,
    id_site: c.site_id, id_centre: c.centre_id || null, id_poste: c.poste_id || null,
    qr_code_data: c.qr_code_data || null, is_exported: c.is_exported || 0,
    created_by: c.created_by || null, updated_at: c.updated_at || new Date().toISOString()
  };
}
