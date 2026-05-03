import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, CreditCard } from 'lucide-react';

interface Carte { id_carte: number; noms: string; prenoms: string; num_secu: string; contact: string; rangement: string; statut: string; }

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Carte[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(() => {
    if (initialQuery) {
      handleSearch(initialQuery);
    }
  }, [initialQuery]);

  const handleSearch = async (q: string) => {
    if (!q.trim()) { setResults([]); setHasSearched(false); return; }
    setSearching(true);
    setHasSearched(true);
    try {
      const data = await window.api.cartes.search(q, 100);
      setResults(data);
    } catch (e) { console.error(e); }
    finally { setSearching(false); }
  };

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); handleSearch(query); };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Search size={20} color="var(--accent-primary)" />
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Recherche FTS5 (Texte Intégral)</h2>
      </div>

      <div className="card">
        <div className="card-body">
          <form onSubmit={onSubmit} style={{ display: 'flex', gap: 12 }}>
            <input className="form-input" style={{ flex: 1 }} placeholder="Tapez un nom, prénom, n° sécu, contact..."
              value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            <button type="submit" className="btn btn-primary" disabled={searching}>
              <Search size={16} /> {searching ? 'Recherche...' : 'Rechercher'}
            </button>
          </form>
        </div>
      </div>

      {hasSearched && (
        <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="card-header">
            <span className="card-title">{results.length} résultats trouvés {results.length === 100 && '(limité à 100)'}</span>
          </div>
          <div className="card-body" style={{ flex: 1, overflowY: 'auto', padding: 0 }}>
             {results.length === 0 ? (
               <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                 <Search size={40} style={{ opacity: 0.2, margin: '0 auto 12px' }} />
                 <p>Aucun résultat trouvé pour "{query}"</p>
               </div>
             ) : (
               <table className="data-table">
                 <thead>
                   <tr><th>Noms</th><th>Prénoms</th><th>Contact</th><th>N° Sécu</th><th>Rangement</th><th>Statut</th></tr>
                 </thead>
                 <tbody>
                   {results.map((c) => (
                     <tr key={c.id_carte}>
                       <td style={{ fontWeight: 600 }}>{c.noms}</td>
                       <td>{c.prenoms}</td>
                       <td>{c.contact || '—'}</td>
                       <td>{c.num_secu || '—'}</td>
                       <td>{c.rangement || '—'}</td>
                       <td><span className="status-badge stock">{c.statut}</span></td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             )}
          </div>
        </div>
      )}
    </div>
  );
}
