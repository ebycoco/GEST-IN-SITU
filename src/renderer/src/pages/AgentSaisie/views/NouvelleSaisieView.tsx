import React from 'react';
import SaisiePage from '../../SaisiePage';

export default function NouvelleSaisieView() {
  return (
    <div style={{ marginTop: '-24px' }}>
      {/* On réutilise SaisiePage directement pour éviter la duplication de code, 
          tout en annulant une partie de son padding haut pour qu'elle s'intègre
          bien dans le layout AgentSaisieLayout */}
      <SaisiePage />
    </div>
  );
}
