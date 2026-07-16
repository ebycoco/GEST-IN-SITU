import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { useSyncDownstreamStore } from '../../stores/syncDownstreamStore';

export default function MainLayout() {
  // ─── ANTI-FREEZE (Couche 3) — Visibility API ─────────────────────────────
  // Détecte le retour de l'utilisateur après une absence (autre fenêtre,
  // explorateur, navigateur) et dispatche un signal 'app:focus-restored'.
  // Les pages avec traitement en cours (import, purge) écoutent ce signal
  // pour effectuer un flush unique et propre de leur état bufferisé.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        window.dispatchEvent(new CustomEvent('app:focus-restored'));
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
  // ──────────────────────────────────────────────────────────────────────────

  // ─── Notification finale unique (sync:updated-data) ──────────────────────
  // Désormais cette notification s'affiche UNE SEULE FOIS à la fin du
  // téléchargement complet, avec le nombre EXACT de cartes reçues.
  useEffect(() => {
    if (window.api && window.api.onDatabaseUpdated) {
      const unsubscribe = window.api.onDatabaseUpdated((data) => {
        const cardCount = data.count ?? data.processedCount ?? 0;
        if (cardCount > 0) {
          toast.success(
            `📥 Synchronisation terminée : ${cardCount.toLocaleString('fr')} carte(s) téléchargée(s) !`,
            {
              duration: 7000,
              style: {
                background: '#000',
                color: '#FFD700',
                border: '1px solid #FFD700'
              }
            }
          );
        }
      });
      return () => unsubscribe();
    }
  }, []);

  // ─── Bannière de téléchargement en arrière-plan ────────────────────────
  // Lit l'état du store GLOBAL → visible sur TOUTES les pages de l'application
  const { isBackgroundPulling, downstreamInfo } = useSyncDownstreamStore();

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar />
        <div className="page-content">
          <Outlet />
        </div>
      </div>

      {/* Bannière discrète globale — visible sur toutes les pages pendant le téléchargement */}
      {isBackgroundPulling && downstreamInfo && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          background: 'rgba(10, 15, 28, 0.95)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(96, 165, 250, 0.35)',
          borderRadius: 14,
          padding: '14px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minWidth: 290,
          boxShadow: '0 8px 32px rgba(96, 165, 250, 0.18)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: '#60a5fa',
                display: 'inline-block', animation: 'pulse 1.5s infinite'
              }} />
              Téléchargement en cours
            </span>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#93c5fd' }}>
              {downstreamInfo.progress}%
            </span>
          </div>
          <div style={{ background: 'rgba(96, 165, 250, 0.1)', borderRadius: 6, height: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${downstreamInfo.progress}%`,
              background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
              borderRadius: 6,
              transition: 'width 0.6s ease'
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
            {downstreamInfo.merged.toLocaleString('fr')} / {downstreamInfo.total > 0 ? downstreamInfo.total.toLocaleString('fr') : '...'} cartes reçues
          </span>
        </div>
      )}
    </div>
  );
}
