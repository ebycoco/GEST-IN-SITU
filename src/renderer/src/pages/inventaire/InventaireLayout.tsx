import React, { useState, useEffect } from 'react';
import { PackageSearch, Boxes, BookOpenCheck } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import InventairePhysiqueScan from './InventairePhysiqueScan';
import InventaireLogistique from './InventaireLogistique';
import InventaireApurement from './InventaireApurement';

type Tab = 'SCAN' | 'LOGISTIQUE' | 'APUREMENT';

export default function InventaireLayout() {
  const [activeTab, setActiveTab] = useState<Tab>('SCAN');

  useEffect(() => {
    // Libère la sidebar et l'interface globale
    useAuthStore.getState().setInitialDataLoading(false);
  }, []);

  return (
    <div className="animate-fade-in" style={{ padding: '20px', maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
      
      {/* Header & Navigation Tabs */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: 'white', marginBottom: 20 }}>INVENTAIRE & LOGISTIQUE</h1>
        
        <div style={{ display: 'flex', gap: 12, background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)' }}>
          <button
            onClick={() => setActiveTab('SCAN')}
            className="hover-scale"
            style={{
              flex: 1,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              border: 'none',
              borderRadius: 12,
              background: activeTab === 'SCAN' ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'transparent',
              color: activeTab === 'SCAN' ? 'white' : 'var(--text-muted)',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: activeTab === 'SCAN' ? '0 4px 12px rgba(16, 185, 129, 0.3)' : 'none'
            }}
          >
            <PackageSearch size={18} />
            INVENTAIRE PAR SCAN
          </button>
          
          <button
            onClick={() => setActiveTab('LOGISTIQUE')}
            className="hover-scale"
            style={{
              flex: 1,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              border: 'none',
              borderRadius: 12,
              background: activeTab === 'LOGISTIQUE' ? 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)' : 'transparent',
              color: activeTab === 'LOGISTIQUE' ? 'white' : 'var(--text-muted)',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: activeTab === 'LOGISTIQUE' ? '0 4px 12px rgba(168, 85, 247, 0.3)' : 'none'
            }}
          >
            <Boxes size={18} />
            CLASSEMENT LOGISTIQUE
          </button>

          <button
            onClick={() => setActiveTab('APUREMENT')}
            className="hover-scale"
            style={{
              flex: 1,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              border: 'none',
              borderRadius: 12,
              background: activeTab === 'APUREMENT' ? 'linear-gradient(135deg, #ec4899 0%, #be185d 100%)' : 'transparent',
              color: activeTab === 'APUREMENT' ? 'white' : 'var(--text-muted)',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: activeTab === 'APUREMENT' ? '0 4px 12px rgba(236, 72, 153, 0.3)' : 'none'
            }}
          >
            <BookOpenCheck size={18} />
            APUREMENT HISTORIQUE
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div style={{ background: 'rgba(255,255,255,0.01)', borderRadius: 20, border: '1px solid rgba(255,255,255,0.02)' }}>
        {activeTab === 'SCAN' && <InventairePhysiqueScan />}
        {activeTab === 'LOGISTIQUE' && <InventaireLogistique />}
        {activeTab === 'APUREMENT' && <InventaireApurement />}
      </div>
    </div>
  );
}
