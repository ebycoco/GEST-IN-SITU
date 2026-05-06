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
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  setSelectedCentreId: (id: number | null) => void;
  setActiveSiteId: (id: number | null) => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  selectedCentreId: null,
  activeSiteId: null,
  isLoading: false,
  login: async (username, password) => {
    set({ isLoading: true });
    try {
      const user = await window.api.auth.login(username, password);
      if (user) {
        // Initialize context
        const initialCentreId = user.role !== 'SUPER ADMIN' && user.role !== 'ADMINISTRATEUR' 
          ? user.centre_id 
          : null;
        
        // For Site Admins, fix the activeSiteId to their assigned site
        const initialSiteId = user.role === 'ADMINISTRATEUR' ? user.site_id : null;
          
        set({ 
          user, 
          selectedCentreId: initialCentreId, 
          activeSiteId: initialSiteId,
          isLoading: false 
        });
        return true;
      }
      set({ isLoading: false });
      return false;
    } catch {
      set({ isLoading: false });
      return false;
    }
  },
  logout: () => {
    set({ user: null, selectedCentreId: null, activeSiteId: null });
  },
  setSelectedCentreId: (id) => {
    set({ selectedCentreId: id });
  },
  setActiveSiteId: (id) => {
    set({ activeSiteId: id, selectedCentreId: null }); // Reset centre when site changes
  },
  checkAuth: async () => {
    return null;
  }
}));
