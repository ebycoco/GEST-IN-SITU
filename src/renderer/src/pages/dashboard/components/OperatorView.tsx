import React from 'react';
import { Activity, Database, Globe } from 'lucide-react';

interface OperatorViewProps {
  operatorTodayCount: number;
  operatorRecentSaisies: any[];
  dirtyCartesCount: number;
  cloudCartesCount: number;
  isOnline: boolean;
  isPullingCards: boolean;
  isBulkUploading: boolean;
  handleStartBulkUpload: () => void;
  handlePullSiteCards: () => void;
}

export function OperatorView({
  operatorTodayCount,
  operatorRecentSaisies,
  dirtyCartesCount,
  cloudCartesCount,
  isOnline,
  isPullingCards,
  isBulkUploading,
  handleStartBulkUpload,
  handlePullSiteCards
}: OperatorViewProps) {
  return (
    <div className="dashboard-premium animate-fade-in" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: 'white', margin: 0 }}>TABLEAU DE BORD OPÉRATEUR</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>Suivi quotidien de vos performances de saisie de fiches.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,215,0,0.06)', border: '1px solid rgba(255,215,0,0.15)', padding: '10px 16px', borderRadius: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffd700' }} className="animate-pulse" />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#ffd700' }}>SESSION ACTIVE</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button 
          onClick={handlePullSiteCards} 
          disabled={isPullingCards || !isOnline || cloudCartesCount === 0}
          className="btn-outline" 
          style={{ 
            padding: '12px 24px', 
            borderRadius: 12, 
            fontWeight: 700,
            cursor: (isPullingCards || !isOnline || cloudCartesCount === 0) ? 'not-allowed' : 'pointer',
            opacity: (isPullingCards || !isOnline || cloudCartesCount === 0) ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(255, 255, 255, 0.03)',
            color: 'white',
            flex: '1 1 auto',
            justifyContent: 'center',
            whiteSpace: 'nowrap'
          }}
        >
          <Database size={18} style={{ animation: isPullingCards ? 'spin 1.5s linear infinite' : 'none' }} />
          {isPullingCards ? 'RÉCUPÉRATION EN COURS...' : `RÉCUPÉRER LES CARTES DEPUIS LE CLOUD${cloudCartesCount > 0 ? ` (${cloudCartesCount.toLocaleString('fr')})` : ''}`}
        </button>

        <button 
          onClick={handleStartBulkUpload} 
          disabled={isBulkUploading || !isOnline || dirtyCartesCount === 0}
          className="btn-plein-soleil" 
          style={{ 
            padding: '12px 24px', 
            borderRadius: 12, 
            fontWeight: 700,
            backgroundColor: (isBulkUploading || !isOnline || dirtyCartesCount === 0) ? '#555555' : '#FFE600',
            color: (isBulkUploading || !isOnline || dirtyCartesCount === 0) ? '#ffffff' : '#000000',
            border: '1px solid #FFE600',
            cursor: (isBulkUploading || !isOnline || dirtyCartesCount === 0) ? 'not-allowed' : 'pointer',
            opacity: (isBulkUploading || !isOnline || dirtyCartesCount === 0) ? 0.5 : 1,
            boxShadow: '0 4px 15px rgba(255, 230, 0, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease-in-out',
            flex: '1 1 auto',
            whiteSpace: 'nowrap'
          }}
        >
          <Globe size={18} style={{ animation: isBulkUploading ? 'spin 1.5s linear infinite' : 'none' }} />
          {isBulkUploading ? 'ENVOI EN COURS...' : `ENVOYER LES CARTES VERS LE CLOUD${dirtyCartesCount > 0 ? ` (${dirtyCartesCount.toLocaleString('fr')})` : ''}`}
        </button>
      </div>

      <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '32px', background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.05) 0%, rgba(255, 215, 0, 0.01) 100%)', border: '1px solid rgba(255, 215, 0, 0.2)', borderRadius: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, #eccc68 0%, #ffd700 100%)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(255, 215, 0, 0.2)' }}>
          <Activity size={32} />
        </div>
        <div>
          <div style={{ fontSize: 36, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{operatorTodayCount}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#ffd700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Mes saisies aujourd'hui</div>
        </div>
      </div>

      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24, borderRadius: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 16 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'white' }}>Dernières fiches saisies (Max 15)</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Mise à jour en temps réel</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>NOMS & PRÉNOMS</th>
                <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>N° CMU</th>
                <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>DATE DE NAISSANCE</th>
                <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>RANGEMENT</th>
                <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600 }}>STATUT</th>
                <th style={{ padding: '12px 16px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>DATE SAISIE</th>
              </tr>
            </thead>
            <tbody>
              {operatorRecentSaisies.map((c) => (
                <tr key={c.id_carte} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '14px 16px', fontWeight: 700, color: 'white' }}>{c.noms} {c.prenoms}</td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{c.num_secu || '—'}</td>
                  <td style={{ padding: '14px 16px', color: 'var(--text-secondary)' }}>{c.date_de_naissance || '—'}</td>
                  <td style={{ padding: '14px 16px', color: '#ffd700', fontWeight: 600 }}>{c.rangement || '—'}</td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', padding: '3px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>
                      {c.statut}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {new Date(c.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
              {operatorRecentSaisies.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Vous n'avez pas encore saisi de cartes aujourd'hui.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
