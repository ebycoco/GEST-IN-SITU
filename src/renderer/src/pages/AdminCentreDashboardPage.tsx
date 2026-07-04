import React, { useState, useEffect } from 'react';
import { 
  Building2, 
  CreditCard, 
  CheckCircle, 
  AlertTriangle, 
  TrendingUp, 
  RefreshCw, 
  Clock, 
  UserCheck 
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

interface CentreStats {
  total: number;
  en_stock: number;
  distribuees: number;
  absentes: number;
}

interface OperatorCadence {
  id_user: number;
  login: string;
  nom_user: string;
  prenom_user: string;
  verifications_today: number;
  derniere_activite: string | null;
}

export default function AdminCentreDashboardPage() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<CentreStats>({ total: 0, en_stock: 0, distribuees: 0, absentes: 0 });
  const [cadence, setCadence] = useState<OperatorCadence[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchDashboardData = async () => {
    if (!user?.centre_id || !user?.site_id) return;
    try {
      const statsRes = await window.api.stats.getCentre(user.centre_id, user.site_id);
      const cadenceRes = await window.api.stats.getCentreOperateurs(user.centre_id);
      if (statsRes) setStats(statsRes);
      if (cadenceRes) setCadence(cadenceRes);
      setLastRefreshed(new Date());
    } catch (error) {
      console.error("Erreur lors du chargement des données superviseur:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    // Auto-refresh toutes les 30 secondes
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const formatLastActivity = (isoString: string | null) => {
    if (!isoString) return '—';
    try {
      const date = new Date(isoString);
      const diffMs = new Date().getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'À l\'instant';
      if (diffMins < 60) return `Il y a ${diffMins} min`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `Il y a ${diffHours} h`;
      return date.toLocaleDateString();
    } catch {
      return '—';
    }
  };

  return (
    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', minHeight: '100%', color: 'var(--text-primary)' }}>
      {/* En-tête */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--accent-primary)', marginBottom: 4 }}>
            <Building2 size={24} />
            <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Supervision Locale</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>Tableau de bord Centre</h1>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
            Suivi opérationnel en temps réel de votre centre d'enrôlement
          </p>
        </div>
        
        <button 
          onClick={fetchDashboardData} 
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 12,
            color: 'var(--text-primary)',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Mettre à jour
        </button>
      </div>

      {/* COMPTEURS STYLE PLEIN SOLEIL */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
        
        {/* Tuile 1 : TOTAL EN STOCK */}
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-subtle)', 
          borderRadius: 16, 
          padding: '20px', 
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>En Stock</div>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#eab308' }}>
              <CreditCard size={18} />
            </div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)' }}>
            {stats.en_stock.toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Cartes prêtes à la distribution</div>
        </div>

        {/* Tuile 2 : DISTRIBUÉES */}
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-subtle)', 
          borderRadius: 16, 
          padding: '20px', 
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Délivrées</div>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e' }}>
              <CheckCircle size={18} />
            </div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)' }}>
            {stats.distribuees.toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Cartes remises aux assurés</div>
        </div>

        {/* Tuile 3 : ABSENTES */}
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-subtle)', 
          borderRadius: 16, 
          padding: '20px', 
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Absentes</div>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
              <AlertTriangle size={18} />
            </div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)' }}>
            {stats.absentes.toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Signalements d'anomalies en cours</div>
        </div>

        {/* Tuile 4 : TOTAL EN BASE */}
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-subtle)', 
          borderRadius: 16, 
          padding: '20px', 
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>Total</div>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b5cf6' }}>
              <TrendingUp size={18} />
            </div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-primary)' }}>
            {stats.total.toLocaleString()}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Total des cartes rattachées au centre</div>
        </div>

      </div>

      {/* CADENCE ET PERFORMANCES DES OPERATEURS */}
      <div style={{ 
        background: 'var(--bg-secondary)', 
        border: '1px solid var(--border-subtle)', 
        borderRadius: 20, 
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <UserCheck size={20} style={{ color: 'var(--accent-primary)' }} />
              Cadence de l'équipe locale
            </h2>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
              Vérifications et remises de cartes CMU enregistrées aujourd'hui
            </p>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={12} />
            Mis à jour le {lastRefreshed.toLocaleTimeString()} (Rafraîchissement 30s)
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Nom complet</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Identifiant</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'center' }}>Cadence / Jour</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Dernière activité</th>
              </tr>
            </thead>
            <tbody>
              {cadence.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                    Aucun Opérateur de Vérification actif aujourd'hui dans ce centre.
                  </td>
                </tr>
              ) : (
                cadence.map((op) => (
                  <tr key={op.id_user} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', fontSize: 14, transition: 'background 0.2s' }} className="hover-row">
                    <td style={{ padding: '16px', fontWeight: 600 }}>{op.nom_user} {op.prenom_user}</td>
                    <td style={{ padding: '16px', color: 'var(--text-secondary)' }}>@{op.login}</td>
                    <td style={{ padding: '16px', textAlign: 'center' }}>
                      <span style={{ 
                        background: op.verifications_today > 0 ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.02)',
                        color: op.verifications_today > 0 ? '#22c55e' : 'var(--text-secondary)',
                        padding: '6px 12px',
                        borderRadius: 20,
                        fontWeight: 700,
                        fontSize: 13,
                        border: op.verifications_today > 0 ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(255,255,255,0.05)',
                      }}>
                        {op.verifications_today} {op.verifications_today > 1 ? 'cartes' : 'carte'}
                      </span>
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 500 }}>
                      {formatLastActivity(op.derniere_activite)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
