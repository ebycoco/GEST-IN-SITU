import React, { useState } from 'react';
import { UserPlus, Save, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import DateInput from '../components/DateInput';
import CentreContextSwitcher from '../components/layout/CentreContextSwitcher';
import { useAuthStore } from '../stores/authStore';

const INITIAL_STATE = {
  noms: '',
  prenoms: '',
  date_de_naissance: '',
  lieu_de_naissance: '',
  contact: '',
  num_secu: '',
  rangement: '',
  site: '',
  centre: '',
  poste: ''
};

export default function AjoutantSaisiePage() {
  const { user, activeSiteId, selectedCentreId } = useAuthStore();
  
  const [formData, setFormData] = useState(INITIAL_STATE);
  const [isSaving, setIsSaving] = useState(false);

  const handleReset = () => {
    if (confirm('Voulez-vous vraiment vider le formulaire ?')) {
      setFormData(INITIAL_STATE);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.noms || !formData.prenoms || formData.date_de_naissance.length !== 10) {
      toast.error('Veuillez remplir les champs obligatoires (*)');
      return;
    }

    try {
      if (user?.role === 'ADMINISTRATEUR' && !selectedCentreId) {
        toast.error('Veuillez sélectionner un centre de travail en haut de la page.');
        setIsSaving(false);
        return;
      }

      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      if (!siteIdToUse) {
        toast.error('Aucun site sélectionné');
        return;
      }

      const agent = user?.login || 'AJOUTANT';
      const dataToSave = {
        ...formData,
        site_id: siteIdToUse,
        agent_saisie: agent,
        centre_id: selectedCentreId,
        statut: 'EN STOCK',
        statut_physique: 'OK'
      };

      await window.api.cartes.create(dataToSave);
      toast.success('Carte enregistrée avec succès !');
      setFormData(INITIAL_STATE);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de l\'enregistrement.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateField = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value.toUpperCase() }));
  };

  return (
    <div className="animate-fade-in" style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <CentreContextSwitcher />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ padding: 12, background: 'var(--gradient-button)', borderRadius: 12, color: 'white' }}>
          <UserPlus size={24} />
        </div>
        <div>
          <h2 style={{ margin: 0 }}>Nouvelle Saisie de Carte</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Enregistrez manuellement une nouvelle carte dans le système.</p>
        </div>
      </div>

      <div className="card">
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Identité */}
          <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Identité de l'assuré</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Nom <span className="text-red-500">*</span></label>
              <input 
                type="text" 
                className="form-input" 
                value={formData.noms} 
                onChange={e => updateField('noms', e.target.value)} 
                required 
              />
            </div>
            <div className="form-group">
              <label className="form-label">Prénom <span className="text-red-500">*</span></label>
              <input 
                type="text" 
                className="form-input" 
                value={formData.prenoms} 
                onChange={e => updateField('prenoms', e.target.value)} 
                required 
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <DateInput 
              label="Date de naissance *" 
              value={formData.date_de_naissance} 
              onChange={val => setFormData(prev => ({ ...prev, date_de_naissance: val }))} 
              required 
            />
            <div className="form-group">
              <label className="form-label">Lieu de naissance</label>
              <input 
                type="text" 
                className="form-input" 
                value={formData.lieu_de_naissance} 
                onChange={e => updateField('lieu_de_naissance', e.target.value)} 
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">N° Sécurité Sociale (CMU)</label>
              <input 
                type="text" 
                className="form-input" 
                value={formData.num_secu} 
                onChange={e => updateField('num_secu', e.target.value)} 
                placeholder="Ex: 1234567890"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Contact / Téléphone</label>
              <input 
                type="text" 
                className="form-input" 
                value={formData.contact} 
                onChange={e => setFormData(prev => ({ ...prev, contact: e.target.value }))} 
              />
            </div>
          </div>

          {/* Localisation / Rangement */}
          <div style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: 12, marginTop: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16 }}>Localisation & Rangement</h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div className="form-group">
              <label className="form-label">Site</label>
              <input 
                type="text" 
                className="form-input" 
                value={formData.site} 
                onChange={e => updateField('site', e.target.value)} 
                placeholder="Ex: ABOBO"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Centre</label>
              <input 
                type="text" 
                className="form-input" 
                value={formData.centre} 
                onChange={e => updateField('centre', e.target.value)} 
              />
            </div>
            <div className="form-group">
              <label className="form-label">Poste</label>
              <input 
                type="text" 
                className="form-input" 
                value={formData.poste} 
                onChange={e => updateField('poste', e.target.value)} 
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Code Rangement (Boîte/Casier)</label>
            <input 
              type="text" 
              className="form-input" 
              value={formData.rangement} 
              onChange={e => updateField('rangement', e.target.value)} 
              placeholder="Ex: BOITE 42 / RAYON C"
              style={{ fontWeight: 'bold', fontSize: 18 }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={handleReset}
              disabled={isSaving}
            >
              <RotateCcw size={16} /> Réinitialiser
            </button>
            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={isSaving}
              style={{ padding: '12px 32px' }}
            >
              <Save size={18} /> {isSaving ? 'Enregistrement...' : 'Enregistrer la carte'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

