import React, { useState } from 'react';
import { X, CheckCircle, Package, ArrowRight, ShieldCheck, AlertTriangle, Loader, MessageSquare } from 'lucide-react';


interface DeliveryModalProps {
  showReportModal: boolean;
  modalStep: number;
  setModalStep: (s: number) => void;
  selectedCarte: any;
  nomRetirant: string;
  setNomRetirant: (v: string) => void;
  telRetirant: string;
  setTelRetirant: (v: string) => void;
  retirantType: string;
  setRetirantType: (v: string) => void;
  emergencyRangement: string;
  setEmergencyRangement: (v: string) => void;
  isFinalizing: boolean;
  resetModal: () => void;
  handleDeliver: () => Promise<void>;
  handleSignalerAbsence: (c: any, commentaire: string) => Promise<void>;
  isUnclassifiedCard: (c: any) => boolean;
}

export function DeliveryModal({
  showReportModal,
  modalStep,
  setModalStep,
  selectedCarte,
  nomRetirant,
  setNomRetirant,
  telRetirant,
  setTelRetirant,
  retirantType,
  setRetirantType,
  emergencyRangement,
  setEmergencyRangement,
  isFinalizing,
  resetModal,
  handleDeliver,
  handleSignalerAbsence,
  isUnclassifiedCard
}: DeliveryModalProps) {
  const [absenceComment, setAbsenceComment] = useState('');

  if (!showReportModal || !selectedCarte) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 999, padding: 20
    }}>
      <div className="card animate-scale-in" style={{
        maxWidth: 600, width: '100%',
        background: 'linear-gradient(145deg, rgba(30, 32, 50, 0.98) 0%, rgba(15, 16, 28, 0.99) 100%)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 24, boxShadow: '0 50px 100px rgba(0,0,0,0.9)',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{ padding: '24px 32px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: 20, fontWeight: 900, color: 'white', margin: 0 }}>
              {modalStep === 1 ? 'Vérification Physique' : modalStep === 2 ? 'Validation du Retrait' : 'Signalement d\'Absence'}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
              Carte CMU n° {selectedCarte.num_secu || 'non spécifié'}
            </p>
          </div>
          <button onClick={resetModal} className="btn-close" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', width: 36, height: 36, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}>
            <X size={16} />
          </button>
        </div>

        {/* Modal Content */}
        <div style={{ padding: '32px' }}>
          {modalStep === 1 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
              {/* Card Summary Card */}
              <div style={{ padding: 20, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: 'white', textTransform: 'uppercase', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <span>{selectedCarte.noms}</span>
                  <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>{selectedCarte.prenoms}</span>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                  <Package size={14} />
                  <span>Emplacement de rangement :</span>
                  <span style={{ color: '#fbbf24', fontWeight: 800, background: 'rgba(251, 191, 36, 0.1)', padding: '2px 8px', borderRadius: 4 }}>
                    {selectedCarte.rangement || 'NON CLASSÉ'}
                  </span>
                </div>

                {/* Additional Info Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginTop: 8, paddingTop: 16, borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Num Sécu</span>
                    <span style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>{selectedCarte.num_secu || '-'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Contact</span>
                    <span style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>{selectedCarte.contact || '-'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Date de Naissance</span>
                    <span style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>
                      {selectedCarte.date_naissance ? new Date(selectedCarte.date_naissance).toLocaleDateString('fr-FR') : '-'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Lieu de Naissance</span>
                    <span style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>{selectedCarte.lieu_naissance || '-'}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, gridColumn: '1 / -1' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Lieu d'enrôlement</span>
                    <span style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>{selectedCarte.lieu_enrolement || '-'}</span>
                  </div>
                </div>
              </div>

              {/* Action Question */}
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: 16, fontWeight: 700, color: 'white', margin: '0 0 8px 0' }}>
                  Avez-vous trouvé la carte physiquement dans le rangement ?
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                  Vérifiez le numéro CMU ou l'état civil de l'assuré avant de valider.
                </p>
              </div>

              {/* Choice Buttons */}
              <div style={{ display: 'flex', gap: 16 }}>
                <button
                  onClick={() => setModalStep(2)}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '16px 28px', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                >
                  <CheckCircle size={18} />
                  Oui, j'ai la carte
                </button>
                <button
                  onClick={() => setModalStep(3)}
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: '16px 28px', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, borderColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', background: 'rgba(239, 68, 68, 0.02)' }}
                >
                  <AlertTriangle size={18} />
                  Non, absente
                </button>
              </div>
            </div>
          ) : modalStep === 2 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Type of Deliverer */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Bénéficiaire du retrait</label>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => setRetirantType('lui-meme')}
                    style={{
                      flex: 1, padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700,
                      background: retirantType === 'lui-meme' ? 'rgba(79, 70, 229, 0.15)' : 'rgba(255,255,255,0.02)',
                      color: retirantType === 'lui-meme' ? 'white' : 'var(--text-muted)',
                      border: retirantType === 'lui-meme' ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.06)',
                      cursor: 'pointer', transition: 'all 0.2s ease'
                    }}
                  >
                    L'assuré lui-même
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetirantType('tiers')}
                    style={{
                      flex: 1, padding: 12, borderRadius: 10, fontSize: 13, fontWeight: 700,
                      background: retirantType === 'tiers' ? 'rgba(79, 70, 229, 0.15)' : 'rgba(255,255,255,0.02)',
                      color: retirantType === 'tiers' ? 'white' : 'var(--text-muted)',
                      border: retirantType === 'tiers' ? '1px solid var(--accent-primary)' : '1px solid rgba(255,255,255,0.06)',
                      cursor: 'pointer', transition: 'all 0.2s ease'
                    }}
                  >
                    Un tiers (Mandataire)
                  </button>
                </div>
              </div>

              {/* Informative fields */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Nom complet du retirant *</label>
                  <input
                    type="text"
                    placeholder="NOM ET PRÉNOMS"
                    value={nomRetirant}
                    onChange={(e) => setNomRetirant(e.target.value.toUpperCase())}
                    className="form-input"
                    style={{ textTransform: 'uppercase' }}
                    required
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Contact téléphonique *</label>
                  <input
                    type="text"
                    placeholder="+225 01 02 03 04 05"
                    value={telRetirant}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '' || val === '+225' || val === '+225 ') {
                        setTelRetirant('');
                      } else {
                        // Phone formatter logic
                        let input = val;
                        if (!input.startsWith('+225 ')) input = '+225 ';
                        const localPart = input.slice(5);
                        const digitsOnly = localPart.replace(/\D/g, '');
                        const truncatedDigits = digitsOnly.slice(0, 10);
                        const formattedParts = truncatedDigits.match(/.{1,2}/g);
                        const formattedLocal = formattedParts ? formattedParts.join(' ') : '';
                        setTelRetirant(`+225 ${formattedLocal}`);
                      }
                    }}
                    className="form-input"
                    required
                  />
                </div>

                {isUnclassifiedCard(selectedCarte) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16, background: 'rgba(251, 191, 36, 0.05)', border: '1px solid rgba(251, 191, 36, 0.2)', borderRadius: 12 }}>
                    <label style={{ fontSize: 13, fontWeight: 800, color: '#fbbf24' }}>
                      ⚠️ RANGEMENT D'URGENCE OBLIGATOIRE (Carte non classée)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: C1-B4-P3 (Box/Colonne/Parapheur)"
                      value={emergencyRangement}
                      onChange={(e) => setEmergencyRangement(e.target.value.toUpperCase())}
                      className="form-input"
                      style={{ textTransform: 'uppercase', borderColor: 'rgba(251, 191, 36, 0.4)' }}
                      required
                    />
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                <button
                  onClick={handleDeliver}
                  disabled={isFinalizing}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '16px 28px', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                >
                  {isFinalizing ? <Loader className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
                  {isFinalizing ? 'Validation...' : 'Valider la délivrance'}
                </button>
                <button
                  onClick={() => setModalStep(1)}
                  disabled={isFinalizing}
                  className="btn btn-secondary"
                  style={{ padding: '16px 20px' }}
                >
                  Retour
                </button>
              </div>
            </div>
          ) : modalStep === 3 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ margin: '0 auto 16px', background: 'rgba(239, 68, 68, 0.1)', width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
                  <AlertTriangle size={32} />
                </div>
                <p style={{ fontSize: 16, fontWeight: 700, color: 'white', margin: '0 0 8px 0' }}>
                  Carte Introuvable
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                  Veuillez laisser un commentaire (optionnel) expliquant les recherches effectuées ou toute autre information utile.
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>Commentaire</label>
                <textarea
                  value={absenceComment}
                  onChange={(e) => setAbsenceComment(e.target.value)}
                  placeholder="Ex: Cherché dans le rangement TK 180, ainsi que dans le bac de non-classés..."
                  className="form-input"
                  style={{ minHeight: 100, resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                <button
                  onClick={() => handleSignalerAbsence(selectedCarte, absenceComment)}
                  disabled={isFinalizing}
                  className="btn btn-primary"
                  style={{ flex: 1, padding: '16px 28px', height: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#ef4444', borderColor: '#ef4444', color: 'white' }}
                >
                  {isFinalizing ? <Loader className="animate-spin" size={18} /> : <AlertTriangle size={18} />}
                  {isFinalizing ? 'Signalement...' : 'Confirmer le signalement'}
                </button>
                <button
                  onClick={() => setModalStep(1)}
                  disabled={isFinalizing}
                  className="btn btn-secondary"
                  style={{ padding: '16px 20px' }}
                >
                  Retour
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
