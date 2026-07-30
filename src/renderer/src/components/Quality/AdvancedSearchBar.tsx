import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { QualityFilters } from '../../../../shared/types/quality.types';
import { useQualityUIStore } from '../../stores/qualityUIStore';

interface AdvancedSearchBarProps {
  filters: QualityFilters;
  setFilters: React.Dispatch<React.SetStateAction<QualityFilters>>;
  onSearch?: () => void;
  disabled?: boolean;
}

export function AdvancedSearchBar({ filters, setFilters, disabled = false }: AdvancedSearchBarProps) {
  const [showExtendedFilters, setShowExtendedFilters] = useState(false);
  const openGuide = useQualityUIStore(s => s.openGuide);

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: 14, padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: 12, flex: 1, marginRight: 16
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Search size={18} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="Nom et prénom..."
            value={filters.nom || ''}
            onChange={(e) => setFilters(prev => ({ ...prev, nom: e.target.value.toUpperCase() }))}
            disabled={disabled}
            style={{ flex: 1, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, opacity: disabled ? 0.5 : 1 }}
          />
          <input
            type="text"
            placeholder="Contact..."
            value={filters.contact || ''}
            onChange={(e) => setFilters(prev => ({ ...prev, contact: e.target.value.replace(/\D/g, '') }))}
            disabled={disabled}
            style={{ width: 140, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, opacity: disabled ? 0.5 : 1 }}
          />
          <button onClick={() => setShowExtendedFilters(!showExtendedFilters)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12, padding: '8px 12px', borderRadius: 8 }}>
            {showExtendedFilters ? '▲ Moins de filtres' : '▼ Plus de filtres'}
          </button>
        </div>
        
        {showExtendedFilters && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <input
              type="date"
              value={filters.ddn || ''}
              onChange={(e) => setFilters(prev => ({ ...prev, ddn: e.target.value }))}
              disabled={disabled}
              style={{ width: 180, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, opacity: disabled ? 0.5 : 1 }}
            />
            <input
              type="text"
              placeholder="Lieu de naissance..."
              value={filters.lieu || ''}
              onChange={(e) => setFilters(prev => ({ ...prev, lieu: e.target.value.toUpperCase() }))}
              disabled={disabled}
              style={{ flex: 1, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '8px 12px', borderRadius: 8, color: 'var(--text-primary)', fontSize: 13, opacity: disabled ? 0.5 : 1 }}
            />
            {(filters.nom || filters.contact || filters.ddn || filters.lieu) && (
              <button disabled={disabled} onClick={() => setFilters({ nom: '', contact: '', ddn: '', lieu: '' })} style={{ background: 'none', border: 'none', color: '#f87171', cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 12, padding: '8px 12px', opacity: disabled ? 0.5 : 1 }}>
                Réinitialiser
              </button>
            )}
          </div>
        )}
      </div>
      
      <button onClick={() => openGuide('')}
        style={{ background: 'var(--accent-primary)', color: 'black', border: 'none', borderRadius: 14, padding: '16px 20px', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 700, gap: 8 }}>
        <Search size={24} />
        <span>Assistant Global</span>
      </button>
    </div>
  );
}
