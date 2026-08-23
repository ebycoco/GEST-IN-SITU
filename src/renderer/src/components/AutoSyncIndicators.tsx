import React from 'react';
import { UploadCloud, DownloadCloud } from 'lucide-react';
import { useAutoUpstreamPreference } from '../hooks/useAutoUpstreamPreference';
import { useAutoDownstreamPreference } from '../hooks/useAutoDownstreamPreference';

/**
 * Deux petits badges d'état "Envoi Automatique" / "Récupération Automatique", à monter dans
 * la même barre d'actions que les boutons push/pull des vues concernées (AdminCentreLayout,
 * AgentVerificationLayout, AgentSaisieLayout, InventaireLayout, ApurementLayout,
 * AgentQualiteLayout, VerificationSearchPage). Purement informatif (aucune interaction —
 * la bascule ON/OFF reste sur ProfilePage.tsx) : vert quand la préférence correspondante est
 * active, gris sinon, avec un tooltip explicite.
 *
 * Style calqué sur les badges déjà présents dans AgentVerificationLayout.tsx (blocs
 * rgba(...) avec bordure colorée assortie).
 */
export function AutoSyncIndicators() {
  const autoUpstream = useAutoUpstreamPreference();
  const autoDownstream = useAutoDownstreamPreference();

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <div
        title={`Envoi Automatique : ${autoUpstream ? 'Activé' : 'Désactivé'}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px',
          background: autoUpstream ? 'rgba(74, 222, 128, 0.05)' : 'rgba(255, 255, 255, 0.03)',
          borderRadius: 12,
          border: autoUpstream ? '1px solid rgba(74, 222, 128, 0.2)' : '1px solid rgba(255, 255, 255, 0.1)',
          color: 'var(--text-secondary)'
        }}
      >
        <UploadCloud size={16} color={autoUpstream ? '#4ade80' : 'var(--text-muted)'} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Envoi Automatique : {autoUpstream ? 'Activé' : 'Désactivé'}
        </span>
      </div>

      <div
        title={`Récupération Automatique : ${autoDownstream ? 'Activée' : 'Désactivée'}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px',
          background: autoDownstream ? 'rgba(74, 222, 128, 0.05)' : 'rgba(255, 255, 255, 0.03)',
          borderRadius: 12,
          border: autoDownstream ? '1px solid rgba(74, 222, 128, 0.2)' : '1px solid rgba(255, 255, 255, 0.1)',
          color: 'var(--text-secondary)'
        }}
      >
        <DownloadCloud size={16} color={autoDownstream ? '#4ade80' : 'var(--text-muted)'} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          Récupération Automatique : {autoDownstream ? 'Activée' : 'Désactivée'}
        </span>
      </div>
    </div>
  );
}
