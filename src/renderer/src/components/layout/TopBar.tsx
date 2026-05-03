import { Bell, Search, Settings, Minus, Square, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function TopBar() {
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <h1 className="topbar-title">GEST-IN-SITU</h1>
      </div>

      <form className="topbar-search" onSubmit={handleSearch}>
        <Search size={16} color="var(--text-muted)" />
        <input type="text" placeholder="Rechercher une carte (nom, n° sécu, contact...)"
          value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
      </form>

      <div className="topbar-right">
        <button className="topbar-icon-btn" title="Notifications">
          <Bell size={16} />
          <span className="badge">3</span>
        </button>
        <button className="topbar-icon-btn" title="Paramètres" onClick={() => navigate('/profile')}>
          <Settings size={16} />
        </button>
        
        {/* Espace réservé pour les boutons natifs de Windows (Window Controls Overlay) */}
        <div style={{ width: 140, WebkitAppRegion: 'drag' as any }} />
      </div>
    </header>
  );
}
