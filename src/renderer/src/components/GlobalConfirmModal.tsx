import React, { useState, useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';
import { confirmService } from './confirmService';

export const GlobalConfirmModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<{ 
    title: string; 
    message: string; 
    isDanger?: boolean;
    requirePassword?: boolean;
    actionName?: string;
  } | null>(null);

  useEffect(() => {
    confirmService.register((opts) => {
      setOptions(opts);
      setPassword('');
      setLoading(false);
      setIsOpen(true);
    });
  }, []);

  if (!isOpen || !options) return null;

  const handleConfirm = async () => {
    if (options.requirePassword) {
      if (!password.trim()) {
        toast.error("Veuillez saisir votre mot de passe.");
        return;
      }
      setLoading(true);
      try {
        const isCorrect = await window.api.hierarchy.verifyPassword(password, options.actionName);
        if (!isCorrect) {
          toast.error("❌ Mot de passe administrateur incorrect.");
          setLoading(false);
          return;
        }
      } catch (err: any) {
        toast.error("Erreur lors de la vérification : " + (err.message || err));
        setLoading(false);
        return;
      }
    }
    setIsOpen(false);
    confirmService.resolve(true);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 110000,
      backgroundColor: 'rgba(5, 7, 12, 0.75)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20
    }}>
      <div className="premium-card premium-glass animate-scale-up" style={{
        maxWidth: 480,
        width: '100%',
        border: options.isDanger ? '1px solid rgba(239, 68, 68, 0.4)' : '1px solid rgba(255, 215, 0, 0.4)',
        boxShadow: options.isDanger ? '0 10px 40px rgba(239, 68, 68, 0.15)' : '0 10px 40px rgba(255, 215, 0, 0.15)',
        borderRadius: 20,
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        gap: 20
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ShieldAlert size={32} color={options.isDanger ? '#ef4444' : '#ffd700'} />
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'white' }}>{options.title}</h3>
        </div>
        
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {options.message}
        </p>

        {options.requirePassword && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
              Mot de passe Administrateur :
            </label>
            <input
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              value={password}
              disabled={loading}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 10,
                padding: '10px 14px',
                color: 'white',
                fontSize: 14,
                fontWeight: 700,
                outline: 'none',
                textAlign: 'center'
              }}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm();
              }}
            />
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            disabled={loading}
            onClick={handleConfirm}
            className={options.isDanger ? 'btn-danger' : 'btn-plein-soleil'}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: 10,
              fontWeight: 700,
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? "Vérification..." : "Confirmer"}
          </button>
          <button
            disabled={loading}
            onClick={() => {
              setIsOpen(false);
              confirmService.resolve(false);
            }}
            className="btn-outline"
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: 10,
              fontWeight: 700,
              border: '1px solid rgba(255, 255, 255, 0.1)',
              background: 'transparent',
              color: 'white',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
};
