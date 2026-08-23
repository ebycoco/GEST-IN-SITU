import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * Nom du CustomEvent window émis par ProfilePage.tsx juste après une bascule réussie
 * de la préférence "Envoi automatique des cartes" (window.api.sync.setAutoUpstream).
 * Permet aux vues déjà montées ailleurs dans l'app (bouton manuel "Synchroniser mes
 * actions"/"Envoyer les corrections") de refléter le nouvel état sans rechargement complet
 * de la page.
 *
 * Même convention déjà en place dans le dépôt pour AUTO_DOWNSTREAM_CHANGED_EVENT (cf.
 * useAutoDownstreamPreference.ts), mais un événement dédié est utilisé ici pour ne pas
 * déclencher de rechargement de données métier non lié à ce changement de préférence.
 */
export const AUTO_UPSTREAM_CHANGED_EVENT = 'app:auto-upstream-changed';

/**
 * Lit la préférence utilisateur "Envoi Automatique" (t_config, clé `auto_upstream_<id_user>`)
 * afin de conditionner l'affichage du bouton manuel de synchro upstream présent sur plusieurs
 * vues (AdminCentreLayout, AgentVerificationLayout, AgentSaisieLayout, InventaireLayout,
 * ApurementLayout, AgentQualiteLayout, VerificationSearchPage) : quand l'envoi automatique est
 * actif et que le réseau fonctionne, ce bouton manuel doit rester masqué.
 *
 * Sécurité (CLAUDE.md §3) : l'identité utilisée pour la lecture est dérivée côté main de
 * getSecureCurrentUser() (canal IPC sync:getAutoUpstream, cf. handlers.ts) — ce hook se
 * contente de déclencher la lecture pour l'utilisateur actuellement connecté (via
 * useAuthStore) et ne transmet aucun paramètre d'identité ; aucune fuite de préférence
 * inter-comptes possible depuis le renderer.
 *
 * Rafraîchissement cross-vue (low-memory, CLAUDE.md §2) : un simple re-fetch au montage/au
 * changement d'utilisateur suffit dans le cas général. En complément, un CustomEvent léger
 * (AUTO_UPSTREAM_CHANGED_EVENT, émis par ProfilePage.tsx au moment de la bascule) permet de
 * refléter immédiatement un changement fait depuis une autre vue déjà montée — sans polling
 * ni setInterval.
 */
export function useAutoUpstreamPreference(): boolean {
  const userId = useAuthStore((state) => state.user?.id_user);
  // État initial à false (cf. audit agent-9-senior-auditor, correctif P1) : le vrai défaut
  // backend (sync:getAutoUpstream, handlers.ts) vaut false pour ADMINISTRATEUR_SITE en
  // l'absence de ligne t_config — initialiser à true créait une fenêtre transitoire (durée du
  // round-trip IPC) où usePushButtonVisibility masquait à tort le bouton manuel pour ce rôle.
  // false est le choix le plus restrictif : le seul résidu possible est une brève
  // sur-affichage du bouton pour les rôles dont le vrai défaut est true (sans risque), jamais
  // un masquage incorrect. Symétrique à useAutoDownstreamPreference.ts (déjà initialisé à
  // false).
  const [autoUpstream, setAutoUpstream] = useState(false);

  const fetchPreference = useCallback(() => {
    if (!userId) {
      setAutoUpstream(false);
      return;
    }
    window.api.sync.getAutoUpstream()
      .then(setAutoUpstream)
      .catch((err) => {
        console.error('Failed to fetch auto upstream preference', err);
      });
  }, [userId]);

  useEffect(() => {
    fetchPreference();
  }, [fetchPreference]);

  useEffect(() => {
    window.addEventListener(AUTO_UPSTREAM_CHANGED_EVENT, fetchPreference);
    return () => window.removeEventListener(AUTO_UPSTREAM_CHANGED_EVENT, fetchPreference);
  }, [fetchPreference]);

  return autoUpstream;
}
