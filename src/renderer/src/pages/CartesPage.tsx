import { useEffect, useState, useCallback } from 'react';
import { FixedSizeList as List } from 'react-window';
import { CreditCard, Filter, Plus, Truck, AlertTriangle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

interface Carte {
  id_carte: number; noms: string; prenoms: string; num_secu: string;
  contact: string; rangement: string; statut: string; statut_physique: string;
  date_delivrance: string; agent_saisie: string; centre_retrait: string;
}

export default function CartesPage() {
  const [cartes, setCartes] = useState<Carte[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Carte | null>(null);
  const [showDelivery, setShowDelivery] = useState(false);
  const LIMIT = 200;

  const loadCartes = useCallback(async (off = 0, flt = filters) => {
    setLoading(true);
    try {
      const data = await window.api.cartes.getPage(off, LIMIT, flt);
      setCartes(data.rows);
      setTotal(data.total);
      setOffset(off);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { loadCartes(); }, []);

  const statusClass = (s: string) => {
    if (['DELIVRE', 'DISTRIBUEE', 'RETIRE'].includes(s)) return 'distribue';
    if (s === 'ANNULE') return 'annule';
    return 'stock';
  };

  const handleDeliver = async (carte: Carte) => { setSelected(carte); setShowDelivery(true); };

  const handleFilterChange = (key: string, value: string) => {
    const newF = { ...filters, [key]: value };
    if (!value) delete newF[key];
    setFilters(newF);
    loadCartes(0, newF);
  };

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const c = cartes[index];
    if (!c) return <div style={style} />;
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}
        onClick={() => setSelected(c)}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(108,99,255,0.05)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
        <div style={{ flex: '0 0 60px', fontSize: 12, color: 'var(--text-muted)' }}>{c.id_carte}</div>
        <div style={{ flex: '1 1 180px', fontWeight: 600, fontSize: 13 }}>{c.noms}</div>
        <div style={{ flex: '1 1 160px', fontSize: 13 }}>{c.prenoms}</div>
        <div style={{ flex: '0 0 120px', fontSize: 12, color: 'var(--text-secondary)' }}>{c.num_secu || '—'}</div>
        <div style={{ flex: '0 0 100px', fontSize: 12, color: 'var(--text-secondary)' }}>{c.contact || '—'}</div>
        <div style={{ flex: '0 0 100px', fontSize: 12, color: 'var(--text-secondary)' }}>{c.rangement || '—'}</div>
        <div style={{ flex: '0 0 120px' }}>
          <span className={`status-badge ${statusClass(c.statut)}`}>
            <span className="status-dot" />{c.statut || 'EN STOCK'}
          </span>
        </div>
        <div style={{ flex: '0 0 80px', display: 'flex', gap: 4 }}>
          {c.statut === 'EN STOCK' && (
            <button className="btn btn-sm btn-success" onClick={(e) => { e.stopPropagation(); handleDeliver(c); }} title="Distribuer">
              <Truck size={12} />
            </button>
          )}
          {c.statut_physique === 'OK' && c.statut === 'EN STOCK' && (
            <button className="btn btn-sm btn-warning" onClick={async (e) => {
              e.stopPropagation();
              await window.api.cartes.signalerAbsence(c.id_carte, 'AGENT');
              toast.success('Absence signalée');
              loadCartes(offset);
            }} title="Signaler absence">
              <AlertTriangle size={12} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <CreditCard size={20} color="var(--accent-primary)" />
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Cartes CMU</h2>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '4px 10px', borderRadius: 12 }}>
            {total.toLocaleString('fr')} enregistrements
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => loadCartes(offset)}><RefreshCw size={14} /> Rafraîchir</button>
          <button className="btn btn-primary btn-sm"><Plus size={14} /> Nouvelle carte</button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <select className="form-select" style={{ minWidth: 160 }} onChange={(e) => handleFilterChange('statut', e.target.value)}>
          <option value="">Tous les statuts</option>
          <option value="EN STOCK">En stock</option>
          <option value="DISTRIBUEE">Distribuées</option>
          <option value="DELIVRE">Délivrées</option>
        </select>
        <input className="form-input" placeholder="Filtrer par rangement..." style={{ minWidth: 200 }}
          onChange={(e) => handleFilterChange('rangement', e.target.value)} />
      </div>

      {/* Virtual Table */}
      <div className="card" style={{ flex: 1, overflow: 'hidden' }}>
        {/* Table Header */}
        <div style={{ display: 'flex', padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
          <div style={{ flex: '0 0 60px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>ID</div>
          <div style={{ flex: '1 1 180px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Noms</div>
          <div style={{ flex: '1 1 160px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Prénoms</div>
          <div style={{ flex: '0 0 120px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>N° Sécu</div>
          <div style={{ flex: '0 0 100px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Contact</div>
          <div style={{ flex: '0 0 100px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Rangement</div>
          <div style={{ flex: '0 0 120px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Statut</div>
          <div style={{ flex: '0 0 80px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Actions</div>
        </div>

        {/* Virtual List */}
        <List height={600} itemCount={cartes.length} itemSize={48} width="100%">
          {Row}
        </List>

        {/* Pagination */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Affichage {offset + 1} - {Math.min(offset + LIMIT, total)} sur {total.toLocaleString('fr')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-outline btn-sm" disabled={offset === 0} onClick={() => loadCartes(Math.max(0, offset - LIMIT))}>Précédent</button>
            <button className="btn btn-outline btn-sm" disabled={offset + LIMIT >= total} onClick={() => loadCartes(offset + LIMIT)}>Suivant</button>
          </div>
        </div>
      </div>

      {/* Delivery Modal */}
      {showDelivery && selected && (
        <DeliveryModal carte={selected} onClose={() => { setShowDelivery(false); setSelected(null); }}
          onSuccess={() => { setShowDelivery(false); setSelected(null); loadCartes(offset); }} />
      )}
    </div>
  );
}

function DeliveryModal({ carte, onClose, onSuccess }: { carte: Carte; onClose: () => void; onSuccess: () => void }) {
  const [nomRetirant, setNomRetirant] = useState('');
  const [numRetirant, setNumRetirant] = useState('');
  const [centreRetrait, setCentreRetrait] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomRetirant.trim()) { toast.error('Le nom du retirant est obligatoire'); return; }
    await window.api.cartes.delivrer(carte.id_carte, {
      nom_retirant: nomRetirant.toUpperCase(), num_retirant: numRetirant,
      agent_distributeur: 'AGENT', centre_retrait: centreRetrait
    });
    toast.success(`Carte distribuée à ${nomRetirant}`);
    onSuccess();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal animate-slide-up" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">🚚 Distribution de carte</span>
          <button className="btn btn-icon btn-outline" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 13 }}>
              <strong>{carte.noms} {carte.prenoms}</strong><br />
              <span style={{ color: 'var(--text-muted)' }}>Rangement: {carte.rangement || '—'}</span>
            </div>
            <div className="form-group">
              <label className="form-label">Nom du retirant *</label>
              <input className="form-input" value={nomRetirant} onChange={(e) => setNomRetirant(e.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label className="form-label">N° pièce du retirant</label>
              <input className="form-input" value={numRetirant} onChange={(e) => setNumRetirant(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Centre de retrait</label>
              <select className="form-select" value={centreRetrait} onChange={(e) => setCentreRetrait(e.target.value)}>
                <option value="">Sélectionner...</option>
                <option value="Centre 1">Centre 1</option>
                <option value="Centre 2">Centre 2</option>
                <option value="Centre 3">Centre 3</option>
                <option value="Centre 4">Centre 4</option>
              </select>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn btn-success">Confirmer la distribution</button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface Carte { id_carte: number; noms: string; prenoms: string; num_secu: string; contact: string; rangement: string; statut: string; statut_physique: string; date_delivrance: string; agent_saisie: string; centre_retrait: string; }
