import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import SaisiePage, { FormState } from '../../SaisiePage';
import { useAuthStore } from '../../../stores/authStore';
import { useCacheStore } from '../../../stores/cacheStore';

interface SaisieEditModalProps {
  carte: any;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SaisieEditModal({ carte, onClose, onSuccess }: SaisieEditModalProps) {
  const { user, activeSiteId, selectedCentreId } = useAuthStore();
  const { sitesCache, centresCache } = useCacheStore();

  const initialData = useMemo<FormState | undefined>(() => {
    if (!carte) return undefined;
    
    const siteIdToUse = carte.site_id || activeSiteId || user?.site_id;
    const centreIdToUse = carte.centre_id || selectedCentreId;

    const resolvedSiteName = sitesCache.list?.find(s => s.id === siteIdToUse)?.nom || '';
    const resolvedCentreName = centresCache.list?.find(c => c.id === centreIdToUse)?.nom || '';

    return {
      noms: carte.noms || '',
      prenoms: carte.prenoms || '',
      date_de_naissance: carte.date_de_naissance || '',
      lieu_de_naissance: carte.lieu_de_naissance || '',
      contact: carte.contact || '',
      num_secu: carte.num_secu || '',
      rangement: carte.rangement || '',
      site: resolvedSiteName,
      centre: resolvedCentreName,
      centre_id: carte.centre_id || null,
      poste: carte.lieu_enrolement || '',
    };
  }, [carte?.id_carte, sitesCache.list, centresCache.list, activeSiteId, user?.site_id, selectedCentreId]);

  const handleUpdate = async (data: FormState) => {
    const carteId = carte.id_carte;
    if (!carteId) throw new Error("ID de la carte manquant");

    const payload = {
      ...data,
      lieu_enrolement: data.poste, // Maps form UI "poste" back to DB "lieu_enrolement"
      centre_id: data.centre_id, // Ensure centre_id is preserved if edited by ADMIN_SITE
    };

    await window.api.cartes.updateCarte(carteId, payload, user);
    
    // Après succès, on déclenche le rafraîchissement global
    window.dispatchEvent(new CustomEvent('app:data-updated'));

    // On notifie le parent pour fermer
    setTimeout(() => {
      onSuccess();
    }, 1000);
  };

  if (!initialData) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      zIndex: 1000,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      padding: '40px'
    }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 1000, maxHeight: '90vh' }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            color: 'white',
            width: 40,
            height: 40,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 1010,
            transition: 'all 0.2s',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          <X size={20} />
        </button>

        <div className="glass-card animate-fade-in" style={{
          width: '100%',
          height: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          borderRadius: 24,
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }}>
          <div style={{ padding: '48px 0 24px 0' }}>
            <SaisiePage 
              mode="edit" 
              initialData={initialData} 
              onSubmitOverride={handleUpdate} 
            />
          </div>
        </div>
      </div>
    </div>
  );
}
