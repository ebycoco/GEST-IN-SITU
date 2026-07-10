import React from 'react';
import { Award, Package, Clock, CheckCircle } from 'lucide-react';

interface StatsPanelProps {
  stats: {
    today: number;
    yesterday: number;
    week: number;
    month: number;
    year: number;
  };
  cardsToday: any[];
}

export function StatsPanel({ stats, cardsToday }: StatsPanelProps) {
  return (
    <div style={{ marginTop: 64, borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: 48 }}>
      <h3 style={{ fontSize: 20, fontWeight: 900, color: 'white', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Award size={20} color="var(--accent-primary)" />
        Vos Performances Individuelles
      </h3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 32 }}>
        {[
          { label: "Aujourd'hui", value: stats.today, icon: Clock, accent: '#6366f1', sub: "Délivrées ce jour" },
          { label: "Hier", value: stats.yesterday, icon: Clock, accent: '#a855f7', sub: "Délivrées la veille" },
          { label: "7 derniers jours", value: stats.week, icon: CheckCircle, accent: '#10b981', sub: "Volume glissant" },
          { label: "Ce mois", value: stats.month, icon: Package, accent: '#f59e0b', sub: "Cumul mensuel" },
          { label: "Année", value: stats.year, icon: Package, accent: '#ec4899', sub: "Cumul annuel" }
        ].map((item, idx) => {
          const Icon = item.icon;
          return (
            <div key={idx} className="card" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>{item.label}</span>
                <Icon size={14} style={{ color: item.accent }} />
              </div>
              <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.sub}</div>
            </div>
          );
        })}
      </div>

      {cardsToday.length > 0 && (
        <div className="card" style={{ padding: 24 }}>
          <h4 style={{ fontSize: 14, fontWeight: 800, color: 'white', marginTop: 0, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Dernières cartes délivrées aujourd'hui ({cardsToday.length})
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {cardsToday.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255, 255, 255, 0.01)', borderRadius: 10, border: '1px solid rgba(255, 255, 255, 0.03)' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'white', textTransform: 'uppercase' }}>{c.noms} {c.prenoms}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Délivrée le {new Date(c.date_delivrance).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
