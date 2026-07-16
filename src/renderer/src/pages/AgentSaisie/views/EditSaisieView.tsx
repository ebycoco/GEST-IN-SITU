import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import SaisiePage, { FormState } from '../../SaisiePage';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';

export default function EditSaisieView() {
  const location = useLocation();
  const navigate = useNavigate();
  const { id } = useParams();
  const [initialData, setInitialData] = useState<FormState | undefined>();
  const { user } = useAuthStore();

  useEffect(() => {
    // Si la carte est passée via le state (navigation), on l'utilise
    const carteState = location.state?.carte;
    
    if (carteState) {
      setInitialData({
        noms: carteState.noms || '',
        prenoms: carteState.prenoms || '',
        date_de_naissance: carteState.date_de_naissance || '',
        lieu_de_naissance: carteState.lieu_de_naissance || '',
        contact: carteState.contact || '',
        num_secu: carteState.num_secu || '',
        rangement: carteState.rangement || '',
        site: carteState.site || '',
        centre: carteState.centre || '',
        poste: carteState.poste || '',
      });
    } else {
      // Redirection si pas de données de carte
      navigate('/agent-saisie/historique');
    }
  }, [location, navigate]);

  const handleUpdate = async (data: FormState) => {
    const carteId = location.state?.carte?.id_carte || Number(id);
    if (!carteId) throw new Error("ID de la carte manquant");

    await window.api.cartes.updateCarte(carteId, data, user);
    
    // Après succès, on revient à l'historique
    setTimeout(() => {
      navigate('/agent-saisie/historique');
    }, 1000);
  };

  if (!initialData) return null;

  return (
    <div style={{ marginTop: '-24px' }}>
      <div style={{ padding: '24px 28px 0', maxWidth: 960, margin: '0 auto', marginBottom: '-20px', position: 'relative', zIndex: 10 }}>
        <button
          onClick={() => navigate('/agent-saisie/historique')}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)', cursor: 'pointer', transition: 'background 0.2s' }}
          onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
          onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
        >
          <ArrowLeft size={16} /> Retour à l'historique
        </button>
      </div>
      <SaisiePage 
        mode="edit" 
        initialData={initialData} 
        onSubmitOverride={handleUpdate} 
      />
    </div>
  );
}
