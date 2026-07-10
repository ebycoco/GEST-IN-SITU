import { create } from 'zustand';

interface User {
  id_user: number;
  login: string;
  role: string;
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
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  setSelectedCentreId: (id: number | null) => void;
  setActiveSiteId: (id: number | null) => void;
  setInitialDataLoading: (loading: boolean) => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  selectedCentreId: null,
  activeSiteId: null,
  isLoading: false,
  initialDataLoading: false,
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
          initialDataLoading: true
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
    set({ initialDataLoading: loading });
  },
  checkAuth: async () => {
    // Vérification de session locale (actuellement non implémentée/vide)
  }
}));

// Écouteur de session expirée/usurpée à l'échelle de l'application
if (typeof window !== 'undefined' && window.api?.auth?.onSessionExpired) {
  window.api.auth.onSessionExpired(() => {
    useAuthStore.getState().logout();
    // Le toast sera levé ou un message d'alerte s'affichera
    alert("Votre session a été fermée car ce compte s'est connecté sur une autre machine.");
  });
}

