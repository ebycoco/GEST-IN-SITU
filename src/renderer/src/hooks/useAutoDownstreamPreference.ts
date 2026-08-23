import { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';

/**
 * Nom du CustomEvent window émis par ProfilePage.tsx juste après une bascule réussie
 * de la préférence "Récupération automatique des cartes" (window.api.sync.setAutoDownstream).
 * Permet aux vues déjà montées ailleurs dans l'app (boutons manuels "Récupérer les cartes
 * depuis le cloud") de refléter le nouvel état sans rechargement complet de la page.
 *
 * Même convention déjà en place dans le dépôt pour 'app:data-updated' (cf.
 * AgentQualiteLayout.tsx, AdminCentreLayout.tsx, useDeliveryFlow.ts...), mais un événement
 * dédié est utilisé ici pour ne pas déclencher de rechargement de données métier non lié à
 * ce changement de préférence.
 */
export const AUTO_DOWNSTREAM_CHANGED_EVENT = 'app:auto-downstream-changed';

/**
 * Lit la préférence utilisateur "Récupération automatique des cartes"
 * (t_config, clé `auto_downstream_<id_user>` — migration V65, cf. schema.ts) afin de
 * conditionner l'affichage du bouton manuel "Récupérer les cartes depuis le cloud" présent
 * sur plusieurs vues (VerificationSearchPage, OperatorView, SiteAdminView, AdminCentreLayout,
 * AgentVerificationLayout, AgentQualiteLayout, ApurementLayout, InventaireLayout) : quand la
 * récupération automatique est active, ce bouton manuel doit rester désactivé et son
 * compteur de cartes en attente masqué.
 *
 * Sécurité (CLAUDE.md §3) : l'identité utilisée pour la lecture est dérivée côté main de
 * getSecureCurrentUser() (canal IPC sync:getAutoDownstream, cf. handlers.ts) — ce hook se
 * contente de déclencher la lecture pour l'utilisateur actuellement connecté (via
 * useAuthStore) et ne transmet aucun paramètre d'identité ; aucune fuite de préférence
 * inter-comptes possible depuis le renderer.
 *
 * Rafraîchissement cross-vue (low-memory, CLAUDE.md §2) : un simple re-fetch au montage/au
 * changement d'utilisateur suffit dans le cas général. En complément, un CustomEvent léger
 * (AUTO_DOWNSTREAM_CHANGED_EVENT, émis par ProfilePage.tsx au moment de la bascule) permet de
 * refléter immédiatement un changement fait depuis une autre vue déjà montée — sans polling
 * ni setInterval.
 */
export function useAutoDownstreamPreference(): boolean {
  const userId = useAuthStore((state) => state.user?.id_user);
  const [autoDownstream, setAutoDownstream] = useState(false);

  const fetchPreference = useCallback(() => {
    if (!userId) {
      setAutoDownstream(false);
      return;
    }
    window.api.sync.getAutoDownstream()
      .then(setAutoDownstream)
      .catch((err) => {
        console.error('Failed to fetch auto downstream preference', err);
      });
  }, [userId]);

  useEffect(() => {
    fetchPreference();
  }, [fetchPreference]);

  useEffect(() => {
    window.addEventListener(AUTO_DOWNSTREAM_CHANGED_EVENT, fetchPreference);
    return () => window.removeEventListener(AUTO_DOWNSTREAM_CHANGED_EVENT, fetchPreference);
  }, [fetchPreference]);

  return autoDownstream;
}
