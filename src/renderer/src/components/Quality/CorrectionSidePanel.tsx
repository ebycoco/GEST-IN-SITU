import React, { useState, useEffect } from 'react';
import { X, Save, AlertTriangle } from 'lucide-react';
import { confirmService } from '../confirmService';
import DateInput from '../DateInput';
import toast from 'react-hot-toast';

export interface ICarte {
  id_carte?: number;
  num_secu?: string;
  noms?: string;
  prenoms?: string;
  date_de_naissance?: string;
  lieu_de_naissance?: string;
  contact?: string;
  rangement?: string;
}

interface CorrectionSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  record: ICarte | null;
  anomalieType: string;
  onSave: (id: number, updates: Partial<ICarte>) => Promise<void>;
}

export function CorrectionSidePanel({ isOpen, onClose, record, anomalieType, onSave }: CorrectionSidePanelProps) {
  const [formData, setFormData] = useState<Partial<ICarte>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (record) {
      setFormData({
        noms: record.noms || '',
        prenoms: record.prenoms || '',
        date_de_naissance: record.date_de_naissance || '',
        lieu_de_naissance: record.lieu_de_naissance || '',
        contact: record.contact || '',
        rangement: record.rangement || (record as any).code_rangement || '',
        num_secu: record.num_secu || '',
      });
    }
  }, [record]);

  if (!isOpen || !record) return null;

  const handleChange = (field: keyof ICarte, value: string) => {
    setFormData((prev: Partial<ICarte>) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    const isSensitiveModif = 
      (record.num_secu && formData.num_secu !== record.num_secu) || 
      (record.noms && formData.noms !== record.noms);

    if (isSensitiveModif) {
      const confirmed = await confirmService.confirm({
        title: 'Modification sensible',
        message: 'Vous modifiez une information d\'identité critique (Nom ou N° Sécu). Confirmez-vous ce changement majeur ?',
        isDanger: true,
        requirePassword: true,
      });
      if (!confirmed) return;
    }

    try {
      setIsSaving(true);
      const targetId = record.id_carte || (record as any).id;
      if (!targetId) throw new Error("ID de la fiche manquant");
      
      // On peut injecter le type d'enregistrement dans les updates pour que le backend sache quelle table mettre à jour
      const finalData = { ...formData, _recordType: (record as any)._recordType };
      
      await onSave(targetId, finalData);
      toast.success('Données mises à jour avec succès');
      onClose();
    } catch (e: any) {
      toast.error('Erreur lors de la sauvegarde: ' + e.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div 
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 998,
          backdropFilter: 'blur(2px)', transition: 'opacity 0.3s'
        }} 
        onClick={onClose}
      />
      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 450, background: 'var(--bg-secondary)',
        zIndex: 999, borderLeft: '1px solid var(--border-color)', boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
        display: 'flex', flexDirection: 'column', transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
      }}>
        <div style={{ padding: '24px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)' }}>
          <div>
            <h3 style={{ margin: 0, color: 'white', fontSize: 18, fontWeight: 700 }}>Correction Manuelle</h3>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Type : {anomalieType}</span>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'var(--text-secondary)', padding: 8, borderRadius: '50%', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {isSensitiveModifWarning(formData, record) && (
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: 12, borderRadius: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <h4 style={{ margin: '0 0 4px 0', color: '#ef4444', fontSize: 14 }}>Modification sensible</h4>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13 }}>Vous allez devoir valider ce changement avec le mot de passe maître.</p>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Numéro de Sécurité Sociale</label>
            <input type="text" value={formData.num_secu || ''} onChange={e => handleChange('num_secu', e.target.value)}
              style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '10px 14px', borderRadius: 8, color: 'white' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Noms</label>
            <input type="text" value={formData.noms || ''} onChange={e => handleChange('noms', e.target.value.toUpperCase())}
              style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '10px 14px', borderRadius: 8, color: 'white' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Prénoms</label>
            <input type="text" value={formData.prenoms || ''} onChange={e => handleChange('prenoms', e.target.value.toUpperCase())}
              style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '10px 14px', borderRadius: 8, color: 'white' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Date de Naissance</label>
            <DateInput
              value={formData.date_de_naissance || ''}
              onChange={(val: string) => handleChange('date_de_naissance', val)}
              className="w-full"
              style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '10px 14px', borderRadius: 8, color: 'white', width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Lieu de Naissance</label>
            <input type="text" value={formData.lieu_de_naissance || ''} onChange={e => handleChange('lieu_de_naissance', e.target.value.toUpperCase())}
              style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '10px 14px', borderRadius: 8, color: 'white' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Contact</label>
            <input type="text" value={formData.contact || ''} onChange={e => handleChange('contact', e.target.value)}
              style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '10px 14px', borderRadius: 8, color: 'white' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>Rangement (Emplacement physique)</label>
            <input type="text" value={formData.rangement || ''} onChange={e => handleChange('rangement', e.target.value)}
              placeholder="Ex: Boite A, Tiroir 3"
              style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border-color)', padding: '10px 14px', borderRadius: 8, color: 'white' }} />
          </div>

        </div>

        <div style={{ padding: 24, borderTop: '1px solid var(--border-color)', display: 'flex', gap: 12, background: 'rgba(0,0,0,0.2)' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px', background: 'transparent', border: '1px solid var(--border-color)', color: 'white', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
            Annuler
          </button>
          <button onClick={handleSave} disabled={isSaving} style={{ flex: 1, padding: '12px', background: 'var(--accent-primary)', border: 'none', color: 'black', borderRadius: 8, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: isSaving ? 0.7 : 1 }}>
            <Save size={18} />
            {isSaving ? 'Sauvegarde...' : 'Sauvegarder'}
          </button>
        </div>
      </div>
    </>
  );
}

function isSensitiveModifWarning(formData: Partial<ICarte>, record: ICarte) {
  return (record.num_secu && formData.num_secu !== record.num_secu) || 
         (record.noms && formData.noms !== record.noms);
}
