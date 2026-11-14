export interface IUser {
  id_user: number;
  login: string;
  password_hash?: string;
  role: 'SUPER ADMIN' | 'ADMINISTRATEUR_SITE' | 'ADMIN_CENTRE' | 'OPERATEUR_SAISIE' | 'OPERATEUR_VERIFICATION' | 'CONSULTANT' | 'OPERATEUR_LOGISTIQUE' | 'OPERATEUR_QUALITE' | 'OPERATEUR_INVENTAIRE' | 'OPERATEUR_APUREMENT' | string;
  roles?: string[];
  nom_user: string;
  prenom_user: string;
  email?: string;
  telephone?: string;
  statut_actif: number;
  site_id: number;
  centre_id: number | null;
  sync_id: string;
  is_dirty?: number;
  last_login?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ICarte {
  id_carte: number;
  noms: string;
  prenoms: string;
  date_de_naissance: string | null;
  lieu_de_naissance: string;
  num_secu: string | null;
  contact: string;
  lieu_enrolement: string;
  rangement: string;
  statut: 'EN STOCK' | 'DELIVRE' | 'DISTRIBUEE' | 'RETIRE' | 'ANNULE' | 'BROUILLON' | 'DOUBLON';
  date_delivrance: string | null;
  agent_saisie: string;
  nom_retirant: string | null;
  num_retirant: string | null;
  relation_retirant?: string | null;
  agent_distributeur: string | null;
  centre_retrait: string | null;
  statut_physique: 'OK' | 'ABSENT' | 'RETROUVE' | 'PERDUE';
  site_id: number;
  centre_id: number | null;
  poste_id: number | null;
  sync_id: string;
  is_dirty?: number;
  is_exported?: number;
  created_by?: number | null;
  created_at?: string;
  updated_at?: string;
  // Déclaration manuelle de doublon (V67) — Vérification + Apurement des cahiers historiques
  doublon_declare_par?: string | null;
  doublon_declare_le?: string | null;
  doublon_motif?: string | null;
  statut_avant_doublon?: string | null;
  doublon_annule_par?: string | null;
  doublon_annule_le?: string | null;
  doublon_motif_annulation?: string | null;
  // Correction/annulation d'un émargement Apurement (V69) — Opérateur Apurement
  apurement_correction_par?: string | null;
  apurement_correction_le?: string | null;
  apurement_correction_motif?: string | null;
  apurement_annulation_par?: string | null;
  apurement_annulation_le?: string | null;
  apurement_annulation_motif?: string | null;
}

export interface ISite {
  id: number;
  nom: string;
  code: string;
  is_active: number;
  max_centres: number;
  sync_id: string;
  // Licence (colonnes t_sites existantes) — ajout purement additif, lecture seule côté UI.
  expiry_date?: string | null;
  is_permanent?: number | boolean | null;
  created_at?: string;
  updated_at?: string;
}

export interface IDeliveryData {
  nom_retirant: string;
  num_retirant: string;
  agent_distributeur: string;
  centre_retrait?: string;
  rangement?: string;
}

export interface ISiteSummary {
  id: number;
  nom: string;
  code_site: string;
  is_active: number;
  total_centres: number;
  total_cartes: number;
  admin_login: string;
}

export interface IGlobalStats {
  total_sites: number;
  active_sites: number;
  total_cartes: number;
  total_agents: number;
}

export interface ILog {
  id_log: number;
  id_user: number | null;
  login_user: string;
  action: string;
  detail: string;
  valeur_apres?: string;
  date_heure: string;
  site_id: number;
  sync_id: string;
  is_dirty: number;
  is_read: number;
}

export interface StatsKpi {
  total: number;
  en_stock: number;
  distribuees: number;
  absentes: number;
  sans_num_secu: number;
  sans_rangement: number;
  sans_nom: number;
  sans_prenom: number;
  dates_invalides: number;
  autres_anomalies?: number;
  dates_naissance_vide?: number;
  cartes_fantomes?: number;
  [key: string]: any; // Pour les autres champs de graphes et stats
}

export interface AgentPerformance {
  agent_nom: string;
  total_saisies?: number;
  total_actions?: number;
  total_distributions?: number;
  total_validations?: number;
  centre_nom?: string;
  centre_id?: number;
  agent_id?: number;
}

export interface DetailedSyncStats {
  cleanCount: number;
  missingCount: number;
  probableCount: number;
  strictCount: number;
  invalidCount: number;
  modifiedCount: number;
  ghostCount: number;
}

/**
 * Miroir côté renderer/preload de `AgentPresenceRow` (src/main/sync/presence.service.ts,
 * module main-process uniquement — non importable depuis preload/renderer). À garder
 * synchronisé si ce type évolue côté service. Alimente `window.api.presence.getAgents()`
 * (page "Présence des Agents", AgentsPresencePage.tsx). Aucun statut calculé (En ligne/
 * Inactif/Hors ligne) : uniquement des timestamps bruts, interprétés côté renderer.
 */
export interface AgentPresenceRow {
  sync_id: string;
  login: string;
  nom_user: string | null;
  prenom_user: string | null;
  role: string | null;
  site_id: number | null;
  centre_id: number | null;
  last_heartbeat_at: string | null;
  last_login_at: string | null;
  last_logout_at: string | null;
  last_action_at: string | null;
  last_action_label: string | null;
}

/**
 * Écran SUPER ADMIN « Versions des postes » (docs/PLAN_ECRAN_VERSIONS_POSTES.md).
 * Une ligne = un poste déclaré (RPC fn_list_client_versions, migration 0010), sync_id traduits
 * en local côté main (src/main/sync/client-version.service.ts). `poste_ref` = 8 premiers
 * caractères de la clé de poste (jamais la clé complète). Inconnu localement → null.
 */
export interface PosteVersionRow {
  poste_ref: string;
  app_version: string | null;
  site_sync_id: string | null;
  site_nom: string | null;
  last_user_login: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  nb_reports: number;
  key_kind: string | null;
}

/** Compteurs de fn_count_client_versions (nb_listables > 1000 = liste tronquée). */
export interface PostesVersionsCounts {
  nb_total: number;
  nb_preuve: number;
  nb_ignorees: number;
  nb_listables: number;
}

/** Erreurs structurées du canal `versions:getPostes` (aucune exception vers le renderer). */
export type PostesVersionsError = 'FORBIDDEN' | 'OFFLINE' | 'NO_CLIENT' | 'TIMEOUT' | 'RPC_ERROR' | 'LOCAL_ERROR' | 'INTERNAL';

/** Réponse du canal `versions:getPostes` (window.api.versions.getPostes()). */
export type PostesVersionsResult =
  | {
      success: true;
      rows: PosteVersionRow[];
      counts: PostesVersionsCounts;
      truncated: boolean;
      /** Dernière version publiée connue de l'auto-updater (null si jamais vérifiée). */
      latestVersion: string | null;
      /** Version de ce poste (app.getVersion()). */
      currentVersion: string;
    }
  | { success: false; error: PostesVersionsError };
