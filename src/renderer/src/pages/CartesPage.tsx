import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import { 
  CreditCard, Filter, Plus, Truck, 
  AlertTriangle, RefreshCw, Download, 
  Search, MoreHorizontal, CheckCircle2, 
  XCircle, ChevronRight, ChevronLeft, 
  Hash, Phone, MapPin, Package, Info, X, User
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

interface Carte {
  id_carte: number; noms: string; prenoms: string; num_secu: string;
  contact: string; rangement: string; statut: string; statut_physique: string;
  date_delivrance: string; agent_saisie: string; centre_retrait: string;
  nom_retirant?: string; num_retirant?: string; date_retrait?: string;
}

interface Stats {
  total: number;
  en_stock: number;
  distribuees: number;
  absentes: number;
}

// Composant Row mémoïsé pour éviter les re-rendus inutiles dans la liste virtuelle
const MemoRow = React.memo(({ index, style, data }: { index: number; style: React.CSSProperties; data: { cartes: Carte[]; selected: Carte | null; setSelected: (c: Carte) => void; setShowDelivery: (s: boolean) => void; userRole?: string } }) => {
  const { cartes, selected, setSelected, setShowDelivery, userRole } = data;
  const c = cartes[index];
  if (!c) return <div style={style} />;
  
  const isDelivered = ['DELIVRE', 'DISTRIBUEE', 'RETIRE'].includes(c.statut);
  const isCancelled = c.statut === 'ANNULE';
  const isSelected = selected?.id_carte === c.id_carte;

  // Calcul du style des badges en mode capsule d'élite
  const getBadgeStyle = () => {
    if (isDelivered) {
      return {
        background: 'rgba(34, 197, 94, 0.08)',
        border: '1px solid rgba(34, 197, 94, 0.15)',
        color: '#4ade80'
      };
    }
    if (isCancelled) {
      return {
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid rgba(239, 68, 68, 0.15)',
        color: '#f87171'
      };
    }
    return {
      background: 'rgba(59, 130, 246, 0.08)',
      border: '1px solid rgba(59, 130, 246, 0.15)',
      color: '#60a5fa'
    };
  };

  const badgeTheme = getBadgeStyle();

  return (
    <div 
      style={{ 
        ...style, 
        display: 'flex', 
        alignItems: 'center', 
        padding: '0 24px', 
        borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
        cursor: 'pointer',
        background: isSelected ? 'rgba(139, 92, 246, 0.08)' : 'transparent',
        transition: 'all 0.2s ease-in-out'
      }} 
      className="table-row-hover"
      onClick={() => setSelected(c)}
    >
      <div style={{ width: 70, fontSize: 11, fontWeight: 800, color: isSelected ? '#a78bfa' : 'var(--text-muted)', fontFamily: 'monospace', letterSpacing: 0.5 }}>
        #{c.id_carte.toString().padStart(5, '0')}
      </div>
      
      <div style={{ flex: 1, minWidth: 250, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ 
          width: 34, height: 34, borderRadius: 10, 
          background: isSelected ? 'linear-gradient(135deg, #8b5cf6, #3b82f6)' : 'rgba(255,255,255,0.02)', 
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: isSelected ? 'white' : 'var(--text-muted)',
          border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.05)',
          fontSize: 13, fontWeight: 800
        }}>
          {c.noms?.charAt(0) || '?'}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'white', textTransform: 'uppercase', letterSpacing: '0.01em' }}>{c.noms}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.8 }}>{c.prenoms}</div>
        </div>
      </div>

      <div style={{ width: 160, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.85)', fontFamily: 'monospace' }}>
          <Hash size={12} style={{ color: 'var(--text-muted)', opacity: 0.6 }} /> {c.num_secu || '—'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
          <Phone size={11} style={{ opacity: 0.6 }} /> {c.contact || '—'}
        </div>
      </div>

      <div style={{ width: 130 }}>
        <div style={{ 
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 8, 
          background: 'rgba(59, 130, 246, 0.04)', 
          border: '1px solid rgba(59, 130, 246, 0.1)',
          fontSize: 10, fontWeight: 700, color: '#60a5fa',
        }}>
          <MapPin size={10} style={{ opacity: 0.8 }} /> {c.rangement || 'N/A'}
        </div>
      </div>

      <div style={{ width: 150 }}>
        <span 
          style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            gap: 6,
            padding: '5px 12px', 
            borderRadius: 20, 
            fontSize: 10, 
            fontWeight: 700, 
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            ...badgeTheme
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: badgeTheme.color }} />
          {c.statut || 'EN STOCK'}
        </span>
      </div>

      <div style={{ width: 100, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        {!isDelivered && !isCancelled && userRole !== 'OPERATEUR_VERIFICATION' && userRole !== 'OPERATEUR_SAISIE' && (
          <button 
            className="btn-icon" 
            style={{ 
              background: 'rgba(34, 197, 94, 0.1)', 
              color: '#4ade80', 
              borderRadius: 10, 
              width: 32, 
              height: 32,
              border: '1px solid rgba(34, 197, 94, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onClick={(e) => { e.stopPropagation(); setSelected(c); setShowDelivery(true); }}
            title="Distribuer"
          >
            <Truck size={15} />
          </button>
        )}
        <button 
          className="btn-icon" 
          style={{ 
            background: isSelected ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255, 255, 255, 0.02)', 
            color: isSelected ? '#a78bfa' : 'var(--text-muted)', 
            borderRadius: 10, 
            width: 32, 
            height: 32,
            border: isSelected ? '1px solid rgba(139, 92, 246, 0.25)' : '1px solid rgba(255, 255, 255, 0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  const prevData = prevProps.data;
  const nextData = nextProps.data;
  
  if (prevData.cartes[prevProps.index] !== nextData.cartes[nextProps.index]) return false;
  if (prevData.userRole !== nextData.userRole) return false;
  
  const carteId = prevData.cartes[prevProps.index]?.id_carte;
  const wasSelected = prevData.selected?.id_carte === carteId;
  const isSelected = nextData.selected?.id_carte === carteId;
  
  if (wasSelected !== isSelected) return false;
  
  return true;
});

export default function CartesPage() {
  const navigate = useNavigate();
  const [cartes, setCartes] = useState<Carte[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Carte | null>(null);
  const [showDelivery, setShowDelivery] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [centres, setCentres] = useState<any[]>([]);
  const [pageSize, setPageSize] = useState(25);
  const [exporting, setExporting] = useState(false);

  const user = useAuthStore(state => state.user);
  const activeSiteId = useAuthStore(state => state.activeSiteId);
  const listRef = useRef<List>(null);

  const itemData = useMemo(() => ({
    cartes, selected, setSelected, setShowDelivery, userRole: user?.role
  }), [cartes, selected, user?.role]);

  const loadData = useCallback(async (off = 0, flt = filters, currentLimit = pageSize) => {
    setLoading(true);
    try {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const finalFilters = { ...flt };
      if (siteIdToUse) finalFilters.site_id = siteIdToUse.toString();

      // Filtrage automatique par centre_id pour l'ADMIN_CENTRE
      if (user?.role === 'ADMIN_CENTRE' && user?.centre_id) {
        finalFilters.centre_id = user.centre_id.toString();
      }

      const [data, statsData] = await Promise.all([
        window.api.cartes.getPage(off, currentLimit, finalFilters),
        user?.role === 'ADMIN_CENTRE' && user?.centre_id && user?.site_id
          ? window.api.stats.getCentre(user.centre_id, user.site_id)
          : window.api.stats.get(siteIdToUse || undefined)
      ]);
      
      setCartes(data.rows);
      setTotal(data.total);
      setStats(statsData);
      setOffset(off);
      if (listRef.current) listRef.current.scrollTo(0);
    } catch (e) { 
      console.error(e); 
      toast.error("Erreur de chargement");
    } finally { 
      setLoading(false); 
    }
  }, [filters, user, activeSiteId, pageSize]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (user?.role !== 'ADMIN_CENTRE' && user?.role !== 'OPERATEUR_SAISIE') {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      if (siteIdToUse) {
        window.api.hierarchy.getCentres(siteIdToUse)
          .then(data => setCentres(data || []))
          .catch(console.error);
      }
    }
  }, [user, activeSiteId]);

  const handleFilterChange = (key: string, value: string) => {
    const newF = { ...filters, [key]: value };
    if (!value) delete newF[key];
    setFilters(newF);
    setSelected(null);
    loadData(0, newF);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await window.api.export.csv(filters);
      if (result.success) {
        toast.success(`${result.count.toLocaleString('fr')} cartes exportées !`);
      }
    } catch (e) {
      toast.error('Erreur lors de l\'export.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page-content animate-fade-in" style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 24 }}>
      
      {/* Stats Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        <StatsCard 
          label="Total Inventaire" 
          value={total} 
          icon={CreditCard} 
          gradient="linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(139,92,246,0.05) 100%)" 
          borderCol="rgba(139,92,246,0.25)"
          iconColor="#c4b5fd"
          loading={loading}
        />
        <StatsCard 
          label="Disponibles" 
          value={stats?.en_stock || 0} 
          icon={Package} 
          gradient="linear-gradient(135deg, rgba(59,130,246,0.2) 0%, rgba(59,130,246,0.05) 100%)" 
          borderCol="rgba(59,130,246,0.25)"
          iconColor="#93c5fd"
          loading={loading}
        />
        <StatsCard 
          label="Distribuées" 
          value={stats?.distribuees || 0} 
          icon={Truck} 
          gradient="linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(34,197,94,0.04) 100%)" 
          borderCol="rgba(34,197,94,0.2)"
          iconColor="#86efac"
          loading={loading}
        />
        <StatsCard 
          label="Anomalies / Absent" 
          value={stats?.absentes || 0} 
          icon={AlertTriangle} 
          gradient="linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(239,68,68,0.04) 100%)" 
          borderCol="rgba(239,68,68,0.18)"
          iconColor="#fca5a5"
          loading={loading}
        />
      </div>

      {/* Header & Main Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 900, color: 'white', letterSpacing: '-0.04em', margin: 0 }}>Cartes CMU</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, fontWeight: 500, marginTop: 4 }}>
            Gestion de l'inventaire et suivi des distributions locales.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button 
            className="btn btn-outline" 
            style={{ 
              borderRadius: 12, width: 42, height: 42, padding: 0, justifyContent: 'center',
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)'
            }} 
            onClick={() => loadData(offset)}
            title="Rafraîchir"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          {(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE') && (
            <button 
              className="btn btn-outline" 
              style={{ 
                borderRadius: 12, padding: '0 18px', height: 42,
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                display: 'flex', alignItems: 'center', gap: 8
              }} 
              onClick={() => navigate('/export')} 
            >
              <Download size={15} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>Exportation de Données</span>
            </button>
          )}
          {(user?.role === 'SUPER ADMIN' || user?.role === 'ADMINISTRATEUR_SITE') && (
            <button 
              className="btn" 
              onClick={() => navigate('/agent-saisie/nouvelle')}
              style={{ 
                borderRadius: 12, padding: '0 20px', height: 42, 
                background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
                color: 'white', border: 'none', fontWeight: 700, fontSize: 13,
                boxShadow: '0 4px 20px rgba(139, 92, 246, 0.25)',
                display: 'flex', alignItems: 'center', gap: 8,
                cursor: 'pointer'
              }}
            >
              <Plus size={16} />
              <span>Nouvelle Carte</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters Area */}
      <div 
        style={{ 
          padding: 10, 
          borderRadius: 16, 
          display: 'flex', 
          gap: 12, 
          alignItems: 'center', 
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
          backdropFilter: 'blur(10px)'
        }}
      >
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={16} style={{ position: 'absolute', left: 16, color: 'var(--text-muted)', opacity: 0.6 }} />
          <input 
            className="form-input" 
            style={{ 
              width: '100%', paddingLeft: 44, borderRadius: 12, 
              background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.02)', 
              height: 40, fontSize: 13, transition: 'border-color 0.2s ease-in-out'
            }}
            placeholder="Rechercher par nom, n° sécu, contact..."
            value={filters.q || ''}
            onChange={(e) => handleFilterChange('q', e.target.value)}
          />
        </div>
        
        <select 
          className="form-select" 
          style={{ 
            borderRadius: 12, minWidth: 180, 
            background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.02)', 
            height: 40, cursor: 'pointer', fontSize: 13, padding: '0 12px'
          }}
          value={filters.statut || ''}
          onChange={(e) => handleFilterChange('statut', e.target.value)}
        >
          <option value="">Tous les Statuts</option>
          <option value="EN STOCK">📦 En Stock</option>
          <option value="DELIVRE">✅ Distribuées</option>
          <option value="ANNULE">⚠️ Annulées</option>
        </select>

        <button 
          className={`btn btn-outline ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
          style={{ 
            borderRadius: 12, width: 40, height: 40, padding: 0, justifyContent: 'center',
            background: showFilters ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255,255,255,0.02)', 
            border: showFilters ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(255,255,255,0.05)',
            color: showFilters ? '#a78bfa' : 'inherit'
          }}
        >
          <Filter size={16} />
        </button>
      </div>

      {showFilters && (
        <div className="animate-fade-in" style={{ 
          padding: 16, borderRadius: 16, display: 'flex', gap: 16, alignItems: 'center', 
          background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)',
          backdropFilter: 'blur(10px)'
        }}>
          <div className="form-group" style={{ flex: 1, margin: 0 }}>
            <label className="form-label" style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Filtre par Rangement</label>
            <input 
              className="form-input" 
              style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.03)', height: 38 }}
              placeholder="Ex: BOX-A1"
              value={filters.rangement || ''}
              onChange={(e) => handleFilterChange('rangement', e.target.value)}
            />
          </div>
          
          {user?.role !== 'ADMIN_CENTRE' && user?.role !== 'OPERATEUR_SAISIE' && (
            <div className="form-group" style={{ flex: 1, margin: 0 }}>
              <label className="form-label" style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Filtre par Centre</label>
              <select 
                className="form-select" 
                style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.03)', height: 38, color: 'white' }}
                value={filters.centre_id || ''}
                onChange={(e) => handleFilterChange('centre_id', e.target.value)}
              >
                <option value="" style={{ background: '#1e293b' }}>Tous les centres</option>
                {centres.map((c: any) => (
                  <option key={c.id} value={c.id} style={{ background: '#1e293b' }}>{c.nom}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Main Content Table */}
      <div style={{ flex: 1, display: 'flex', gap: 24 }}>
        <div className="table-responsive-wrapper" style={{ overflowX: 'auto', overflowY: 'hidden', width: '100%', borderRadius: 20, border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ minWidth: 1000, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
            {/* Header Column */}
            <div style={{ 
              display: 'flex', alignItems: 'center', padding: '14px 24px', 
              background: 'rgba(255,255,255,0.01)', 
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              flexShrink: 0
            }}>
              <div style={{ width: 70, fontSize: 11, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>ID</div>
              <div style={{ flex: 1, minWidth: 250, fontSize: 11, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Bénéficiaire</div>
              <div style={{ width: 160, fontSize: 11, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Identification</div>
              <div style={{ width: 130, fontSize: 11, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Rangement</div>
              <div style={{ width: 150, fontSize: 11, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Statut</div>
              <div style={{ width: 100, textAlign: 'right', fontSize: 11, fontWeight: 900, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Actions</div>
            </div>

            {/* Scrollable List */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {loading && !cartes.length ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 80 }}>
                  <div className="premium-glass" style={{ padding: 20, borderRadius: '50%', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.15)' }}>
                    <RefreshCw size={36} className="animate-spin" style={{ color: '#a78bfa' }} />
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}>Chargement de la base...</p>
                </div>
              ) : cartes.length === 0 ? (
                <div className="empty-state-container" style={{ padding: '80px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ 
                    width: 80, height: 80, borderRadius: '50%', 
                    background: 'rgba(255, 255, 255, 0.01)', 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: 20,
                    border: '1px solid rgba(255, 255, 255, 0.04)'
                  }}>
                    <Search size={32} style={{ color: '#a78bfa', opacity: 0.6 }} />
                  </div>
                  <h3 style={{ color: 'white', fontSize: 18, fontWeight: 800, marginBottom: 6, letterSpacing: '-0.3px' }}>Aucun résultat trouvé</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24, maxWidth: 320, textAlign: 'center', lineHeight: 1.5 }}>
                    Désolé, aucune carte ne correspond à vos critères de recherche actuels.
                  </p>
                  <button 
                    className="btn btn-outline" 
                    style={{ borderRadius: 12, padding: '0 20px', height: 40, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }} 
                    onClick={() => { setFilters({}); loadData(0, {}); }}
                  >
                    <RefreshCw size={14} />
                    <span>Réinitialiser</span>
                  </button>
                </div>
              ) : (
                <List 
                  ref={listRef}
                  key={`${filters.statut || ''}-${filters.q || ''}-${cartes.length}`}
                  height={550} 
                  itemCount={cartes.length} 
                  itemSize={68} 
                  width="100%"
                  className="custom-scrollbar"
                  itemData={itemData}
                >
                  {MemoRow}
                </List>
              )}
            </div>

            {/* Footer Pagination */}
            {total > 0 && (
              <div 
                style={{ 
                  padding: '14px 24px', 
                  background: 'rgba(0,0,0,0.1)', 
                  borderTop: '1px solid rgba(255,255,255,0.04)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  fontSize: 13
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ color: 'var(--text-muted)' }}>
                    Affichage de <span style={{ color: 'white', fontWeight: 600 }}>{offset + 1}</span> à <span style={{ color: 'white', fontWeight: 600 }}>{Math.min(offset + pageSize, total)}</span> sur <span style={{ color: '#a78bfa', fontWeight: 800 }}>{total.toLocaleString('fr')}</span>
                  </div>
                  
                  {/* Sélecteur de nombre de lignes */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Lignes par page :</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        const newSize = Number(e.target.value);
                        setPageSize(newSize);
                        loadData(0, filters, newSize);
                      }}
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 8,
                        color: 'white',
                        padding: '4px 8px',
                        fontSize: 12,
                        cursor: 'pointer',
                        outline: 'none'
                      }}
                    >
                      <option value={25} style={{ background: '#1e293b' }}>25</option>
                      <option value={50} style={{ background: '#1e293b' }}>50</option>
                      <option value={100} style={{ background: '#1e293b' }}>100</option>
                      <option value={200} style={{ background: '#1e293b' }}>200</option>
                    </select>
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: 8 }}>
                  <button 
                    className="btn btn-secondary btn-sm" 
                    disabled={offset === 0}
                    onClick={() => loadData(offset - pageSize)}
                    style={{ 
                      width: 34, height: 34, padding: 0, borderRadius: 10, justifyContent: 'center',
                      display: 'flex', alignItems: 'center', opacity: offset === 0 ? 0.4 : 1, transition: 'all 0.2s'
                    }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button 
                    className="btn btn-secondary btn-sm" 
                    disabled={offset + pageSize >= total}
                    onClick={() => loadData(offset + pageSize)}
                    style={{ 
                      width: 34, height: 34, padding: 0, borderRadius: 10, justifyContent: 'center',
                      display: 'flex', alignItems: 'center', opacity: offset + pageSize >= total ? 0.4 : 1, transition: 'all 0.2s'
                    }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Side Details Pane */}
        {selected && (
          <div className="premium-glass animate-slide-up" style={{ 
            width: 380, borderRadius: 20, display: 'flex', flexDirection: 'column', 
            border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(0,0,0,0.3)', background: 'rgba(255,255,255,0.01)',
            backdropFilter: 'blur(20px)'
          }}>
            <div style={{ padding: 20, borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139,92,246,0.08)', color: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Info size={18} />
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'white', margin: 0 }}>Détails Carte</h3>
              </div>
              <button style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 4 }} onClick={() => setSelected(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ 
                  width: 72, height: 72, borderRadius: 20, 
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)', 
                  margin: '0 auto 12px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 8px 24px rgba(139,92,246,0.25)',
                  fontSize: 28, fontWeight: 900, color: 'white'
                }}>
                  {selected.noms.charAt(0)}
                </div>
                <h2 style={{ fontSize: 18, fontWeight: 800, color: 'white', textTransform: 'uppercase', margin: 0, letterSpacing: '0.02em' }}>{selected.noms}</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>{selected.prenoms}</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <DetailRow label="N° Sécurité" value={selected.num_secu} icon={Hash} />
                <DetailRow label="Contact" value={selected.contact} icon={Phone} />
                <DetailRow label="Rangement" value={selected.rangement} icon={MapPin} />
                <DetailRow label="Statut" value={selected.statut} icon={Truck} isStatus />
              </div>

              {['DELIVRE', 'DISTRIBUEE', 'RETIRE'].includes(selected.statut) && (
                <div style={{ 
                  marginTop: 4, padding: 16, borderRadius: 16, 
                  background: 'rgba(34, 197, 94, 0.03)', 
                  border: '1px solid rgba(34, 197, 94, 0.08)',
                  display: 'flex', flexDirection: 'column', gap: 10
                }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#4ade80', textTransform: 'uppercase', letterSpacing: 1 }}>Historique Retrait</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Retirant:</span>
                      <span style={{ fontWeight: 600, color: 'white' }}>{selected.nom_retirant || '—'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Pièce:</span>
                      <span style={{ fontWeight: 600, color: 'white' }}>{selected.num_retirant || '—'}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Le:</span>
                      <span style={{ fontWeight: 600, color: 'white' }}>{selected.date_delivrance ? new Date(selected.date_delivrance).toLocaleDateString('fr') : '—'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: 20, borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: 10 }}>
               {!['DELIVRE', 'DISTRIBUEE', 'RETIRE'].includes(selected.statut) && user?.role !== 'OPERATEUR_SAISIE' && (
                <button 
                  className="btn btn-primary" 
                  style={{ 
                    flex: 1, borderRadius: 12, height: 42,
                    background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
                    border: 'none', color: 'white', fontWeight: 700, fontSize: 13,
                    boxShadow: '0 4px 15px rgba(139,92,246,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    cursor: 'pointer'
                  }} 
                  onClick={() => setShowDelivery(true)}
                >
                  <Truck size={15} /> Transférer la carte
                </button>
              )}
              <button 
                className="btn btn-outline" 
                style={{ 
                  borderRadius: 12, width: 42, height: 42, padding: 0, justifyContent: 'center',
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                  display: 'flex', alignItems: 'center', color: 'var(--text-muted)'
                }}
              >
                <MoreHorizontal size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Delivery Modal */}
      {showDelivery && selected && (
        <TransferModal 
          carte={selected} 
          onClose={() => setShowDelivery(false)}
          onSuccess={() => {
            setShowDelivery(false);
            setSelected(null);
            loadData(offset, filters, pageSize);
          }}
        />
      )}
    </div>
  );
}

function StatsCard({ label, value, icon: Icon, gradient, borderCol, iconColor, loading }: any) {
  return (
    <div 
      className="glass-card" 
      style={{ 
        padding: '16px 20px', 
        display: 'flex', 
        alignItems: 'center', 
        gap: 14,
        background: gradient,
        border: `1px solid ${borderCol}`,
        borderRadius: 16,
        backdropFilter: 'blur(10px)'
      }}
    >
      <div style={{ 
        width: 40, height: 40, borderRadius: 12, 
        background: 'rgba(255,255,255,0.02)', 
        border: '1px solid rgba(255,255,255,0.04)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        color: iconColor
      }}>
        <Icon size={20} />
      </div>
      <div>
        {loading ? (
          <div className="skeleton" style={{ width: 50, height: 20, marginBottom: 4 }} />
        ) : (
          <div style={{ fontSize: 20, fontWeight: 900, color: 'white', lineHeight: 1 }}>{value.toLocaleString('fr')}</div>
        )}
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>{label}</div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, icon: Icon, isStatus }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <Icon size={14} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
        {isStatus ? (
          <div style={{ marginTop: 4 }}>
             <span 
               style={{ 
                 display: 'inline-flex', alignItems: 'center', gap: 5,
                 padding: '4px 10px', borderRadius: 12, fontSize: 9, fontWeight: 700,
                 background: value === 'EN STOCK' ? 'rgba(59, 130, 246, 0.08)' : value === 'ANNULE' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(34, 197, 94, 0.08)',
                 color: value === 'EN STOCK' ? '#60a5fa' : value === 'ANNULE' ? '#f87171' : '#4ade80',
                 border: value === 'EN STOCK' ? '1px solid rgba(59, 130, 246, 0.15)' : value === 'ANNULE' ? '1px solid rgba(239, 68, 68, 0.15)' : '1px solid rgba(34, 197, 94, 0.15)'
               }}
             >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor' }} />
              {value || 'EN STOCK'}
            </span>
          </div>
        ) : (
          <div style={{ fontSize: 13, fontWeight: 600, color: 'white', marginTop: 1 }}>{value || '—'}</div>
        )}
      </div>
    </div>
  );
}

function TransferModal({ carte, onClose, onSuccess }: { carte: Carte; onClose: () => void; onSuccess: () => void }) {
  const [centreRetrait, setCentreRetrait] = useState('');
  const [rangementUrgence, setRangementUrgence] = useState('');
  const [loading, setLoading] = useState(false);
  const [centres, setCentres] = useState<any[]>([]);
  const user = useAuthStore(state => state.user);

  useEffect(() => {
    if (user?.site_id) {
      window.api.hierarchy.getCentres(user.site_id)
        .then(data => setCentres(data || []))
        .catch(console.error);
    }
  }, [user?.site_id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!centreRetrait) { toast.error('Veuillez sélectionner un centre de destination'); return; }
    
    if (!navigator.onLine) {
      toast.error("Cette action requiert une connexion internet active afin de synchroniser immédiatement le transfert avec le cloud.", { duration: 5000 });
      return;
    }

    setLoading(true);
    try {
      const selectedCentre = centres.find(c => c.nom === centreRetrait || c.id === Number(centreRetrait));
      const centreId = selectedCentre ? selectedCentre.id : Number(centreRetrait);

      if (!centreId) {
        toast.error('Centre invalide.');
        return;
      }

      await window.api.cartes.transferer(carte.id_carte, {
        centre_id: centreId,
        rangement: rangementUrgence,
        agent_transfert: user?.login || 'AGENT'
      });
      
      const centreName = selectedCentre?.nom || centreRetrait;
      toast.success(`Transfert réussi ! Veuillez informer le centre de destination ${centreName} d'effectuer une récupération des cartes depuis le cloud pour voir la carte et pouvoir la délivrer.`, { duration: 8000 });
      onSuccess();
    } catch (e) {
      toast.error("Erreur lors du transfert.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 2000 }}>
      <div className="premium-glass animate-slide-up" style={{ 
        width: '100%', maxWidth: 500, 
        borderRadius: 24, overflow: 'hidden', 
        padding: 0, border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
        background: 'rgba(255,255,255,0.01)',
        backdropFilter: 'blur(20px)'
      }} onClick={(e) => e.stopPropagation()}>
        
        <div style={{ padding: '24px 28px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(139, 92, 246, 0.1)', color: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Truck size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: 18, fontWeight: 800, color: 'white', margin: 0 }}>Transfert de Carte</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 0' }}>Assigner la carte à un autre guichet/centre.</p>
            </div>
          </div>
          <button type="button" style={{ background: 'rgba(255,255,255,0.02)', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 6, borderRadius: 10, display: 'flex' }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} style={{ padding: 28 }}>
          <div style={{ background: 'rgba(139, 92, 246, 0.03)', border: '1px solid rgba(139, 92, 246, 0.1)', borderRadius: 16, padding: 18, marginBottom: 24, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ 
              width: 48, height: 48, borderRadius: '50%', 
              background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', 
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 900, color: 'white'
            }}>
              {carte.noms.charAt(0)}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>Bénéficiaire</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: 'white', textTransform: 'uppercase' }}>{carte.noms} {carte.prenoms}</div>
              <div style={{ display: 'flex', gap: 14, marginTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  <Hash size={10} /> {carte.num_secu || '—'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="form-label" style={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Centre de Destination *</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <MapPin size={16} style={{ position: 'absolute', left: 14, color: 'var(--text-muted)', opacity: 0.6 }} />
                <select 
                  className="form-select" 
                  style={{ width: '100%', paddingLeft: 42, borderRadius: 12, background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.02)', height: 44, fontSize: 13, appearance: 'none', color: 'white' }}
                  value={centreRetrait} 
                  onChange={(e) => setCentreRetrait(e.target.value)}
                  required
                >
                  <option value="" style={{ background: '#1e293b' }}>Sélectionner un centre/guichet...</option>
                  {centres.map((c: any) => (
                    <option key={c.id} value={c.id} style={{ background: '#1e293b' }}>{c.nom}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="form-label" style={{ textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Nouveau Rangement (Optionnel)</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Info size={16} style={{ position: 'absolute', left: 14, color: 'var(--text-muted)', opacity: 0.6 }} />
                <input 
                  className="form-input" 
                  style={{ width: '100%', paddingLeft: 42, borderRadius: 12, background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.02)', height: 44, fontSize: 13, color: 'white' }}
                  value={rangementUrgence} 
                  onChange={(e) => setRangementUrgence(e.target.value)} 
                  placeholder="Ex: BOX-5 (Laissez vide pour conserver l'actuel)"
                />
              </div>
            </div>
          </div>

          <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
            <button type="button" className="btn btn-outline" style={{ flex: 1, borderRadius: 12, height: 44, fontSize: 13 }} onClick={onClose}>Annuler</button>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={loading}
              style={{ 
                flex: 2, borderRadius: 12, height: 44, justifyContent: 'center', 
                boxShadow: '0 4px 15px rgba(139, 92, 246, 0.2)', background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                border: 'none', color: 'white', fontWeight: 800, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'
              }}
            >
              {loading ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              <span>Transférer la carte</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
