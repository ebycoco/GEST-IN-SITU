import React from 'react';
import { X, Calendar, MapPin, User, Phone, CheckCircle, Clock } from 'lucide-react';

interface DeliveryProofModalProps {
  isOpen: boolean;
  onClose: () => void;
  carte: any;
}

export function DeliveryProofModal({ isOpen, onClose, carte }: DeliveryProofModalProps) {
  if (!isOpen || !carte) return null;

  const formatDateWithTime = (isoDate: string | null) => {
    if (!isoDate) return 'Date inconnue';
    const d = new Date(isoDate);
    const datePart = d.toLocaleDateString('fr-FR');
    const timePart = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    // Handle cases where time might be midnight if only date was saved (rare for datetime fields but possible)
    return `${datePart} à ${timePart}`;
  };

  const retirerName = carte.nom_retirant || 'Non spécifié';
  const retirerContact = carte.num_retirant || carte.contact_retirant || 'Non spécifié';
  const typeRetirant = carte.type_retirant || (retirerName.trim() === `${carte.noms || ''} ${carte.prenoms || ''}`.trim() ? 'ASSURÉ LUI-MÊME' : 'TIERS MANDATÉ');

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20
    }}>
      <div className="card animate-scale-in" style={{
        maxWidth: 550, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        background: 'linear-gradient(145deg, rgba(30, 32, 50, 0.98) 0%, rgba(15, 16, 28, 0.99) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 24, boxShadow: '0 50px 100px rgba(0,0,0,0.9)',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h3 style={{ fontSize: 20, fontWeight: 900, color: 'white', margin: 0 }}>
                Preuve de Retrait
              </h3>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '4px 10px', borderRadius: 20, border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                DÉLIVRÉE
              </span>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
              Carte N° {carte.num_secu || 'non spécifié'}
            </p>
          </div>
          <button onClick={onClose} className="btn-close" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', width: 36, height: 36, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}>
            <X size={16} />
          </button>
        </div>

        {/* Modal Content */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          {/* Bloc 1 : Informations du Retrait (Lieu & Moment) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', margin: 0, letterSpacing: 1 }}>
              Détails de la transaction
            </h4>
            <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 16, padding: 16, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Clock size={16} style={{ color: 'var(--text-muted)', marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Date & Heure exactes</div>
                  <div style={{ fontSize: 14, color: 'white', fontWeight: 800 }}>{formatDateWithTime(carte.date_delivrance)}</div>
                </div>
              </div>
              <div style={{ width: '100%', height: 1, background: 'rgba(255, 255, 255, 0.05)' }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <MapPin size={16} style={{ color: 'var(--text-muted)', marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Centre de distribution</div>
                  <div style={{ fontSize: 14, color: 'white', fontWeight: 800 }}>{carte.centre_retrait || 'Non spécifié'}</div>
                </div>
              </div>
              <div style={{ width: '100%', height: 1, background: 'rgba(255, 255, 255, 0.05)' }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <CheckCircle size={16} style={{ color: 'var(--text-muted)', marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Agent distributeur</div>
                  <div style={{ fontSize: 14, color: 'white', fontWeight: 800 }}>{carte.agent_distributeur || carte.delivre_par || 'Non spécifié'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Bloc 2 : Identité du Retirant (Preuve) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h4 style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', margin: 0, letterSpacing: 1 }}>
              Identité du Retirant
            </h4>
            <div style={{ background: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.1)', borderRadius: 16, padding: 16, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <User size={16} style={{ color: '#38bdf8', marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600, opacity: 0.8 }}>Qualité du Retirant</div>
                  <div style={{ fontSize: 14, color: '#38bdf8', fontWeight: 900 }}>{typeRetirant}</div>
                </div>
              </div>
              <div style={{ width: '100%', height: 1, background: 'rgba(56, 189, 248, 0.1)' }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{ width: 16, display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#38bdf8', marginTop: 6 }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Nom & Prénom</div>
                  <div style={{ fontSize: 14, color: 'white', fontWeight: 800 }}>{retirerName}</div>
                </div>
              </div>
              <div style={{ width: '100%', height: 1, background: 'rgba(56, 189, 248, 0.1)' }} />
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <Phone size={16} style={{ color: 'var(--text-muted)', marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Contact</div>
                  <div style={{ fontSize: 14, color: 'white', fontWeight: 800 }}>{retirerContact}</div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: '20px 24px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.2)' }}>
          <button
            onClick={onClose}
            className="btn btn-secondary"
            style={{ padding: '12px 24px' }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
