-- ============================================================
-- Test de supabase/migrations/0006_t_cartes_status_guard.sql
-- A executer sur le projet DEV uniquement (ajadkziqaskadlzboeqo), apres la
-- migration. Tout se passe dans une transaction ANNULEE (ROLLBACK final) :
-- aucune donnee ne reste en base. Le resultat est la table _t (un cas par
-- ligne, colonne ok = true/false), affichee juste avant le ROLLBACK.
-- Horodatages fixes (now() est constant dans une transaction).
-- ============================================================
BEGIN;

CREATE TEMP TABLE _t (n INT, cas TEXT, ok BOOLEAN, detail TEXT) ON COMMIT DROP;

INSERT INTO public.t_sites (id, nom, code) VALUES (990001, 'SITE TEST 0006', 'T0006');

DO $$
DECLARE
  r public.t_cartes;
  n_conf INT;
  c_reason TEXT;
BEGIN
  -- ---------- 0. Briques : GREATEST et NULL, fn_try_ts ----------
  INSERT INTO _t VALUES (0, 'GREATEST(NULL,NULL) est NULL ; GREATEST(NULL,x)=x ; fn_try_ts(texte invalide) NULL',
    GREATEST(NULL::timestamptz, NULL::timestamptz) IS NULL
      AND GREATEST(NULL::timestamptz, '2026-10-27T09:00:00Z'::timestamptz) = '2026-10-27T09:00:00Z'::timestamptz
      AND public.fn_try_ts('pas une date') IS NULL
      AND public.fn_try_ts('') IS NULL
      AND public.fn_try_ts('2026-10-27T11:00:00.000Z') = '2026-10-27T11:00:00Z'::timestamptz,
    NULL);

  -- Cartes de depart (INSERT direct : le trigger UPDATE ne joue pas)
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, date_delivrance, agent_distributeur, nom_retirant, contact, id_site, updated_at, action_at)
  VALUES
    ('t6-c1', 'C1', 'X', 'DELIVRE', '2026-10-27T09:00:00Z', 'AGENT_A', 'RETIRANT_A', '0100000000', 990001, '2026-10-27T10:00:00Z', '2026-10-27T09:00:00Z'),
    ('t6-c2', 'C2', 'X', 'DELIVRE', '2026-10-27T09:00:00Z', 'AGENT_A', 'RETIRANT_A', NULL,         990001, '2026-10-27T10:00:00Z', '2026-10-27T09:00:00Z'),
    ('t6-c5', 'C5', 'X', 'DELIVRE', '2026-10-27T09:00:00Z', 'AGENT_A', 'RETIRANT_A', NULL,         990001, '2026-10-27T10:00:00Z', '2026-10-27T09:00:00Z'),
    ('t6-c6', 'C6', 'X', 'DELIVRE', '2026-10-27T09:00:00Z', 'AGENT_A', 'RETIRANT_A', NULL,         990001, '2026-10-27T10:00:00Z', '2026-10-27T09:00:00Z'),
    ('t6-c7', 'C7', 'X', 'DELIVRE', '2026-10-27T09:00:00Z', 'AGENT_A', 'RETIRANT_A', NULL,         990001, '2026-10-27T10:00:00Z', '2026-10-27T09:00:00Z'),
    ('t6-c9', 'C9', 'X', 'DELIVRE', '2026-10-27T09:00:00Z', 'AGENT_A', 'RETIRANT_A', NULL,         990001, '2026-10-27T10:00:00Z', '2026-10-27T09:00:00Z'),
    ('t6-c11','C11','X', 'DELIVRE', '2026-10-27T09:00:00Z', 'AGENT_A', 'RETIRANT_A', NULL,         990001, '2026-10-27T10:00:00Z', '2026-10-27T09:00:00Z');
  -- Carte deja passee par une annulation ancienne (08:00), puis delivree D1
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, date_delivrance, agent_distributeur, nom_retirant,
    apurement_annulation_par, apurement_annulation_le, id_site, updated_at, action_at)
  VALUES ('t6-c10', 'C10', 'X', 'DELIVRE', '2026-10-27T09:00:00Z', 'AGENT_A', 'RETIRANT_A',
    'ADMIN', '2026-10-27T08:00:00.000Z', 990001, '2026-10-27T10:00:00Z', '2026-10-27T09:00:00Z');
  -- Carte EN STOCK apres une annulation d'apurement (11:00)
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, apurement_annulation_par, apurement_annulation_le, id_site, updated_at)
  VALUES ('t6-c12', 'C12', 'X', 'EN STOCK', 'ADMIN', '2026-10-27T11:00:00.000Z', 990001, '2026-10-27T11:00:00Z');
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, statut_avant_doublon, doublon_declare_par, doublon_declare_le, id_site, updated_at)
  VALUES ('t6-c3', 'C3', 'X', 'DOUBLON', 'EN STOCK', 'OP1', '2026-10-27T10:00:00.000Z', 990001, '2026-10-27T10:00:00Z');
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, id_site, updated_at)
  VALUES ('t6-c4', 'C4', 'X', 'BROUILLON', 990001, '2026-10-27T10:00:00Z');

  -- ---------- 1. Scenario rouge 4 (upsert ON CONFLICT DO UPDATE) ----------
  -- Poste B renvoie une copie figee EN STOCK (sans delivrance) + un nouveau contact.
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, date_delivrance, agent_distributeur, nom_retirant, contact, id_site, updated_at, action_at)
  VALUES ('t6-c1', 'C1', 'X', 'EN STOCK', NULL, NULL, NULL, '0799999999', 990001, '2026-10-27T12:00:00Z', '2026-10-27T08:00:00Z')
  ON CONFLICT (sync_id) DO UPDATE SET
    statut = EXCLUDED.statut, date_delivrance = EXCLUDED.date_delivrance,
    agent_distributeur = EXCLUDED.agent_distributeur, nom_retirant = EXCLUDED.nom_retirant,
    contact = EXCLUDED.contact, updated_at = EXCLUDED.updated_at, action_at = EXCLUDED.action_at;
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c1';
  SELECT count(*), max(reason) INTO n_conf, c_reason FROM public.t_sync_conflicts WHERE sync_id = 't6-c1';
  INSERT INTO _t VALUES (1, 'Rouge 4 : vieille copie EN STOCK + nouveau contact sur carte DELIVRE (upsert)',
    r.statut = 'DELIVRE' AND r.date_delivrance = '2026-10-27T09:00:00Z' AND r.agent_distributeur = 'AGENT_A'
      AND r.nom_retirant = 'RETIRANT_A' AND r.contact = '0799999999'
      AND n_conf = 1 AND c_reason = 'STATUT_EVT_PLUS_ANCIEN'
      AND r.updated_at > '2026-10-27T10:00:00Z' AND r.updated_at = '2026-10-27T12:00:00.001Z'
      AND r.action_at = '2026-10-27T09:00:00Z',
    format('statut=%s contact=%s conflits=%s motif=%s updated_at=%s action_at=%s', r.statut, r.contact, n_conf, c_reason, r.updated_at, r.action_at));

  -- ---------- 2. Annulation d'apurement acceptee ----------
  UPDATE public.t_cartes SET statut = 'EN STOCK', date_delivrance = NULL, agent_distributeur = NULL, nom_retirant = NULL,
    apurement_annulation_par = 'ADMIN', apurement_annulation_le = '2026-10-27T11:00:00.000Z', apurement_annulation_motif = 'erreur',
    updated_at = '2026-10-27T11:00:00Z', action_at = '2026-10-27T11:00:00Z'
  WHERE sync_id = 't6-c2';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c2';
  SELECT count(*) INTO n_conf FROM public.t_sync_conflicts WHERE sync_id = 't6-c2';
  INSERT INTO _t VALUES (2, 'Annulation d''apurement DELIVRE -> EN STOCK acceptee',
    r.statut = 'EN STOCK' AND r.date_delivrance IS NULL AND r.apurement_annulation_le = '2026-10-27T11:00:00.000Z' AND n_conf = 0,
    format('statut=%s conflits=%s', r.statut, n_conf));

  -- ---------- 3. Vieille delivrance renvoyee apres l'annulation : refusee ----------
  UPDATE public.t_cartes SET statut = 'DELIVRE', date_delivrance = '2026-10-27T09:00:00Z', agent_distributeur = 'AGENT_A',
    nom_retirant = 'RETIRANT_A', apurement_annulation_par = NULL, apurement_annulation_le = NULL, apurement_annulation_motif = NULL,
    updated_at = '2026-10-27T13:00:00Z'
  WHERE sync_id = 't6-c2';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c2';
  SELECT count(*), max(reason) INTO n_conf, c_reason FROM public.t_sync_conflicts WHERE sync_id = 't6-c2';
  INSERT INTO _t VALUES (3, 'Vieille delivrance renvoyee apres annulation : refusee',
    r.statut = 'EN STOCK' AND r.date_delivrance IS NULL AND r.apurement_annulation_le = '2026-10-27T11:00:00.000Z'
      AND n_conf = 1 AND c_reason = 'STATUT_EVT_PLUS_ANCIEN' AND r.updated_at = '2026-10-27T13:00:00.001Z',
    format('statut=%s conflits=%s motif=%s updated_at=%s', r.statut, n_conf, c_reason, r.updated_at));

  -- ---------- 4. Annulation de doublon acceptee ----------
  UPDATE public.t_cartes SET statut = 'EN STOCK', doublon_annule_par = 'ADMIN', doublon_annule_le = '2026-10-27T11:00:00.000Z',
    doublon_motif_annulation = 'pas un doublon', updated_at = '2026-10-27T11:00:00Z'
  WHERE sync_id = 't6-c3';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c3';
  SELECT count(*) INTO n_conf FROM public.t_sync_conflicts WHERE sync_id = 't6-c3';
  INSERT INTO _t VALUES (4, 'Annulation de doublon DOUBLON -> EN STOCK acceptee',
    r.statut = 'EN STOCK' AND r.doublon_annule_le IS NOT NULL AND n_conf = 0,
    format('statut=%s conflits=%s', r.statut, n_conf));

  -- ---------- 5. BROUILLON -> EN STOCK accepte ----------
  UPDATE public.t_cartes SET statut = 'EN STOCK', updated_at = '2026-10-27T11:00:00Z' WHERE sync_id = 't6-c4';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c4';
  SELECT count(*) INTO n_conf FROM public.t_sync_conflicts WHERE sync_id = 't6-c4';
  INSERT INTO _t VALUES (5, 'Publication BROUILLON -> EN STOCK acceptee',
    r.statut = 'EN STOCK' AND n_conf = 0, format('statut=%s conflits=%s', r.statut, n_conf));

  -- ---------- 6. Double delivrance : la premiere gagne ----------
  UPDATE public.t_cartes SET date_delivrance = '2026-10-27T10:30:00Z', agent_distributeur = 'AGENT_B', nom_retirant = 'RETIRANT_B',
    updated_at = '2026-10-27T12:00:00Z'
  WHERE sync_id = 't6-c5';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c5';
  SELECT count(*), max(reason) INTO n_conf, c_reason FROM public.t_sync_conflicts WHERE sync_id = 't6-c5';
  INSERT INTO _t VALUES (6, 'Double delivrance (B plus tard) : la premiere (A) est conservee',
    r.statut = 'DELIVRE' AND r.date_delivrance = '2026-10-27T09:00:00Z' AND r.agent_distributeur = 'AGENT_A'
      AND r.nom_retirant = 'RETIRANT_A' AND n_conf = 1 AND c_reason = 'DOUBLE_DELIVRANCE',
    format('date=%s agent=%s conflits=%s motif=%s', r.date_delivrance, r.agent_distributeur, n_conf, c_reason));

  -- ---------- 6b. Correction d'apurement (date changee, correction_le plus recent) : acceptee ----------
  UPDATE public.t_cartes SET date_delivrance = '2026-10-27T08:30:00Z', nom_retirant = 'RETIRANT_CORRIGE',
    apurement_correction_par = 'ADMIN', apurement_correction_le = '2026-10-27T12:30:00.000Z', apurement_correction_motif = 'faute',
    updated_at = '2026-10-27T12:30:00Z'
  WHERE sync_id = 't6-c5';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c5';
  SELECT count(*) INTO n_conf FROM public.t_sync_conflicts WHERE sync_id = 't6-c5';
  INSERT INTO _t VALUES (61, 'Correction d''apurement (date anterieure + correction_le recent) acceptee',
    r.date_delivrance = '2026-10-27T08:30:00Z' AND r.nom_retirant = 'RETIRANT_CORRIGE' AND n_conf = 1,
    format('date=%s retirant=%s conflits=%s', r.date_delivrance, r.nom_retirant, n_conf));

  -- ---------- 7. Scan d'inventaire EN STOCK sur carte delivree : refuse, rangement garde ----------
  UPDATE public.t_cartes SET statut = 'EN STOCK', date_delivrance = NULL, agent_distributeur = NULL, nom_retirant = NULL,
    rangement = 'B12', updated_at = '2026-10-27T12:00:00Z', action_at = '2026-10-27T12:00:00Z'
  WHERE sync_id = 't6-c6';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c6';
  SELECT count(*) INTO n_conf FROM public.t_sync_conflicts WHERE sync_id = 't6-c6';
  INSERT INTO _t VALUES (7, 'Scan d''inventaire EN STOCK sur carte DELIVRE : statut refuse, rangement mis a jour',
    r.statut = 'DELIVRE' AND r.date_delivrance = '2026-10-27T09:00:00Z' AND r.rangement = 'B12'
      AND r.action_at = '2026-10-27T12:00:00Z' AND n_conf = 1,
    format('statut=%s rangement=%s action_at=%s conflits=%s', r.statut, r.rangement, r.action_at, n_conf));

  -- ---------- 8. Upsert d'insertion (nouvelle carte) non touche ----------
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, id_site, updated_at)
  VALUES ('t6-c8', 'C8', 'X', 'EN STOCK', 990001, '2026-10-27T12:00:00Z')
  ON CONFLICT (sync_id) DO UPDATE SET statut = EXCLUDED.statut, updated_at = EXCLUDED.updated_at;
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c8';
  SELECT count(*) INTO n_conf FROM public.t_sync_conflicts WHERE sync_id = 't6-c8';
  INSERT INTO _t VALUES (8, 'Upsert d''insertion d''une nouvelle carte non touche',
    r.statut = 'EN STOCK' AND r.updated_at = '2026-10-27T12:00:00Z' AND n_conf = 0,
    format('statut=%s updated_at=%s conflits=%s', r.statut, r.updated_at, n_conf));

  -- ---------- 9. Upsert ON CONFLICT DO UPDATE avec la cle anon (role de l'application) ----------
  SET LOCAL ROLE anon;
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, date_delivrance, id_site, updated_at)
  VALUES ('t6-c7', 'C7', 'X', 'EN STOCK', NULL, 990001, '2026-10-27T12:00:00Z')
  ON CONFLICT (sync_id) DO UPDATE SET statut = EXCLUDED.statut, date_delivrance = EXCLUDED.date_delivrance, updated_at = EXCLUDED.updated_at;
  RESET ROLE;
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c7';
  SELECT count(*) INTO n_conf FROM public.t_sync_conflicts WHERE sync_id = 't6-c7';
  INSERT INTO _t VALUES (9, 'Upsert ON CONFLICT DO UPDATE en role anon : passe par le trigger (SECURITY DEFINER ecrit le conflit)',
    r.statut = 'DELIVRE' AND n_conf = 1, format('statut=%s conflits=%s', r.statut, n_conf));

  -- ---------- 11. Annulation + nouvelle delivrance hors ligne (meme poste) : acceptee ----------
  -- Le cloud a D1 (09:00) ; le poste a annule (11:00) puis redelivre D2 (11:30)
  -- hors ligne : seul l'etat final DELIVRE D2 arrive (upsert).
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, date_delivrance, agent_distributeur, nom_retirant,
    apurement_annulation_par, apurement_annulation_le, apurement_annulation_motif, id_site, updated_at, action_at)
  VALUES ('t6-c9', 'C9', 'X', 'DELIVRE', '2026-10-27T11:30:00Z', 'AGENT_B', 'RETIRANT_B',
    'ADMIN', '2026-10-27T11:00:00.000Z', 'erreur', 990001, '2026-10-27T12:00:00Z', '2026-10-27T11:30:00Z')
  ON CONFLICT (sync_id) DO UPDATE SET
    statut = EXCLUDED.statut, date_delivrance = EXCLUDED.date_delivrance,
    agent_distributeur = EXCLUDED.agent_distributeur, nom_retirant = EXCLUDED.nom_retirant,
    apurement_annulation_par = EXCLUDED.apurement_annulation_par, apurement_annulation_le = EXCLUDED.apurement_annulation_le,
    apurement_annulation_motif = EXCLUDED.apurement_annulation_motif,
    updated_at = EXCLUDED.updated_at, action_at = EXCLUDED.action_at;
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c9';
  SELECT count(*) INTO n_conf FROM public.t_sync_conflicts WHERE sync_id = 't6-c9';
  INSERT INTO _t VALUES (11, 'Annulation + nouvelle delivrance D2 hors ligne (annulation_le recent) : acceptee',
    r.statut = 'DELIVRE' AND r.date_delivrance = '2026-10-27T11:30:00Z' AND r.agent_distributeur = 'AGENT_B'
      AND r.nom_retirant = 'RETIRANT_B' AND r.apurement_annulation_le = '2026-10-27T11:00:00.000Z'
      AND r.updated_at = '2026-10-27T12:00:00Z' AND n_conf = 0,
    format('date=%s agent=%s conflits=%s', r.date_delivrance, r.agent_distributeur, n_conf));

  -- ---------- 12. Seconde delivrance avec la MEME vieille annulation (08:00) : refusee ----------
  UPDATE public.t_cartes SET date_delivrance = '2026-10-27T10:30:00Z', agent_distributeur = 'AGENT_B', nom_retirant = 'RETIRANT_B',
    updated_at = '2026-10-27T12:00:00Z'
  WHERE sync_id = 't6-c10';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c10';
  SELECT count(*), max(reason) INTO n_conf, c_reason FROM public.t_sync_conflicts WHERE sync_id = 't6-c10';
  INSERT INTO _t VALUES (12, 'Double delivrance avec annulation_le identique a OLD (pas plus recente) : refusee',
    r.date_delivrance = '2026-10-27T09:00:00Z' AND r.agent_distributeur = 'AGENT_A'
      AND n_conf = 1 AND c_reason = 'DOUBLE_DELIVRANCE',
    format('date=%s agent=%s conflits=%s motif=%s', r.date_delivrance, r.agent_distributeur, n_conf, c_reason));

  -- ---------- 13. Correction du retirant SANS changement de date : acceptee ----------
  UPDATE public.t_cartes SET nom_retirant = 'RETIRANT_CORRIGE',
    apurement_correction_par = 'ADMIN', apurement_correction_le = '2026-10-27T12:00:00.000Z', apurement_correction_motif = 'faute',
    updated_at = '2026-10-27T12:00:00Z'
  WHERE sync_id = 't6-c11';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c11';
  SELECT count(*) INTO n_conf FROM public.t_sync_conflicts WHERE sync_id = 't6-c11';
  INSERT INTO _t VALUES (13, 'Correction du retirant meme date (correction_le 12:00) : acceptee',
    r.nom_retirant = 'RETIRANT_CORRIGE' AND r.date_delivrance = '2026-10-27T09:00:00Z'
      AND r.apurement_correction_le = '2026-10-27T12:00:00.000Z' AND n_conf = 0,
    format('retirant=%s conflits=%s', r.nom_retirant, n_conf));

  -- ---------- 14. Vieille copie (meme date, sans correction) apres la correction : refusee ----------
  -- (n'est arbitree que grace a la clause WHEN sur apurement_correction_le)
  INSERT INTO public.t_cartes (sync_id, noms, prenoms, statut, date_delivrance, agent_distributeur, nom_retirant,
    apurement_correction_par, apurement_correction_le, apurement_correction_motif, rangement, id_site, updated_at)
  VALUES ('t6-c11', 'C11', 'X', 'DELIVRE', '2026-10-27T09:00:00Z', 'AGENT_A', 'RETIRANT_A',
    NULL, NULL, NULL, 'R14', 990001, '2026-10-27T13:00:00Z')
  ON CONFLICT (sync_id) DO UPDATE SET
    statut = EXCLUDED.statut, date_delivrance = EXCLUDED.date_delivrance,
    agent_distributeur = EXCLUDED.agent_distributeur, nom_retirant = EXCLUDED.nom_retirant,
    apurement_correction_par = EXCLUDED.apurement_correction_par, apurement_correction_le = EXCLUDED.apurement_correction_le,
    apurement_correction_motif = EXCLUDED.apurement_correction_motif, rangement = EXCLUDED.rangement,
    updated_at = EXCLUDED.updated_at;
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c11';
  SELECT count(*), max(reason) INTO n_conf, c_reason FROM public.t_sync_conflicts WHERE sync_id = 't6-c11';
  INSERT INTO _t VALUES (14, 'Vieille copie DELIVRE meme date sans correction : refusee, retirant corrige conserve, autres champs passent',
    r.nom_retirant = 'RETIRANT_CORRIGE' AND r.apurement_correction_le = '2026-10-27T12:00:00.000Z'
      AND r.apurement_correction_par = 'ADMIN' AND r.rangement = 'R14'
      AND n_conf = 1 AND c_reason = 'STATUT_EVT_PLUS_ANCIEN' AND r.updated_at = '2026-10-27T13:00:00.001Z',
    format('retirant=%s rangement=%s conflits=%s motif=%s updated_at=%s', r.nom_retirant, r.rangement, n_conf, c_reason, r.updated_at));

  -- ---------- 15. Vieille copie avec une correction PLUS ANCIENNE (11:00 < 12:00) : refusee ----------
  UPDATE public.t_cartes SET nom_retirant = 'RETIRANT_VIEILLE_CORR', apurement_correction_le = '2026-10-27T11:00:00.000Z',
    updated_at = '2026-10-27T13:30:00Z'
  WHERE sync_id = 't6-c11';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c11';
  SELECT count(*), max(reason) INTO n_conf, c_reason FROM public.t_sync_conflicts WHERE sync_id = 't6-c11';
  INSERT INTO _t VALUES (15, 'Copie avec correction_le plus ancienne que OLD : refusee',
    r.nom_retirant = 'RETIRANT_CORRIGE' AND r.apurement_correction_le = '2026-10-27T12:00:00.000Z'
      AND n_conf = 2 AND c_reason = 'STATUT_EVT_PLUS_ANCIEN',
    format('retirant=%s conflits=%s motif=%s', r.nom_retirant, n_conf, c_reason));

  -- ---------- 16. Correction plus recente (13:00), meme date : acceptee ----------
  UPDATE public.t_cartes SET nom_retirant = 'RETIRANT_CORRIGE_2', apurement_correction_le = '2026-10-27T13:00:00.000Z',
    updated_at = '2026-10-27T14:00:00Z'
  WHERE sync_id = 't6-c11';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c11';
  SELECT count(*) INTO n_conf FROM public.t_sync_conflicts WHERE sync_id = 't6-c11';
  INSERT INTO _t VALUES (16, 'Correction plus recente (correction_le 13:00) meme date : acceptee',
    r.nom_retirant = 'RETIRANT_CORRIGE_2' AND r.apurement_correction_le = '2026-10-27T13:00:00.000Z'
      AND r.updated_at = '2026-10-27T14:00:00Z' AND n_conf = 2,
    format('retirant=%s conflits=%s', r.nom_retirant, n_conf));

  -- ---------- 17. Vieille copie EN STOCK effacant la trace d'annulation : refusee ----------
  UPDATE public.t_cartes SET apurement_annulation_par = NULL, apurement_annulation_le = NULL, updated_at = '2026-10-27T12:00:00Z'
  WHERE sync_id = 't6-c12';
  SELECT * INTO r FROM public.t_cartes WHERE sync_id = 't6-c12';
  SELECT count(*), max(reason) INTO n_conf, c_reason FROM public.t_sync_conflicts WHERE sync_id = 't6-c12';
  INSERT INTO _t VALUES (17, 'Copie EN STOCK sans trace d''annulation (seul annulation_le change) : trace conservee',
    r.statut = 'EN STOCK' AND r.apurement_annulation_le = '2026-10-27T11:00:00.000Z'
      AND n_conf = 1 AND c_reason = 'STATUT_EVT_PLUS_ANCIEN',
    format('annulation_le=%s conflits=%s motif=%s', r.apurement_annulation_le, n_conf, c_reason));

  -- ---------- 10. t_sync_conflicts invisible pour anon ----------
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.t_sync_conflicts LIMIT 1;
    RESET ROLE;
    INSERT INTO _t VALUES (10, 't_sync_conflicts illisible pour anon', false, 'SELECT autorise');
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
    INSERT INTO _t VALUES (10, 't_sync_conflicts illisible pour anon', true, 'permission refusee (attendu)');
  END;
END;
$$;

SELECT n, ok, cas, detail FROM _t ORDER BY n;

ROLLBACK;
