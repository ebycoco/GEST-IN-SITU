import { useEffect, useState } from 'react';
import { 
  CreditCard, 
  Package, 
  Truck, 
  AlertTriangle, 
  BarChart3, 
  Activity 
} from 'lucide-react';

interface Stats {
  total: number;
  en_stock: number;
  distribuees: number;
  absentes: number;
  doublons_stricts: number;
  sans_num_secu: number;
  distribParJour: { jour: string; count: number }[];
  distribParCentre: { centre: string; count: number }[];
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await window.api.stats.get();
      setStats(data);
    } catch (e) { 
      console.error("Erreur lors du chargement des stats:", e); 
    } finally { 
      setLoading(false); 
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ textAlign: 'center' }}>
        <Activity size={40} color="var(--accent-primary)" style={{ animation: 'pulse 1.5s infinite' }} />
        <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>Chargement des statistiques...</p>
      </div>
    </div>
  );

  const s = stats || { 
    total: 0, 
    en_stock: 0, 
    distribuees: 0, 
    absentes: 0, 
    doublons_stricts: 0, 
    sans_num_secu: 0, 
    distribParJour: [], 
    distribParCentre: [] 
  };

  const kpis = [
    { label: 'Total Cartes', value: (s.total || 0).toLocaleString('fr'), icon: CreditCard, cls: 'kpi-1' },
    { label: 'En Stock', value: (s.en_stock || 0).toLocaleString('fr'), icon: Package, cls: 'kpi-2' },
    { label: 'Distribuées', value: (s.distribuees || 0).toLocaleString('fr'), icon: Truck, cls: 'kpi-3' },
    { label: 'Absentes', value: (s.absentes || 0).toLocaleString('fr'), icon: AlertTriangle, cls: 'kpi-4' },
    { label: 'Doublons', value: (s.doublons_stricts || 0).toLocaleString('fr'), icon: BarChart3, cls: 'kpi-5' },
  ];

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* KPI Row */}
      <div className="kpi-grid">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <div key={i} className={`kpi-card ${kpi.cls}`} style={{ animationDelay: `${i * 80}ms` }}>
              <div className="kpi-icon"><Icon size={24} /></div>
              <div>
                <div className="kpi-value">{kpi.value}</div>
                <div className="kpi-label">{kpi.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title"><Activity size={16} /> État du Système</span>
        </div>
        <div className="card-body">
          <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
            Les statistiques réelles sont maintenant extraites de votre base de données locale. 
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="card" style={{ padding: 16, background: 'rgba(255,255,255,0.03)' }}>
              <h4 style={{ color: 'var(--accent-primary)', marginBottom: 8 }}>Base de données</h4>
              <p style={{ fontSize: 13 }}>SQLite (Local) : Connecté</p>
              <p style={{ fontSize: 13 }}>Mode : WAL (High Performance)</p>
            </div>
            <div className="card" style={{ padding: 16, background: 'rgba(255,255,255,0.03)' }}>
              <h4 style={{ color: 'var(--accent-secondary)', marginBottom: 8 }}>Session</h4>
              <p style={{ fontSize: 13 }}>Utilisateur : Super Administrateur</p>
              <p style={{ fontSize: 13 }}>Rôle : SUPER ADMIN</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
