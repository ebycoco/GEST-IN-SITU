export interface IUser {
  id_user: number;
  login: string;
  password_hash?: string;
  role: 'SUPER ADMIN' | 'ADMINISTRATEUR_SITE' | 'ADMIN_CENTRE' | 'OPERATEUR_SAISIE' | 'OPERATEUR_VERIFICATION' | 'CONSULTANT';
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
  statut: 'EN STOCK' | 'DELIVRE' | 'ANNULE';
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
}

export interface ISite {
  id: number;
  nom: string;
  code: string;
  is_active: number;
  max_centres: number;
  sync_id: string;
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
