import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { useSyncDownstreamStore } from '../../stores/syncDownstreamStore';
import { useAuthStore } from '../../stores/authStore';
import { Globe } from 'lucide-react';

export default function MainLayout() {
  const [appVersion, setAppVersion] = useState('');
  const initialDataLoading = useAuthStore((s) => s.initialDataLoading);
  const loadingProgress = useAuthStore((s) => s.loadingProgress);
  const loadingStepText = useAuthStore((s) => s.loadingStepText);

  useEffect(() => {
    if (window.api?.app?.getVersion) {
      window.api.app.getVersion().then(setAppVersion).catch(console.error);
    }
  }, []);

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
        <div className="page-content" style={{ position: 'relative' }}>
          {/* Overlay de chargement global */}
          {initialDataLoading && (
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              zIndex: 9999,
              background: 'rgba(10, 15, 28, 0.85)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '8px' // Pour s'adapter à l'espace s'il y a un rayon
            }}>
              <div className="dashboard-premium animate-fade-in" style={{ padding: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, textAlign: 'center', border: '1px solid rgba(255, 215, 0, 0.15)', background: 'rgba(10, 14, 39, 0.9)', borderRadius: 20 }}>
                <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'rgba(255, 215, 0, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 24px rgba(255, 215, 0, 0.15)' }}>
                  <Globe size={34} color="#ffd700" style={{ animation: 'spin 1.5s linear infinite' }} />
                </div>
                <div>
                  <h3 style={{ fontSize: 19, fontWeight: 700, color: 'white', marginBottom: 8 }}>
                    Chargement sécurisé en cours...
                  </h3>
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 520, lineHeight: 1.6, marginBottom: 24 }}>
                    Veuillez patienter pendant l'initialisation de la page. Les actions sont temporairement verrouillées pour éviter toute erreur de concurrence.
                  </p>

                  <div style={{
                    background: 'rgba(10, 15, 28, 0.8)',
                    borderRadius: 12,
                    padding: '16px 20px',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>
                        {loadingStepText || 'Initialisation...'}
                      </span>
                      <span style={{ fontSize: 14, color: '#818cf8', fontWeight: 700 }}>
                        {loadingProgress}%
                      </span>
                    </div>
                    
                    <div style={{ 
                      width: '100%', 
                      height: 6, 
                      background: 'rgba(255, 255, 255, 0.05)', 
                      borderRadius: 4, 
                      overflow: 'hidden' 
                    }}>
                      <div className="transition-all duration-300 ease-out" style={{
                        width: `${loadingProgress}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #8b5cf6, #6366f1)',
                        borderRadius: 4
                      }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          
          <div style={{
            opacity: initialDataLoading ? 0.3 : 1,
            pointerEvents: initialDataLoading ? 'none' : 'auto',
            transition: 'opacity 0.3s ease-in-out',
            height: '100%',
            overflow: 'auto'
          }}>
            <Outlet />
          </div>
        </div>
        
        {/* Footer global présent sur toutes les pages */}
        <footer style={{
          textAlign: 'center',
          padding: '12px 20px',
          fontSize: '11px',
          color: 'var(--text-muted)',
          opacity: 0.6,
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          marginTop: 'auto'
        }}>
          GEST-IN-SITU {appVersion ? `v${appVersion}` : ''} - © Ebychoco {new Date().getFullYear()} - Tous droits réservés
        </footer>
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
