import React from 'react';
import { Search, RotateCcw, Phone } from 'lucide-react';
import DateInput from '../../../components/DateInput';

interface SearchFormProps {
  searchMode: 'name' | 'contact';
  setSearchMode: (m: 'name' | 'contact') => void;
  nomComplet: string;
  setNomComplet: (v: string) => void;
  ddn: string;
  setDdn: (v: string) => void;
  lieuNaissance: string;
  setLieuNaissance: (v: string) => void;
  contact: string;
  setContact: (v: string) => void;
  searchContactQuery: string;
  setSearchContactQuery: (v: string) => void;
  isSearching: boolean;
  handleSearch: (e: React.FormEvent) => void;
  handleContactSearch: (e: React.FormEvent) => void;
  handleClear: () => void;
  formatPhoneString: (v: string) => string;
  nomInputRef: React.RefObject<HTMLInputElement | null>;
  resultsCount: number;
}

export function SearchForm({
  searchMode,
  setSearchMode,
  nomComplet,
  setNomComplet,
  ddn,
  setDdn,
  lieuNaissance,
  setLieuNaissance,
  contact,
  setContact,
  searchContactQuery,
  setSearchContactQuery,
  isSearching,
  handleSearch,
  handleContactSearch,
  handleClear,
  formatPhoneString,
  nomInputRef,
  resultsCount
}: SearchFormProps) {
  const isRefinementRequired = searchMode === 'name' && resultsCount > 2 && !lieuNaissance.trim() && !contact.trim();

  return (
    <div style={{ maxWidth: 800, margin: '0 auto 40px auto' }}>
      {/* Switcher Mode */}
      <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 14, padding: 4, marginBottom: 24, border: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <button
          onClick={() => setSearchMode('name')}
          style={{
            flex: 1,
            padding: '12px 20px',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 700,
            background: searchMode === 'name' ? 'var(--gradient-button)' : 'transparent',
            color: searchMode === 'name' ? 'white' : 'var(--text-muted)',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          Recherche par État Civil
        </button>
        <button
          onClick={() => setSearchMode('contact')}
          style={{
            flex: 1,
            padding: '12px 20px',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 700,
            background: searchMode === 'contact' ? 'var(--gradient-button)' : 'transparent',
            color: searchMode === 'contact' ? 'white' : 'var(--text-muted)',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          Recherche par Téléphone
        </button>
      </div>

      <div className="card" style={{ padding: 28 }}>
        {searchMode === 'name' ? (
          <form onSubmit={handleSearch} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Nom & Prénoms *</label>
                <input
                  ref={nomInputRef}
                  type="text"
                  placeholder="Ex: KOFFI KOFFI KAN"
                  value={nomComplet}
                  onChange={(e) => setNomComplet(e.target.value.toUpperCase())}
                  className="form-input"
                  style={{ textTransform: 'uppercase' }}
                  required
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Date de Naissance *</label>
                <DateInput
                  value={ddn}
                  onChange={setDdn}
                  placeholder="JJ/MM/AAAA"
                  className="form-input"
                  required
                />
              </div>
            </div>

            {/* Refinement Fields - Show always or when count > 2 */}
            <div style={{
              maxHeight: isRefinementRequired ? 300 : 0,
              opacity: isRefinementRequired ? 1 : 0,
              overflow: 'hidden',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              gap: 20
            }}>
              <div style={{ padding: '16px 20px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13, color: '#f87171', fontWeight: 700 }}>
                  ⚠️ Plusieurs homonymes détectés. Veuillez renseigner le lieu de naissance ou le téléphone pour filtrer.
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Lieu de Naissance</label>
                  <input
                    type="text"
                    placeholder="Ex: ABOBO"
                    value={lieuNaissance}
                    onChange={(e) => setLieuNaissance(e.target.value.toUpperCase())}
                    className="form-input"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Contact Téléphonique</label>
                  <input
                    type="text"
                    placeholder="+225 01 02 03 04 05"
                    value={contact}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '' || val === '+225' || val === '+225 ') {
                        setContact('');
                      } else {
                        setContact(formatPhoneString(val));
                      }
                    }}
                    className="form-input"
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <button
                type="submit"
                disabled={isSearching}
                className="btn btn-primary"
                style={{ flex: 1, padding: '14px 28px', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
              >
                <Search size={18} />
                {isSearching ? 'Recherche en cours...' : 'Rechercher la Carte'}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="btn btn-secondary"
                style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <RotateCcw size={16} />
                Effacer
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleContactSearch} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Numéro de Téléphone Ivoirien *</label>
              <div style={{ position: 'relative' }}>
                <Phone size={18} color="var(--text-muted)" style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)' }} />
                <input
                  type="text"
                  placeholder="+225 01 02 03 04 05"
                  value={searchContactQuery}
                  onChange={(e) => setSearchContactQuery(formatPhoneString(e.target.value))}
                  className="form-input"
                  style={{ paddingLeft: 48 }}
                  required
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              <button
                type="submit"
                disabled={isSearching}
                className="btn btn-primary"
                style={{ flex: 1, padding: '14px 28px', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
              >
                <Search size={18} />
                {isSearching ? 'Recherche en cours...' : 'Rechercher par Téléphone'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSearchContactQuery('+225 ');
                  handleClear();
                }}
                className="btn btn-secondary"
                style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <RotateCcw size={16} />
                Effacer
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
