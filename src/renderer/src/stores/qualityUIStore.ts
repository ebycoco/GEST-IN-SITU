import { create } from 'zustand';
import { ICarte } from '../../../shared/types';

interface QualityUIState {
  activeCard: ICarte | any | null;
  correctionType: string;
  isGuideOpen: boolean;
  guideInitialName: string;
  refreshTrigger: number; // to notify views to refresh after a correction
  
  openCorrection: (card: ICarte | any, type: string) => void;
  closeCorrection: () => void;
  
  openGuide: (name?: string) => void;
  closeGuide: () => void;
  
  triggerRefresh: () => void;
}

export const useQualityUIStore = create<QualityUIState>((set) => ({
  activeCard: null,
  correctionType: '',
  isGuideOpen: false,
  guideInitialName: '',
  refreshTrigger: 0,
  
  openCorrection: (card, type) => set({ activeCard: card, correctionType: type }),
  closeCorrection: () => set({ activeCard: null, correctionType: '' }),
  
  openGuide: (name = '') => set({ isGuideOpen: true, guideInitialName: name }),
  closeGuide: () => set({ isGuideOpen: false }),
  
  triggerRefresh: () => set((state) => ({ refreshTrigger: state.refreshTrigger + 1 })),
}));
