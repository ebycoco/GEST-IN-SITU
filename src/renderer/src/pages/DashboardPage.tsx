import { useEffect, useState } from 'react';
import { CreditCard, Package, Truck, AlertTriangle, BarChart3, TrendingUp, Activity } from 'lucide-react';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler);

interface Stats {
  total: number; en_stock: number; distribuees: number; absentes: number;
  doublons_stricts: number; sans_num_secu: number;
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
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ textAlign: 'center' }}>
        <Activity size={40} color="var(--accent-primary)" style={{ animation: 'pulse 1.5s infinite' }} />
        <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>Chargement des statistiques...</p>
      </div>
    </div>
  );

  const s = stats || { total: 0, en_stock: 0, distribuees: 0, absentes: 0, doublons_stricts: 0, sans_num_secu: 0, distribParJour: [], distribParCentre: [] };
  const kpis = [
    { label: 'Total Cartes', value: s.total.toLocaleString('fr'), icon: CreditCard, cls: 'kpi-1' },
    { label: 'En Stock', value: s.en_stock.toLocaleString('fr'), icon: Package, cls: 'kpi-2' },
    { label: 'Distribuées', value: s.distribuees.toLocaleString('fr'), icon: Truck, cls: 'kpi-3' },
    { label: 'Absentes', value: s.absentes.toLocaleString('fr'), icon: AlertTriangle, cls: 'kpi-4' },
    { label: 'Doublons', value: s.doublons_stricts.toLocaleString('fr'), icon: BarChart3, cls: 'kpi-5' },
  ];

  const lineData = {
    labels: s.distribParJour.slice().reverse().map(d => { const dt = new Date(d.jour); return `${dt.getDate()}/${dt.getMonth()+1}`; }),
    datasets: [{
      label: 'Distributions',
      data: s.distribParJour.slice().reverse().map(d => d.count),
      borderColor: '#6c63ff', backgroundColor: 'rgba(108,99,255,0.1)',
      fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#6c63ff',
    }]
  };

  const barData = {
    labels: s.distribParCentre.map(c => c.centre || 'Non assigné'),
    datasets: [{
      label: 'Distributions',
      data: s.distribParCentre.map(c => c.count),
      backgroundColor: ['#6c63ff', '#4ecdc4', '#f39c12', '#e74c3c'],
      borderRadius: 6, barThickness: 40,
    }]
  };

  const doughnutData = {
    labels: ['En Stock', 'Distribuées', 'Absentes'],
    datasets: [{
      data: [s.en_stock, s.distribuees, s.absentes],
      backgroundColor: ['#3498db', '#27ae60', '#e74c3c'],
      borderWidth: 0, cutout: '70%',
    }]
  };

  const chartOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1a1f4a', borderColor: '#2d3561', borderWidth: 1 } },
    scales: {
      x: { grid: { color: 'rgba(45,53,97,0.3)' }, ticks: { color: '#5a5f7a', font: { size: 10 } } },
      y: { grid: { color: 'rgba(45,53,97,0.3)' }, ticks: { color: '#5a5f7a', font: { size: 10 } } },
    }
  };

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

      {/* Charts Row */}
      <div className="charts-grid">
        <div className="card">
          <div className="card-header">
            <span className="card-title"><TrendingUp size={16} /> Évolution des distributions (30 jours)</span>
          </div>
          <div className="card-body">
            <div className="chart-container">
              <Line data={lineData} options={chartOpts} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title"><BarChart3 size={16} /> Répartition des statuts</span>
          </div>
          <div className="card-body">
            <div className="chart-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 220, height: 220 }}>
                <Doughnut data={doughnutData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#8b8fa3', padding: 16, font: { size: 11 } } } } }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bar Chart */}
      <div className="card">
        <div className="card-header">
          <span className="card-title"><BarChart3 size={16} /> Distributions par centre</span>
        </div>
        <div className="card-body">
          <div style={{ height: 250 }}>
            <Bar data={barData} options={chartOpts} />
          </div>
        </div>
      </div>
    </div>
  );
}
