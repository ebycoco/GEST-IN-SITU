import React from 'react';

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: any;
  color: string;
  sub?: string;
}

export function KpiCard({ label, value, icon: Icon, color, sub }: KpiCardProps) {
  return (
    <div className="card" style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)' }}>{label}</span>
        <div style={{ 
          width: 36, 
          height: 36, 
          borderRadius: 12, 
          background: `${color}12`, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center' 
        }}>
          <Icon size={18} style={{ color }} />
        </div>
      </div>
      <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}
