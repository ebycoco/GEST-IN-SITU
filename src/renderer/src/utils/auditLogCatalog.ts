/**
 * Catalogue de traduction du Journal d'Audit Système (LogsPage.tsx uniquement).
 *
 * Problème résolu : les admins non-techniques (ADMINISTRATEUR_SITE, ADMIN_CENTRE) qui
 * surveillent leurs opérateurs via /logs voyaient des codes bruts illisibles
 * (`action_type` = 'SYSTEM_LOG_CONSULTATION', `details` = JSON.stringify brut).
 *
 * Principe : au lieu d'un `if/else` géant dans LogsPage.tsx, chaque type d'action connu est
 * déclaré UNE FOIS ici (libellé FR + couleur de badge + résumé optionnel en langage naturel).
 * Toute action non déclarée (nouvelle action ajoutée plus tard côté backend, voir
 * `logAudit()` dans src/main/utils/audit.ts et src/main/ipc/handlers.ts) dégrade proprement
 * vers un libellé humanisé automatique + un affichage clé/valeur générique traduit — jamais de
 * JSON brut à l'écran, même pour une action inconnue de ce fichier.
 *
 * Pour ajouter une nouvelle action à l'avenir : ajouter une entrée dans AUDIT_ACTION_CATALOG
 * (label + category, et un `summarize` optionnel si une phrase naturelle a du sens). Rien
 * d'autre à toucher dans LogsPage.tsx.
 */

export type AuditActionCategory = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

export interface AuditActionMeta {
  /** Libellé FR affiché à la place du code technique brut. */
  label: string;
  /** Détermine la couleur du badge, cohérente avec la charte "Plein Soleil" déjà en place. */
  category: AuditActionCategory;
  /** Construit une phrase en langage naturel à partir des `details` JSON déjà parsés.
   * Retourne `null` si les clés attendues sont absentes -> l'appelant retombe sur l'affichage
   * clé/valeur générique (`formatAuditDetails`). */
  summarize?: (details: Record<string, any>) => string | null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Styles de badge par catégorie — mêmes couleurs que celles déjà utilisées en dur dans
// LogsPage.tsx (vert/rouge/jaune/bleu), + un gris neutre pour les actions vraiment
// non catégorisables (repli ultime, ne devrait quasiment jamais être atteint).
// ─────────────────────────────────────────────────────────────────────────────────────────
const CATEGORY_STYLES: Record<AuditActionCategory, { bg: string; color: string }> = {
  success: { bg: 'rgba(34, 197, 94, 0.15)', color: '#22c55e' },
  danger: { bg: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' },
  warning: { bg: 'rgba(234, 179, 8, 0.15)', color: '#eab308' },
  info: { bg: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' },
  neutral: { bg: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8' }
};

/** Transforme un code technique inconnu ('UN_NOUVEAU_CODE') en libellé lisible ('Un nouveau code'). */
function humanizeActionType(actionType: string): string {
  if (!actionType) return 'Action inconnue';
  const words = actionType.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) return actionType;
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ' ' + words.slice(1).join(' ') : '');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Catalogue des actions connues (liste exhaustive des appels logAudit()/insertAuditLog()
// existants au 2026-08, voir handlers.ts + users.queries.ts + audit.ts).
// ─────────────────────────────────────────────────────────────────────────────────────────
export const AUDIT_ACTION_CATALOG: Record<string, AuditActionMeta> = {
  // ── Authentification ──────────────────────────────────────────────────────────────────
  CONNEXION: { label: 'Connexion', category: 'success' },
  DECONNEXION: { label: 'Déconnexion', category: 'danger' },
  ROOT_LOGIN: { label: 'Connexion de secours (ROOT)', category: 'warning' },

  // ── Cartes CMU — cycle de vie ─────────────────────────────────────────────────────────
  CARTE_SAISIE: {
    label: 'Carte CMU saisie',
    category: 'success',
    summarize: (d) => `Nouvelle carte CMU saisie (ID ${d.id_carte ?? '?'})${d.matricule_agent ? ` par ${d.matricule_agent}` : ''}.`
  },
  CARTE_MODIFICATION: {
    label: 'Carte CMU modifiée',
    category: 'info',
    summarize: (d) => {
      const champs = Array.isArray(d.champs_modifies) ? d.champs_modifies.join(', ') : null;
      return `Carte n°${d.id_carte ?? '?'} modifiée${champs ? ` — champs concernés : ${champs}` : ''}.`;
    }
  },
  CARTE_SUPPRESSION: {
    label: 'Carte CMU supprimée',
    category: 'danger',
    summarize: (d) => `Carte n°${d.id_carte ?? '?'} supprimée${d.raison_suppression ? ` — motif : ${d.raison_suppression}` : ''}.`
  },
  CARTE_DELIVREE: {
    label: 'Carte CMU délivrée',
    category: 'success',
    summarize: (d) => `Carte n°${d.id_carte ?? '?'} délivrée à ${d.nom_retirant ?? 'un bénéficiaire'}${d.num_retirant ? ` (pièce n°${d.num_retirant})` : ''}${d.agent_distributeur ? ` par l'agent ${d.agent_distributeur}` : ''}.`
  },
  CARTE_TRANSFEREE: {
    label: 'Carte CMU transférée',
    category: 'success',
    summarize: (d) => `Carte n°${d.id_carte ?? '?'} transférée vers le centre #${d.centre_id_destination ?? '?'}.`
  },
  CARTE_PUBLICATION_BROUILLONS: {
    label: 'Brouillons publiés',
    category: 'success',
    summarize: (d) => `${d.published_count ?? 0} brouillon(s) publié(s)${d.skipped_count ? `, ${d.skipped_count} ignoré(s) (date invalide)` : ''}.`
  },
  RETRAIT: { label: 'Retrait de carte CMU', category: 'warning' },
  RETRAIT_DOUBLE_TENTATIVE: {
    label: 'Alerte : double retrait tenté',
    category: 'danger',
    summarize: (d) => `Tentative de retrait d'une carte déjà délivrée (carte #${d.id_carte ?? '?'}).`
  },
  RETRAIT_VALIDATION: { label: 'Retrait validé', category: 'success' },
  RETRAIT_ANNULATION: {
    label: 'Retrait annulé',
    category: 'danger',
    summarize: (d) => `Retrait de la carte #${d.id_carte ?? '?'} annulé${d.motif_annulation ? ` — motif : ${d.motif_annulation}` : ''}.`
  },
  RETRAIT_RECU_IMPRIME: { label: 'Reçu de retrait imprimé', category: 'info' },

  // ── Dossiers CMU (canal alternatif cmu:*) ────────────────────────────────────────────
  CMU_SAISIE: { label: 'Dossier CMU saisi', category: 'success' },
  CMU_NOUVELLE_SAISIE: { label: 'Nouveau dossier CMU saisi', category: 'success' },
  CMU_MODIFICATION: { label: 'Dossier CMU modifié', category: 'info' },
  CMU_SUPPRESSION: {
    label: 'Dossier CMU supprimé',
    category: 'danger',
    summarize: (d) => `Dossier CMU n°${d.numero_cmu ?? d.id_carte ?? '?'} supprimé${d.raison ? ` — motif : ${d.raison}` : ''}.`
  },
  CMU_CHANGEMENT_STATUT: {
    label: 'Statut de carte modifié',
    category: 'info',
    summarize: (d) => `Statut de la carte n°${d.numero_cmu ?? d.id_carte ?? '?'} changé${d.ancien_statut && d.nouveau_statut ? ` : ${d.ancien_statut} → ${d.nouveau_statut}` : ''}${d.motif ? ` (motif : ${d.motif})` : ''}.`
  },
  CMU_RECHERCHE: { label: 'Recherche de dossier CMU', category: 'info' },
  CMU_CONSULTATION_DOSSIER: { label: 'Consultation d\'un dossier CMU', category: 'info' },
  CMU_UPLOAD_DOC: { label: 'Document CMU importé', category: 'info' },
  CMU_VALIDATION_SAISIE: { label: 'Saisie CMU validée (contrôle conformité)', category: 'success' },
  CMU_IMPRESSION: { label: 'Impression de carte CMU', category: 'info' },
  ERREUR_SAISIE: { label: 'Erreur lors d\'une saisie', category: 'danger' },

  // ── Recherche / consultation ─────────────────────────────────────────────────────────
  VERIFICATION_RECHERCHE: {
    label: 'Recherche de vérification',
    category: 'info',
    summarize: (d) => `Recherche effectuée${d.valeur_recherchee ? ` — valeur : « ${d.valeur_recherchee} »` : ''}${d.critere_utilise && d.critere_utilise !== 'none' ? ` (critères : ${d.critere_utilise})` : ''}.`
  },
  VERIFICATION_ABUS_RECHERCHE: {
    label: 'Alerte : usage anormal de la recherche',
    category: 'danger',
    summarize: (d) => d.motif ? `Alerte sécurité : ${d.motif}.` : null
  },
  RECHERCHE_UNIVERSELLE: { label: 'Recherche universelle', category: 'info' },
  RECHERCHE_SUSPECTE: {
    label: 'Alerte : recherche suspecte',
    category: 'danger',
    summarize: (d) => `Volume de résultats anormalement élevé${d.resultat_count ? ` (${d.resultat_count} résultats)` : ''} pour le critère « ${d.critere ?? '?'} ».`
  },
  CONSULTATION_CORRECTION: {
    label: 'Consultation pour correction',
    category: 'info',
    summarize: (d) => `Consultation du dossier ${d.type_enregistrement ?? ''} #${d.id ?? '?'} en vue d'une correction.`
  },
  VERIFICATION_CONSULTATION: {
    label: 'Consultation de dossier',
    category: 'info',
    summarize: (d) => `Consultation du dossier carte #${d.id_carte ?? d.id_beneficiaire ?? '?'}.`
  },

  // ── Qualité des données ──────────────────────────────────────────────────────────────
  QUALITE_FUSION: {
    label: 'Fusion de doublons',
    category: 'success',
    summarize: (d) => `Fusion de doublons : carte #${d.id_carte_source ?? '?'} fusionnée dans la carte #${d.id_carte_cible ?? '?'}.`
  },
  QUALITE_CORRECTION: { label: 'Correction qualité de données', category: 'success' },
  QUALITE_NETTOYAGE: { label: 'Nettoyage qualité de données', category: 'success' },
  QUALITE_MASSE: { label: 'Traitement qualité en masse', category: 'warning' },

  // ── Export / sauvegarde ──────────────────────────────────────────────────────────────
  EXPORT_DONNEES: { label: 'Export de données', category: 'info' },
  EXPORT_MASSIF_ALERTE: { label: 'Alerte : export massif', category: 'warning' },
  EXPORT_BACKUP_SQL: { label: 'Sauvegarde SQL exportée', category: 'info' },
  PROFIL_EXPORT_DONNEES: { label: 'Export de données personnelles', category: 'info' },
  SYSTEM_LOG_EXPORT: { label: 'Export du journal d\'audit', category: 'info' },
  MAINTENANCE_LOGS_EXPORT: { label: 'Export des journaux techniques', category: 'info' },

  // ── Journal d'audit lui-même ─────────────────────────────────────────────────────────
  SYSTEM_LOG_CONSULTATION: {
    label: 'Consultation du journal d\'audit',
    category: 'neutral',
    summarize: (d) => {
      const page = d.page_consultée ?? d.page ?? '?';
      const filtres = d.filtres_utilises && typeof d.filtres_utilises === 'object' ? Object.keys(d.filtres_utilises) : [];
      return filtres.length > 0
        ? `Page ${page} du journal consultée, avec filtre(s) : ${filtres.join(', ')}.`
        : `Page ${page} du journal consultée, aucun filtre appliqué.`;
    }
  },
  SYSTEM_LOG_PURGE_CRITIQUE: { label: 'Purge critique du journal', category: 'danger' },
  SYSTEM_LOG_PURGE: { label: 'Purge du journal d\'audit', category: 'danger' },
  MAINTENANCE_LOGS_PURGE: { label: 'Purge des journaux techniques', category: 'danger' },

  // ── Utilisateurs / droits ────────────────────────────────────────────────────────────
  UTILISATEUR_CREE: {
    label: 'Compte utilisateur créé',
    category: 'success',
    summarize: (d) => `Compte utilisateur « ${d.login ?? '?'} » créé${d.role ? ` avec le rôle ${d.role}` : ''}.`
  },
  UTILISATEUR_SUPPRIME: {
    label: 'Compte utilisateur supprimé',
    category: 'danger',
    summarize: (d) => `Compte utilisateur #${d.id_user ?? '?'} supprimé${d.type === 'suppression_definitive' ? ' (suppression définitive)' : ''}.`
  },
  SYS_MODIF_DROITS: { label: 'Droits utilisateur modifiés', category: 'warning' },
  SYS_ELEVATION_PRIVILEGE: { label: 'Élévation de privilège', category: 'warning' },
  PROFIL_MAJ_PREFERENCES: { label: 'Préférences de profil modifiées', category: 'info' },
  PROFIL_MAJ_PASSWORD: { label: 'Mot de passe modifié', category: 'success' },
  PROFIL_ERREUR_PASSWORD: { label: 'Échec de changement de mot de passe', category: 'danger' },

  // ── Centres / sites ───────────────────────────────────────────────────────────────────
  SYS_CREATION_CENTRE: { label: 'Centre créé', category: 'success' },
  CREATION_CENTRE_ERREUR: { label: 'Échec de création de centre', category: 'danger' },
  MODIFICATION_CENTRE: { label: 'Centre modifié', category: 'info' },
  MODIFICATION_CENTRE_ERREUR: { label: 'Échec de modification de centre', category: 'danger' },
  SUPPRESSION_CENTRE: { label: 'Centre supprimé', category: 'danger' },
  SUPPRESSION_CENTRE_ERREUR: { label: 'Échec de suppression de centre', category: 'danger' },
  SYS_PARAM_GLOBAL: { label: 'Paramètre global modifié', category: 'warning' },

  // ── Administration système / SUPER ADMIN ─────────────────────────────────────────────
  PURGE_LOCALE: { label: 'Purge locale de données', category: 'danger' },
  SUPERADMIN_PURGE_CLOUD: { label: 'Purge cloud (SUPER ADMIN)', category: 'danger' },
  SUPERADMIN_ACTION_CRITIQUE: { label: 'Action critique SUPER ADMIN', category: 'danger' },
  SUPERADMIN_DB_MAINTENANCE: { label: 'Maintenance base de données', category: 'warning' },
  SUPERADMIN_FORCE_SYNC: { label: 'Synchronisation forcée (SUPER ADMIN)', category: 'warning' },
  PURGE_CLOUD_SUPABASE_INIT: { label: 'Purge cloud lancée', category: 'warning' },
  PURGE_CLOUD_SUPABASE_SUCCESS: { label: 'Purge cloud réussie', category: 'success' },
  PURGE_CLOUD_SUPABASE_FAILURE: { label: 'Échec de la purge cloud', category: 'danger' },
  MASS_UPLOAD_INIT: { label: 'Import massif lancé', category: 'warning' },
  MASS_UPLOAD_SUCCESS: { label: 'Import massif réussi', category: 'success' },
  MASS_UPLOAD_FAILURE: { label: 'Échec de l\'import massif', category: 'danger' },

  // ── Synchronisation ───────────────────────────────────────────────────────────────────
  SYNC_DOWN_INIT: { label: 'Synchronisation (réception) lancée', category: 'warning' },
  SYNC_DOWN_SUCCESS: { label: 'Synchronisation (réception) réussie', category: 'success' },
  SYNC_DOWN_FAILURE: { label: 'Échec de synchronisation (réception)', category: 'danger' },
  SYNC_AGENTS_INIT: { label: 'Synchronisation des agents lancée', category: 'warning' },
  SYNC_AGENTS_SUCCESS: { label: 'Synchronisation des agents réussie', category: 'success' },
  SYNC_AGENTS_FAILURE: { label: 'Échec de synchronisation des agents', category: 'danger' },
  SYNC_USERS_FORCED_INIT: { label: 'Synchronisation forcée des utilisateurs lancée', category: 'warning' },
  SYNC_USERS_FORCED_SUCCESS: { label: 'Synchronisation forcée des utilisateurs réussie', category: 'success' },
  SYNC_USERS_FORCED_FAILURE: { label: 'Échec de synchronisation forcée des utilisateurs', category: 'danger' },
  SYNCHRO_FORCEE: { label: 'Synchronisation forcée', category: 'warning' },

  // ── Logistique ────────────────────────────────────────────────────────────────────────
  LOG_RECEPTION: {
    label: 'Réception de lot logistique',
    category: 'success',
    summarize: (d) => `Lot ${d.lot_id ?? '?'} réceptionné (${d.quantite ?? '?'} carte(s))${d.centre_origine ? ` depuis ${d.centre_origine}` : ''}.`
  },
  LOG_TRI: { label: 'Tri de cartes', category: 'success' },
  LOG_TRANSFERT: {
    label: 'Transfert de lot logistique',
    category: 'success',
    summarize: (d) => `Lot ${d.lot_id ?? '?'} transféré vers ${d.centre_destination ?? '?'} (${d.nombre_cartes ?? '?'} carte(s)).`
  },
  LOG_INVENTAIRE: { label: 'Inventaire physique effectué', category: 'info' },
  LOG_ERREUR_LOGISTIQUE: { label: 'Erreur logistique', category: 'danger' },

  // ── Apurement (émargement rétroactif) ────────────────────────────────────────────────
  APUREMENT_VALIDATION: { label: 'Écart d\'apurement validé', category: 'success' },
  APUREMENT_ANNULATION: {
    label: 'Opération d\'apurement annulée',
    category: 'danger',
    summarize: (d) => `Opération d'apurement #${d.id_operation ?? '?'} annulée${d.motif_annulation ? ` — motif : ${d.motif_annulation}` : ''}.`
  },
  APUREMENT_GENERATION_PV: { label: 'Procès-verbal d\'apurement généré', category: 'info' },
  APUREMENT_ERREUR: { label: 'Erreur d\'apurement', category: 'danger' },
  CARTE_APUREMENT_CORRIGEE: {
    label: 'Émargement Apurement corrigé',
    category: 'warning',
    summarize: (d) => `Émargement de la carte #${d.id_carte ?? '?'} corrigé${d.motif ? ` — motif : ${d.motif}` : ''}.`
  },
  CARTE_APUREMENT_ANNULEE: {
    label: 'Émargement Apurement annulé',
    category: 'danger',
    summarize: (d) => `Émargement de la carte #${d.id_carte ?? '?'} annulé, carte remise EN STOCK${d.motif_annulation ? ` — motif : ${d.motif_annulation}` : ''}.`
  },

  // ── File d'attente / guichets ────────────────────────────────────────────────────────
  QUEUE_ENREGISTREMENT: { label: 'Bénéficiaire enregistré en file d\'attente', category: 'info' },
  QUEUE_APPEL: { label: 'Bénéficiaire appelé au guichet', category: 'info' },
  QUEUE_CLOTURE: { label: 'Passage clôturé', category: 'success' },
  FILE_ATTENTE_CRITIQUE: { label: 'Alerte : file d\'attente critique', category: 'danger' },
  ADMIN_GUICHET_TOGGLE: { label: 'Ouverture/fermeture de guichet', category: 'info' },
  ADMIN_CAPACITE_REDUITE_CRITIQUE: {
    label: 'Alerte : réduction critique de capacité',
    category: 'danger',
    summarize: (d) => d.raison || d.message || null
  },
  ADMIN_QUOTA_UPDATE: { label: 'Quota de service modifié', category: 'warning' },
  ADMIN_ALERTE_RESET: { label: 'Alertes réinitialisées', category: 'info' },

  // ── Divers ────────────────────────────────────────────────────────────────────────────
  VALIDATION: { label: 'Validation', category: 'info' }
};

/** Renvoie le libellé + la catégorie d'une action, avec repli automatique pour toute action
 * non déclarée dans le catalogue ci-dessus (ne doit jamais afficher de code brut). */
export function getActionMeta(actionType: string): AuditActionMeta {
  return AUDIT_ACTION_CATALOG[actionType] || { label: humanizeActionType(actionType), category: 'neutral' };
}

/** Style de badge (fond + couleur) à appliquer pour un type d'action donné. */
export function getActionBadgeStyle(actionType: string): { bg: string; color: string } {
  return CATEGORY_STYLES[getActionMeta(actionType).category];
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Formatage des `details` (repli clé/valeur générique traduit, utilisé quand aucun
// `summarize()` du catalogue ci-dessus ne s'applique — jamais de JSON.stringify brut affiché).
// ─────────────────────────────────────────────────────────────────────────────────────────

/** Clés techniques internes sans intérêt pour un admin terrain (retirées de l'affichage,
 * mais toujours présentes dans les données brutes stockées en base — aucune perte de donnée). */
const NOISE_KEYS = new Set(['sqlite_schema_version']);

/** Traduction FR des clés JSON les plus fréquentes rencontrées dans les `details` d'audit. */
const FIELD_LABELS: Record<string, string> = {
  id_carte: 'Carte n°',
  id_beneficiaire: 'Bénéficiaire n°',
  id_user: 'Utilisateur n°',
  id_operation: 'Opération n°',
  numero_cmu: 'N° carte CMU',
  num_secu: 'N° sécurité sociale',
  site_id: 'Site',
  centre_id: 'Centre',
  centre_id_destination: 'Centre destination',
  centre_origine: 'Centre origine',
  centre_destination: 'Centre destination',
  matricule_agent: 'Agent',
  agent_distributeur: 'Agent distributeur',
  agent_responsable: 'Agent responsable',
  nom_retirant: 'Nom du retirant',
  num_retirant: 'N° pièce du retirant',
  raison: 'Motif',
  raison_suppression: 'Motif de suppression',
  motif: 'Motif',
  motif_annulation: 'Motif d\'annulation',
  motif_apurement: 'Motif d\'apurement',
  motif_changement: 'Motif du changement',
  champs_modifies: 'Champs modifiés',
  champs_data: 'Données modifiées',
  champs_fusionnes: 'Champs fusionnés',
  error: 'Erreur',
  message: 'Message',
  login: 'Identifiant',
  role: 'Rôle',
  lot_id: 'N° de lot',
  quantite: 'Quantité',
  nombre_cartes: 'Nombre de cartes',
  'nombre_cartes_triées': 'Cartes triées',
  'ecart_constaté': 'Écart constaté',
  ecart_initial: 'Écart initial',
  nouvel_etat_stock: 'Nouvel état de stock',
  note_agent: 'Note de l\'agent',
  guichet_id: 'Guichet',
  id_guichet: 'Guichet',
  numero_guichet: 'N° guichet',
  agent_id: 'Agent n°',
  heure_arrivee: 'Heure d\'arrivée',
  temps_traitement_secondes: 'Temps de traitement (s)',
  statut_final: 'Statut final',
  nouvel_etat: 'Nouvel état',
  nouveau_quota: 'Nouveau quota',
  quota_ancien: 'Ancien quota',
  type_service: 'Type de service',
  type_alerte_reset: 'Type d\'alerte',
  zone_concernee: 'Zone concernée',
  ancien_statut: 'Ancien statut',
  nouveau_statut: 'Nouveau statut',
  critere: 'Critère',
  critere_utilise: 'Critère utilisé',
  valeur_recherchee: 'Valeur recherchée',
  resultat_count: 'Nombre de résultats',
  type_enregistrement: 'Type de dossier',
  id_carte_source: 'Carte source',
  id_carte_cible: 'Carte cible',
  date_pv: 'Date du PV',
  references_lots: 'Lots concernés',
  numero_recu: 'N° reçu',
  date_saisie: 'Date de saisie',
  type_document: 'Type de document',
  nom_fichier: 'Nom du fichier',
  conformite: 'Conforme',
  published_count: 'Publiés',
  skipped_count: 'Ignorés',
  format: 'Format',
  filtres_utilises: 'Filtres appliqués',
  'page_consultée': 'Page consultée',
  changement_effectue: 'Changement effectué',
  succes: 'Succès'
};

function translateFieldKey(key: string): string {
  return FIELD_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '));
}

function formatFieldValue(value: any): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (Array.isArray(value)) return value.length > 0 ? value.join(', ') : 'aucun';
  if (typeof value === 'object') return Object.keys(value).length > 0 ? Object.keys(value).join(', ') : 'aucun';
  return String(value);
}

export interface FormattedAuditDetails {
  /** Phrase courte tenant sur une ligne (colonne "Détails" du tableau + repli modal). */
  summary: string;
  /** Décomposition clé/valeur traduite, affichée en complément dans la modal de détail. */
  entries: { label: string; value: string }[];
}

/**
 * Transforme les `details` bruts d'une ligne d'audit (JSON stringifié le plus souvent, mais
 * parfois déjà une phrase FR lisible pour les actions journalisées via l'ancien
 * `insertAuditLog()` — CONNEXION/DECONNEXION/RETRAIT notamment) en un résumé lisible par un
 * admin non-technique, sans jamais exposer de JSON brut à l'écran.
 */
export function formatAuditDetails(actionType: string, rawDetails: string | null | undefined): FormattedAuditDetails {
  const raw = (rawDetails ?? '').toString().trim();
  if (!raw) return { summary: 'Aucun détail.', entries: [] };

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Pas un JSON : c'est déjà une phrase FR lisible (insertAuditLog stocke du texte brut).
    return { summary: raw, entries: [] };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { summary: String(parsed), entries: [] };
  }

  const entries = Object.entries(parsed)
    .filter(([key, value]) => !NOISE_KEYS.has(key) && value !== undefined && value !== null && value !== '')
    .map(([key, value]) => ({ label: translateFieldKey(key), value: formatFieldValue(value) }));

  const meta = AUDIT_ACTION_CATALOG[actionType];
  const naturalSummary = meta?.summarize ? meta.summarize(parsed) : null;

  const fallbackSummary = entries.length > 0
    ? entries.map((e) => `${e.label} : ${e.value}`).join(' · ')
    : 'Aucun détail supplémentaire.';

  return { summary: naturalSummary || fallbackSummary, entries };
}
