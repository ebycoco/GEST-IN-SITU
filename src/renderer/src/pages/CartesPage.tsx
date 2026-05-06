import { useEffect, useState, useCallback } from 'react';
import { FixedSizeList as List } from 'react-window';
import { 
  CreditCard, Filter, Plus, Truck, 
  AlertTriangle, RefreshCw, Download, 
  Search, MoreHorizontal, CheckCircle2, 
  Clock, XCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';

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
  const [exporting, setExporting] = useState(false);
  const LIMIT = 200;

  const { user, activeSiteId } = useAuthStore();

  const loadCartes = useCallback(async (off = 0, flt = filters) => {
    setLoading(true);
    try {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const finalFilters = { ...flt };
      if (siteIdToUse) finalFilters.site_id = siteIdToUse.toString();

      const data = await window.api.cartes.getPage(off, LIMIT, finalFilters);
      setCartes(data.rows);
      setTotal(data.total);
      setOffset(off);
    } catch (e) { 
      console.error(e); 
      toast.error("Erreur de chargement");
    } finally { 
      setLoading(false); 
    }
  }, [filters, user, activeSiteId]);

  useEffect(() => { loadCartes(); }, [loadCartes]);

  const handleDeliver = (carte: Carte) => { setSelected(carte); setShowDelivery(true); };

  const handleFilterChange = (key: string, value: string) => {
    const newF = { ...filters, [key]: value };
    if (!value) delete newF[key];
    setFilters(newF);
    loadCartes(0, newF);
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

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const c = cartes[index];
    if (!c) return <div style={style} />;
    
    const isDelivered = ['DELIVRE', 'DISTRIBUEE', 'RETIRE'].includes(c.statut);
    const isCancelled = c.statut === 'ANNULE';

    return (
      <div 
        style={style} 
        className="flex items-center px-6 border-b border-white/5 hover:bg-white/[0.02] transition-colors cursor-pointer group"
        onClick={() => setSelected(c)}
      >
        <div className="w-[60px] text-[10px] font-black text-slate-500 uppercase tracking-widest">{c.id_carte}</div>
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-bold text-white group-hover:text-indigo-400 transition-colors uppercase">{c.noms}</p>
          <p className="text-xs text-slate-400">{c.prenoms}</p>
        </div>
        <div className="w-[140px] text-xs font-mono text-slate-400">{c.num_secu || '—'}</div>
        <div className="w-[120px] text-xs text-slate-400">{c.contact || '—'}</div>
        <div className="w-[100px]">
          <span className="px-2 py-1 rounded-md bg-white/5 border border-white/10 text-[10px] font-black text-indigo-300">
            {c.rangement || '—'}
          </span>
        </div>
        <div className="w-[140px]">
          <span className={`premium-badge ${isDelivered ? 'premium-badge-emerald' : isCancelled ? 'premium-badge-rose' : 'premium-badge-amber'}`}>
            {isDelivered ? <CheckCircle2 size={10} className="mr-1" /> : isCancelled ? <XCircle size={10} className="mr-1" /> : <Clock size={10} className="mr-1" />}
            {c.statut || 'EN STOCK'}
          </span>
        </div>
        <div className="w-[100px] flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isDelivered && !isCancelled && (
            <button 
              className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all" 
              onClick={(e) => { e.stopPropagation(); handleDeliver(c); }}
              title="Distribuer"
            >
              <Truck size={14} />
            </button>
          )}
          {c.statut_physique === 'OK' && !isDelivered && (
            <button 
              className="p-2 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white transition-all" 
              onClick={async (e) => {
                e.stopPropagation();
                await window.api.cartes.signalerAbsence(c.id_carte, 'AGENT');
                toast.success('Absence signalée');
                loadCartes(offset);
              }} 
              title="Signaler absence"
            >
              <AlertTriangle size={14} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="page-content flex flex-col gap-6 custom-scrollbar">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <CreditCard size={24} />
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">Gestion des Cartes CMU</h1>
          </div>
          <p className="text-slate-400 text-sm font-medium ml-1">
            Explorez et gérez l'inventaire des {total.toLocaleString('fr')} cartes enregistrées.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className="premium-button bg-white/5 border-white/5 text-slate-300" onClick={() => loadCartes(offset)}>
            <RefreshCw size={16} className="mr-2" /> Actualiser
          </button>
          <button className="premium-button bg-white/5 border-white/5 text-slate-300" onClick={handleExport} disabled={exporting}>
            <Download size={16} className="mr-2" /> {exporting ? 'Export...' : 'CSV'}
          </button>
          <button className="premium-button">
            <Plus size={16} className="mr-2" /> Nouvelle Carte
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="premium-card p-4 flex flex-wrap items-center gap-4 border-white/5">
        <div className="flex-1 min-w-[240px] relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" size={18} />
          <input 
            className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.08] transition-all"
            placeholder="Rechercher par nom, n° sécu ou rangement..."
            onChange={(e) => {
              // Implementation of debounced search could go here
              handleFilterChange('q', e.target.value);
            }}
          />
        </div>
        
        <div className="flex items-center gap-3">
          <select 
            className="bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:border-indigo-500/50 transition-all appearance-none min-w-[160px]"
            onChange={(e) => handleFilterChange('statut', e.target.value)}
          >
            <option value="" className="bg-slate-900">Tous les Statuts</option>
            <option value="EN STOCK" className="bg-slate-900">En Stock</option>
            <option value="DISTRIBUEE" className="bg-slate-900">Distribuées</option>
            <option value="DELIVRE" className="bg-slate-900">Délivrées</option>
            <option value="ANNULE" className="bg-slate-900">Annulées</option>
          </select>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-slate-400">
            <Filter size={18} />
          </div>
        </div>
      </div>

      {/* Virtualized Table */}
      <div className="premium-card overflow-hidden border-white/5 flex-1 flex flex-col">
        {/* Table Head */}
        <div className="flex items-center px-6 py-4 bg-white/[0.02] border-b border-white/5">
          <div className="w-[60px] text-[10px] font-black text-slate-500 uppercase tracking-widest">ID</div>
          <div className="flex-1 min-w-[200px] text-[10px] font-black text-slate-500 uppercase tracking-widest">Bénéficiaire</div>
          <div className="w-[140px] text-[10px] font-black text-slate-500 uppercase tracking-widest">N° Sécurité</div>
          <div className="w-[120px] text-[10px] font-black text-slate-500 uppercase tracking-widest">Contact</div>
          <div className="w-[100px] text-[10px] font-black text-slate-500 uppercase tracking-widest">Rangement</div>
          <div className="w-[140px] text-[10px] font-black text-slate-500 uppercase tracking-widest">État</div>
          <div className="w-[100px] text-[10px] font-black text-slate-500 uppercase tracking-widest text-right pr-4">Actions</div>
        </div>

        {/* Scrollable Area */}
        <div className="flex-1">
          {loading ? (
            <div className="h-full flex items-center justify-center py-20">
              <RefreshCw className="text-indigo-500 animate-spin" size={32} />
            </div>
          ) : (
            <List 
              height={500} 
              itemCount={cartes.length} 
              itemSize={64} 
              width="100%"
              className="custom-scrollbar"
            >
              {Row}
            </List>
          )}
        </div>

        {/* Footer / Pagination */}
        <div className="px-6 py-4 bg-white/[0.01] border-t border-white/5 flex items-center justify-between">
          <p className="text-xs font-medium text-slate-400">
            Affichage de <span className="text-white font-bold">{offset + 1}</span> à <span className="text-white font-bold">{Math.min(offset + LIMIT, total)}</span> sur <span className="text-indigo-400 font-bold">{total.toLocaleString('fr')}</span> enregistrements
          </p>
          <div className="flex gap-2">
            <button 
              className="premium-button py-2 px-4 text-xs bg-white/5 border-white/5 disabled:opacity-30" 
              disabled={offset === 0} 
              onClick={() => loadCartes(Math.max(0, offset - LIMIT))}
            >
              Précédent
            </button>
            <button 
              className="premium-button py-2 px-4 text-xs bg-white/5 border-white/5 disabled:opacity-30" 
              disabled={offset + LIMIT >= total} 
              onClick={() => loadCartes(offset + LIMIT)}
            >
              Suivant
            </button>
          </div>
        </div>
      </div>

      {/* Delivery Modal */}
      {showDelivery && selected && (
        <DeliveryModal 
          carte={selected} 
          onClose={() => { setShowDelivery(false); setSelected(null); }}
          onSuccess={() => { setShowDelivery(false); setSelected(null); loadCartes(offset); }} 
        />
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
      nom_retirant: nomRetirant.toUpperCase(), 
      num_retirant: numRetirant,
      agent_distributeur: 'AGENT', 
      centre_retrait: centreRetrait
    });
    toast.success(`Distribution validée pour ${nomRetirant}`);
    onSuccess();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="premium-card w-full max-w-md animate-slide-up overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <h3 className="text-lg font-black text-white flex items-center gap-3">
            <Truck className="text-emerald-400" size={20} />
            Distribution de Carte
          </h3>
          <button className="p-2 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-colors" onClick={onClose}>
            <MoreHorizontal size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="p-8 space-y-6">
            <div className="p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10 space-y-1">
              <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Bénéficiaire</p>
              <p className="text-sm font-bold text-white uppercase">{carte.noms} {carte.prenoms}</p>
              <p className="text-xs text-slate-400 italic">Rangement : {carte.rangement || 'Non défini'}</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Nom du Retirant *</label>
                <input 
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.08] transition-all"
                  value={nomRetirant} 
                  onChange={(e) => setNomRetirant(e.target.value)} 
                  placeholder="Saisissez le nom complet..."
                  autoFocus 
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">N° Pièce d'Identité</label>
                <input 
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:border-indigo-500/50 focus:bg-white/[0.08] transition-all"
                  value={numRetirant} 
                  onChange={(e) => setNumRetirant(e.target.value)} 
                  placeholder="Optionnel..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Point de Retrait</label>
                <select 
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-white text-sm focus:outline-none focus:border-indigo-500/50 transition-all appearance-none"
                  value={centreRetrait} 
                  onChange={(e) => setCentreRetrait(e.target.value)}
                >
                  <option value="" className="bg-slate-900">Sélectionner un centre...</option>
                  <option value="CENTRE PRINCIPAL" className="bg-slate-900">Centre Principal</option>
                  <option value="AGENCE NORD" className="bg-slate-900">Agence Nord</option>
                  <option value="AGENCE SUD" className="bg-slate-900">Agence Sud</option>
                </select>
              </div>
            </div>
          </div>

          <div className="p-6 bg-white/[0.02] border-t border-white/5 flex gap-3">
            <button type="button" className="flex-1 premium-button bg-white/5 border-white/5 text-slate-400" onClick={onClose}>Annuler</button>
            <button type="submit" className="flex-[2] premium-button bg-emerald-600 hover:bg-emerald-500 border-none shadow-lg shadow-emerald-600/20">
              Confirmer la Livraison
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
