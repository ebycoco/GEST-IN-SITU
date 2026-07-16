import React, { useState } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { ResolusTab } from '../../VerificationSearchPage/components/ResolusTab';
import { NonResolusTab } from '../../VerificationSearchPage/components/NonResolusTab';

export default function SignalementsView() {
  const [activeTab, setActiveTab] = useState<'NON_RESOLUS' | 'RESOLUS'>('NON_RESOLUS');

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200, margin: '0 auto' }}>
      
      {/* TABS pour les signalements */}
      <div style={{ display: 'flex', gap: 12, borderBottom: '1px solid var(--border-color)', paddingBottom: 16 }}>
        <button
          onClick={() => setActiveTab('NON_RESOLUS')}
          style={{
            padding: '12px 24px',
            borderRadius: 12,
            background: activeTab === 'NON_RESOLUS' ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
            color: activeTab === 'NON_RESOLUS' ? '#ef4444' : 'var(--text-secondary)',
            border: `1px solid ${activeTab === 'NON_RESOLUS' ? 'rgba(239, 68, 68, 0.3)' : 'transparent'}`,
            fontWeight: activeTab === 'NON_RESOLUS' ? 800 : 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: 8
          }}
        >
          <AlertTriangle size={18} />
          Signalements Non Résolus
        </button>
        <button
          onClick={() => setActiveTab('RESOLUS')}
          style={{
            padding: '12px 24px',
            borderRadius: 12,
            background: activeTab === 'RESOLUS' ? 'rgba(39, 174, 96, 0.1)' : 'transparent',
            color: activeTab === 'RESOLUS' ? '#27ae60' : 'var(--text-secondary)',
            border: `1px solid ${activeTab === 'RESOLUS' ? 'rgba(39, 174, 96, 0.3)' : 'transparent'}`,
            fontWeight: activeTab === 'RESOLUS' ? 800 : 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: 8
          }}
        >
          <CheckCircle size={18} />
          Historique Résolus
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        {activeTab === 'NON_RESOLUS' && <NonResolusTab />}
        {activeTab === 'RESOLUS' && <ResolusTab />}
      </div>
    </div>
  );
}
