import React, { useState, useEffect, useCallback } from 'react';
import { BarChart2, TrendingUp, Calendar, Award, RefreshCw } from 'lucide-react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend
} from 'chart.js';
import { useAuthStore } from '../stores/authStore';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

type Period = 'jour' | 'semaine' | 'mois' | 'annee';

const PERIOD_LABELS: Record<Period, string> = {
  jour:    "Aujourd'hui",
  semaine: 'Cette semaine',
  mois:    'Ce mois',
  annee:   "Cette année",
};

const GOLD        = '#FFD700';
const GOLD_DIM    = 'rgba(255,215,0,0.08)';
const GOLD_BORDER = 'rgba(255,215,0,0.25)';

export default function RetraitsPage() {
  const user         = useAuthStore(s => s.user);
  const activeSiteId = useAuthStore(s => s.activeSiteId);

  const isSiteAdmin = user?.role === 'ADMINISTRATEUR_SITE' || user?.role === 'SUPER ADMIN';
  const siteId      = user?.role === 'SUPER ADMIN' ? (activeSiteId ?? user?.site_id) : user?.site_id;
  const centreId    = isSiteAdmin ? null : (user?.centre_id ?? null);

  const [period,  setPeriod]  = useState<Period>('semaine');
  const [loading, setLoading] = useState(true);
  const [rows,    setRows]    = useState<any[]>([]);
  const [totaux,  setTotaux]  = useState<any>(null);
  const [trend,   setTrend]   = useState<Array<{ label: string; total: number }>>([]);

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const [res, trendData] = await Promise.all([
        window.api.stats.getRetraits(siteId, centreId, period),
        window.api.stats.getRetraitsTrend(siteId, centreId, period),
      ]);
      setRows(res.rows);
      setTotaux(res.totaux);
      setTrend(trendData);
    } catch (e) {
      console.error('[RetraitsPage] load error', e);
    } finally {
      setLoading(false);
    }
  }, [siteId, centreId, period]);

  useEffect(() => { load(); }, [load]);

  const kpis = [
    { label: "Aujourd'hui",  value: totaux?.aujourd_hui   ?? 0, icon: '🌅' },
    { label: 'Cette semaine', value: totaux?.cette_semaine ?? 0, icon: '📅' },
    { label: 'Ce mois',       value: totaux?.ce_mois       ?? 0, icon: '🗓️' },
    { label: "Cette année",   value: totaux?.cette_annee   ?? 0, icon: '🏆' },
  ];

  const chartData = {
    labels: trend.map(t => t.label),
    datasets: [{
      label: 'Retraits',
      data: trend.map(t => t.total),
      backgroundColor: 'rgba(255, 215, 0, 0.55)',
      borderColor: GOLD,
      borderWidth: 2,
      borderRadius: 6,
    }],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0d111b',
        titleColor: GOLD,
        bodyColor: '#e2e8f0',
        borderColor: GOLD_BORDER,
        borderWidth: 1,
      },
    },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8', font: { size: 11 } } },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8', font: { size: 11 } }, beginAtZero: true },
    },
  };

  return (
    <div className="animate-fade-in" style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: 'linear-gradient(135deg, #FFD700 0%, #F59E0B 100%)', width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(255,215,0,0.3)' }}>
            <BarChart2 size={20} color="#0d111b" />
          </div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Suivi des Retraits</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              {isSiteAdmin ? 'Vue multi-centres de votre site' : `Votre centre uniquement`}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Sélecteur de période */}
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3, gap: 2, border: `1px solid ${GOLD_BORDER}` }}>
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, transition: 'all .2s',
                  background: period === p ? GOLD : 'transparent',
                  color:      period === p ? '#0d111b' : '#94a3b8',
                }}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <button
            onClick={load} disabled={loading}
            style={{ background: 'transparent', border: `1px solid ${GOLD_BORDER}`, borderRadius: 8, padding: '7px 12px', cursor: 'pointer', color: GOLD, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {/* KPI STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {kpis.map(kpi => (
          <div key={kpi.label} style={{ background: GOLD_DIM, border: `1px solid ${GOLD_BORDER}`, borderRadius: 16, padding: '18px 22px' }}>
            <div style={{ fontSize: 22 }}>{kpi.icon}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: GOLD, lineHeight: 1.1, marginTop: 6 }}>
              {loading ? '…' : kpi.value.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>{kpi.label}</div>
          </div>
        ))}
      </div>

      {/* CHART */}
      <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${GOLD_BORDER}`, borderRadius: 20, padding: '24px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <TrendingUp size={16} color={GOLD} />
          <span style={{ fontWeight: 700, fontSize: 14, color: GOLD }}>Évolution — {PERIOD_LABELS[period]}</span>
        </div>
        <div style={{ height: 220 }}>
          {loading
            ? <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>Chargement…</div>
            : trend.length === 0
              ? <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>Aucun retrait pour cette période.</div>
              : <Bar data={chartData} options={chartOptions as any} />
          }
        </div>
      </div>

      {/* TABLEAU CLASSEMENT (ADMINISTRATEUR_SITE uniquement) */}
      {isSiteAdmin && (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${GOLD_BORDER}`, borderRadius: 20, padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
            <Award size={16} color={GOLD} />
            <span style={{ fontWeight: 700, fontSize: 14, color: GOLD }}>Classement par Centre — {PERIOD_LABELS[period]}</span>
          </div>
          {loading
            ? <div style={{ textAlign: 'center', padding: 32, color: '#64748b' }}>Chargement…</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${GOLD_BORDER}` }}>
                    {['#', 'Centre', 'Retraits', '% du total', 'Progression'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Retraits' || h === '% du total' ? 'right' : 'left', padding: '8px 12px', fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const periodTotal =
                      period === 'jour'    ? (totaux?.aujourd_hui  || 1)
                      : period === 'semaine' ? (totaux?.cette_semaine || 1)
                      : period === 'mois'    ? (totaux?.ce_mois       || 1)
                      : (totaux?.cette_annee || 1);
                    const barPct = Math.min(Math.round((r.total / periodTotal) * 100), 100);
                    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : String(idx + 1);
                    return (
                      <tr key={r.centre_id}
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'background .15s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,215,0,0.04)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '10px 12px', fontSize: 13, color: idx === 0 ? GOLD : '#64748b', fontWeight: idx < 3 ? 700 : 400 }}>{medal}</td>
                        <td style={{ padding: '10px 12px', fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{r.centre_nom}</td>
                        <td style={{ padding: '10px 12px', fontSize: 14, fontWeight: 800, color: GOLD, textAlign: 'right' }}>{r.total.toLocaleString()}</td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: '#94a3b8', textAlign: 'right' }}>{barPct}%</td>
                        <td style={{ padding: '10px 12px', minWidth: 120 }}>
                          <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 4, height: 6, overflow: 'hidden' }}>
                            <div style={{ width: `${barPct}%`, height: '100%', background: `linear-gradient(90deg, ${GOLD}, #F59E0B)`, borderRadius: 4, transition: 'width .5s ease' }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: '#64748b', fontSize: 13 }}>Aucun retrait pour cette période.</td></tr>
                  )}
                </tbody>
              </table>
            )
          }
        </div>
      )}

      {/* RÉSUMÉ SIMPLE (ADMIN_CENTRE) */}
      {!isSiteAdmin && (
        <div style={{ background: GOLD_DIM, border: `1px solid ${GOLD_BORDER}`, borderRadius: 20, padding: '28px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Calendar size={16} color={GOLD} />
            <span style={{ fontWeight: 700, fontSize: 14, color: GOLD }}>Total de votre Centre — {PERIOD_LABELS[period]}</span>
          </div>
          <div style={{ fontSize: 52, fontWeight: 900, color: GOLD, lineHeight: 1 }}>
            {loading ? '…' : (rows[0]?.total ?? 0).toLocaleString()}
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>retraits enregistrés</div>
        </div>
      )}

      <style>{`@keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }`}</style>
    </div>
  );
}
