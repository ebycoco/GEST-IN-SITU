import React, { useState, useRef, useEffect } from 'react';
import { PackageSearch, CheckCircle, AlertTriangle, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';

export default function InventairePhysiqueScan() {
  const { user } = useAuthStore();
  
  const [rangement, setRangement] = useState('');
  const [isRangementLocked, setIsRangementLocked] = useState(false);
  
  const [scanInput, setScanInput] = useState('');
  const [scannedCards, setScannedCards] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  
  const rangementRef = useRef<HTMLInputElement>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  // Focus initial
  useEffect(() => {
    if (!isRangementLocked && rangementRef.current) {
      rangementRef.current.focus();
    } else if (isRangementLocked && scanRef.current) {
      scanRef.current.focus();
    }
  }, [isRangementLocked]);

  const handleLockRangement = (e: React.FormEvent) => {
    e.preventDefault();
    if (rangement.trim().length === 0) {
      toast.error('Veuillez définir un emplacement de rangement cible.');
      return;
    }
    setIsRangementLocked(true);
  };

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const scannnedValue = scanInput.trim().toUpperCase();
    
    if (!scannnedValue) return;
    if (!isRangementLocked) {
      toast.error('Veuillez verrouiller le rangement cible avant de scanner.');
      return;
    }

    try {
      setLoading(true);
      // Appel API pour l'inventaire rapide
      const result = await window.api.cartes.inventairePhysiqueScan(scannnedValue, rangement);
      
      if (result.success) {
        // Ajouter en haut de la liste
        setScannedCards(prev => [{ ...result.carte, success: true }, ...prev].slice(0, 15));
        
        // Jouer un petit son de succès si possible, ou simple toast discret
        toast.success(`Ajouté : ${result.carte.noms}`, { duration: 1000 });
      } else {
        setScannedCards(prev => [{ erreur: result.message || 'Non trouvé', scan: scannnedValue, success: false }, ...prev].slice(0, 15));
        toast.error(`Erreur: ${result.message}`);
      }
    } catch (err: any) {
      toast.error(`Erreur système : ${err.message}`);
      setScannedCards(prev => [{ erreur: err.message, scan: scannnedValue, success: false }, ...prev].slice(0, 15));
    } finally {
      setScanInput('');
      setLoading(false);
      // Redonner le focus immédiatement
      if (scanRef.current) {
        scanRef.current.focus();
      }
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: '24px', maxWidth: 800, margin: '0 auto' }}>
      
      <div className="glass-card" style={{ padding: 32, marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: 'white', marginBottom: 16 }}>1. Définir le Conteneur Cible</h2>
        
        <form onSubmit={handleLockRangement} style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <input
              ref={rangementRef}
              className="form-input"
              style={{ width: '100%', borderRadius: 12, background: isRangementLocked ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: isRangementLocked ? '#10b981' : '#ffd700', height: 48, padding: '0 16px', outline: 'none', textTransform: 'uppercase', fontSize: 18, fontWeight: 800 }}
              type="text"
              placeholder="Ex: BOITE-001"
              value={rangement}
              onChange={e => setRangement(e.target.value.toUpperCase())}
              disabled={isRangementLocked}
            />
          </div>
          
          {!isRangementLocked ? (
            <button
              type="submit"
              className="premium-btn"
              style={{ background: '#ffd700', color: 'black', border: 'none', borderRadius: 12, padding: '0 24px', fontWeight: 800, cursor: 'pointer' }}
            >
              Verrouiller Cible
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsRangementLocked(false)}
              style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: 'none', borderRadius: 12, padding: '0 24px', fontWeight: 800, cursor: 'pointer' }}
            >
              Déverrouiller
            </button>
          )}
        </form>
      </div>

      <div className="glass-card" style={{ padding: 32, opacity: isRangementLocked ? 1 : 0.5, pointerEvents: isRangementLocked ? 'auto' : 'none', transition: 'all 0.3s' }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: 'white', marginBottom: 16 }}>2. Scan à la chaîne</h2>
        
        <form onSubmit={handleScanSubmit} style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          <input
            ref={scanRef}
            className="form-input"
            style={{ flex: 1, borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '2px solid #10b981', color: 'white', height: 54, padding: '0 16px', outline: 'none', fontSize: 20, letterSpacing: '0.05em' }}
            type="text"
            placeholder="Scannez l'identifiant de la carte ici..."
            value={scanInput}
            onChange={e => setScanInput(e.target.value.toUpperCase())}
            disabled={!isRangementLocked || loading}
          />
          <button
            type="submit"
            disabled={!isRangementLocked || loading || !scanInput.trim()}
            style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: 12, padding: '0 24px', fontWeight: 800, cursor: 'pointer' }}
          >
            <ArrowRight size={24} />
          </button>
        </form>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)' }}>SESSION COURANTE : {scannedCards.filter(c => c.success).length} AJOUT(S)</h3>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {scannedCards.map((c, idx) => (
            <div key={idx} style={{ 
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 12, 
              background: c.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              border: `1px solid ${c.success ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
            }}>
              {c.success ? <CheckCircle size={20} color="#10b981" /> : <AlertTriangle size={20} color="#ef4444" />}
              <div style={{ flex: 1 }}>
                {c.success ? (
                  <>
                    <div style={{ fontWeight: 700, color: 'white' }}>{c.noms} {c.prenoms}</div>
                    <div style={{ fontSize: 12, color: '#10b981' }}>N° Sécu: {c.num_secu} | Vers: {c.rangement}</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 700, color: '#ef4444' }}>Échec de scan: {c.scan}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.erreur}</div>
                  </>
                )}
              </div>
            </div>
          ))}
          {scannedCards.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 14 }}>
              Aucune carte scannée pour l'instant.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
