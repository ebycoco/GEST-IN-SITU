import { confirmService } from '../components/confirmService';

/**
 * Encapsule une action non encore implémentée et affiche une modale
 * d'avertissement 'En cours de développement' à l'utilisateur.
 */
export const withSafeGuard = (actionName?: string) => {
  return () => {
    confirmService.confirm({
      title: 'Fonctionnalité en développement',
      message: `Cette fonctionnalité ${actionName ? `(${actionName}) ` : ''}est actuellement en cours de développement. Elle sera disponible dans une prochaine mise à jour.`,
      isAlert: true
    });
  };
};
