import React from 'react';
import { Activity, Calendar, Clock, Target, CalendarDays } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';
import { useVerificationStats } from '../../VerificationSearchPage/hooks/useVerificationStats';

export default function Overview() {
  const { user } = useAuthStore();
  const { stats } = useVerificationStats(user);

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1000, margin: '0 auto' }}>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
        
        {/* KPI: Jour */}
        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(16, 185, 129, 0.01) 100%)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(16, 185, 129, 0.3)' }}>
            <Activity size={28} />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{stats.today}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Aujourd'hui</div>
          </div>
        </div>

        {/* KPI: Semaine */}
        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px', background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(59, 130, 246, 0.01) 100%)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(59, 130, 246, 0.3)' }}>
            <Calendar size={28} />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{stats.week}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Cette semaine</div>
          </div>
        </div>

        {/* KPI: Mois */}
        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px', background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(139, 92, 246, 0.01) 100%)', border: '1px solid rgba(139, 92, 246, 0.2)', borderRadius: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(139, 92, 246, 0.3)' }}>
            <CalendarDays size={28} />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{stats.month}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Ce mois</div>
          </div>
        </div>

        {/* KPI: Année */}
        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '24px', background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.05) 0%, rgba(245, 158, 11, 0.01) 100%)', border: '1px solid rgba(245, 158, 11, 0.2)', borderRadius: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(245, 158, 11, 0.3)' }}>
            <Target size={28} />
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.1 }}>{stats.year}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>Cette année</div>
          </div>
        </div>

      </div>

    </div>
  );
}
