import { create } from 'zustand';

interface User {
  id_user: number;
  login: string;
  role: string;
  nom_user?: string;
  prenom_user?: string;
  centre_id?: number;
  poste_id?: number;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  login: async (username, password) => {
    set({ isLoading: true });
    try {
      const user = await window.api.auth.login(username, password);
      if (user) {
        set({ user, isLoading: false });
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
    set({ user: null });
  },
  checkAuth: async () => {
    // Session persistent logic can be added here
    return null;
  }
}));
