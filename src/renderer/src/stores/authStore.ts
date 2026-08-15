import { create } from 'zustand';

interface User {
  id_user: number;
  login: string;
  role: string;
  roles?: string[];
  nom_user?: string;
  prenom_user?: string;
  site_id?: number;
  centre_id?: number;
  poste_id?: number;
}

interface AuthState {
  user: User | null;
  selectedCentreId: number | null;
  activeSiteId: number | null; // Contexte de site pour le Super Admin
  isLoading: boolean;
  initialDataLoading: boolean;
  loadingProgress: number;
  loadingStepText: string;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  setSelectedCentreId: (id: number | null) => void;
  setActiveSiteId: (id: number | null) => void;
  setInitialDataLoading: (loading: boolean) => void;
  setInitialDataProgress: (progress: number, stepText?: string) => void;
  setActiveRole: (role: string) => Promise<void>;
  checkAuth: () => Promise<void>;
  applySessionUpdate: (payload: { roles: string[] }) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  selectedCentreId: null,
  activeSiteId: null,
  isLoading: false,
  initialDataLoading: false,
  loadingProgress: 0,
  loadingStepText: 'Initialisation...',
  login: async (username, password) => {
    set({ isLoading: true });
    try {
      const user = await window.api.auth.login(username, password);
      if (user) {
        // Initialize context
        const initialCentreId = user.role !== 'SUPER ADMIN' && user.role !== 'ADMINISTRATEUR_SITE' 
          ? user.centre_id 
          : null;
        
        // For Site & Centre Admins, fix the activeSiteId to their assigned site
        const initialSiteId = (user.role === 'ADMINISTRATEUR_SITE' || user.role === 'ADMIN_CENTRE') ? user.site_id : null;
          
        set({ 
          user, 
          selectedCentreId: initialCentreId,
          activeSiteId: initialSiteId,
          isLoading: false,
          initialDataLoading: true,
          loadingProgress: 10,
          loadingStepText: 'Connexion BDD réussie...'
        });
        return true;
      }
      set({ isLoading: false });
      return false;
    } catch (error: any) {
      set({ isLoading: false });
      throw error; // Propager l'erreur pour la page de login
    }
  },
  logout: async () => {
    try {
      const state = useAuthStore.getState();
      const login = state.user?.login;
      await window.api.auth.logout(login);
    } catch (e) {
      console.error('Erreur lors du logout IPC:', e);
    }
    // Réinitialiser le cache Zustand à la déconnexion
    try {
      const { useCacheStore } = await import('./cacheStore');
      useCacheStore.getState().clearCache();
    } catch (cacheErr) {
      console.error('Erreur lors du nettoyage du cache:', cacheErr);
    }
    // Nettoyer le flag de session pour l'auto-sync et nettoyer le sessionStorage
    sessionStorage.clear();
    set({ user: null, selectedCentreId: null, activeSiteId: null, initialDataLoading: false });
  },
  setSelectedCentreId: (id) => {
    set({ selectedCentreId: id });
  },
  setActiveSiteId: (id) => {
    set({ activeSiteId: id, selectedCentreId: null }); // Reset centre when site changes
  },
  setInitialDataLoading: (loading) => {
    if (loading) {
      set({ initialDataLoading: loading, loadingProgress: 0, loadingStepText: 'Initialisation...' });
    } else {
      set({ initialDataLoading: loading });
    }
  },
  setInitialDataProgress: (progress, stepText) => {
    set((state) => ({
      loadingProgress: progress,
      loadingStepText: stepText || state.loadingStepText
    }));
  },
  setActiveRole: async (role) => {
    // Le rôle actif est désormais validé et propagé côté serveur (Main Process) via
    // auth:setActiveRole — sans cela, getSecureCurrentUser().role restait figé sur le rôle
    // de connexion pour toute la session, cassant le cantonnement centre de plusieurs
    // handlers pour un compte multi-rôles. Le store local n'est mis à jour qu'après
    // confirmation serveur (jamais en optimiste) pour ne jamais désynchroniser l'UI de la
    // session réelle.
    const res = await window.api.auth.setActiveRole(role);
    if (!res.success) {
      throw new Error(res.message || 'Changement de rôle refusé par le serveur.');
    }
    set((state) => {
      if (state.user) {
        return { user: { ...state.user, role } };
      }
      return state;
    });
  },
  checkAuth: async () => {
    // Rafraîchit l'état local (nom/prénom/rôles) depuis l'instantané de session serveur
    // (getSecureCurrentUser(), en mémoire côté main process) — utile au montage de l'app
    // pour refléter une modification de compte (rôles) synchronisée par un admin pendant
    // que ce poste était déjà ouvert, sans attendre une fermeture/réouverture. Comportement
    // dégradé strict : en l'absence de session (utilisateur non connecté) ou en cas d'échec
    // IPC, on ne touche PAS à l'état existant — jamais de reset ici (cf. onSessionExpired
    // pour la déconnexion forcée, gérée ailleurs).
    try {
      const snapshot = await window.api?.auth?.getSessionSnapshot?.();
      if (!snapshot || !snapshot.id_user) {
        return;
      }
      set((state) => ({
        user: {
          ...state.user,
          id_user: snapshot.id_user,
          login: snapshot.login,
          role: snapshot.role,
          roles: snapshot.roles,
          nom_user: snapshot.nom_user,
          prenom_user: snapshot.prenom_user,
          site_id: snapshot.site_id,
          centre_id: snapshot.centre_id,
        }
      }));
    } catch (e) {
      console.error('Erreur lors de la vérification de session locale (checkAuth):', e);
      // Ne pas réinitialiser la session en cas d'échec — comportement dégradé
    }
  },
  applySessionUpdate: (payload) => {
    // Mise à jour silencieuse et non destructive : uniquement la liste des rôles
    // disponibles (déclenchée par le canal léger auth:session-updated après un pull de
    // synchro ayant modifié t_user_roles pour l'utilisateur courant). Ne touche jamais
    // site_id/centre_id ni le rôle actif sélectionné (state.user.role) — cf. consigne.
    set((state) => ({
      user: state.user ? { ...state.user, roles: payload.roles } : state.user
    }));
  }
}));

