import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Clock, FileText, CheckCircle, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';

export default function Overview() {
  const { user, activeSiteId } = useAuthStore();
  const [operatorTodayCount, setOperatorTodayCount] = useState<number>(0);
  const [operatorRecentSaisies, setOperatorRecentSaisies] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Extrait de l'effet pour être réutilisable par le bouton "Actualiser" ci-dessous,
  // tout en restant la même fonction utilisée par l'auto-refresh (60s) et le listener
  // 'app:data-updated' — comportement de rechargement inchangé, seule la portée a bougé.
  const fetchStats = useCallback(async () => {
    if (user?.login) {
      try {
        const count = await window.api.stats.getAgentToday(user.id_user);
        setOperatorTodayCount(count);

        if (window.api.stats.getAgentRecentSaisies) {
          const recent = await window.api.stats.getAgentRecentSaisies(user.id_user, 5);
          setOperatorRecentSaisies(recent.rows || []);
        }
      } catch (err) {
        console.error("Erreur lors de la récupération des stats de l'opérateur:", err);
      }
    }
  }, [user]);

  useEffect(() => {
    fetchStats();

    // Auto-refresh toutes les minutes
    const interval = setInterval(fetchStats, 60000);

    window.addEventListener('app:data-updated', fetchStats);

    return () => {
      clearInterval(interval);
      window.removeEventListener('app:data-updated', fetchStats);
    };
  }, [fetchStats]);

  const handleRefreshClick = async () => {
    setIsRefreshing(true);
    try {
      await fetchStats();
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1000, margin: '0 auto' }}>
      
      {/* Hero Widget : Saisies du jour */}
      <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '32px', background: 'linear-gradient(135deg, rgba(255, 215, 0, 0.05) 0%, rgba(255, 215, 0, 0.01) 100%)', border: '1px solid rgba(255, 215, 0, 0.2)', borderRadius: 16 }}>
        <div style={{ width: 64, height: 64, borderRadius: 20, background: 'linear-gradient(135deg, #eccc68 0%, #ffd700 100%)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(255, 215, 0, 0.2)' }}>
          <Activity size={32} />
        </div>
        <div>
          <div style={{ fontSize: 36, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{operatorTodayCount}</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#ffd700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Mes saisies aujourd'hui</div>
        </div>
      </div>

      {/* Activité Récente */}
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 24, borderRadius: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, color: 'white' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock size={20} className="text-accent-primary" />
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Activité Récente</h2>
          </div>
          <button
            onClick={handleRefreshClick}
            disabled={isRefreshing}
            className="btn"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, fontSize: 13,
              background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', color: 'white',
              cursor: isRefreshing ? 'not-allowed' : 'pointer', opacity: isRefreshing ? 0.6 : 1, transition: 'all 0.2s'
            }}
            onMouseOver={(e) => { if (!isRefreshing) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
            onMouseOut={(e) => { if (!isRefreshing) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
          >
            <RefreshCw size={16} style={{ animation: isRefreshing ? 'spin 1.5s linear infinite' : 'none' }} />
            {isRefreshing ? 'Actualisation...' : 'Actualiser'}
          </button>
        </div>

        {operatorRecentSaisies.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {operatorRecentSaisies.map((saisie, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                    <FileText size={16} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'white', fontSize: 14 }}>{saisie.prenoms} {saisie.noms}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{saisie.num_secu}</div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle size={14} color="#10b981" /> 
                  Enregistré
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', borderRadius: 12 }}>
            Aucune saisie récente trouvée.
          </div>
        )}
      </div>

    </div>
  );
}
