import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { MapPin, ChevronDown } from 'lucide-react';

export default function CentreContextSwitcher() {
  const user = useAuthStore((s) => s.user);
  const selectedCentreId = useAuthStore((s) => s.selectedCentreId);
  const setSelectedCentreId = useAuthStore((s) => s.setSelectedCentreId);
  const activeSiteId = useAuthStore((s) => s.activeSiteId);
  
  const [centres, setCentres] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (siteIdToUse) {
      window.api.hierarchy.getCentres(siteIdToUse).then((data) => {
        setCentres(data);
        if (data && data.length > 0) {
          const exists = data.some(c => c.id === useAuthStore.getState().selectedCentreId);
          if (!exists) {
            setSelectedCentreId(data[0].id);
          }
        }
      });
    } else {
      setCentres([]);
    }
  }, [user?.site_id, activeSiteId]);

  if (user?.role !== 'ADMINISTRATEUR_SITE' && user?.role !== 'SUPER ADMIN') {
    return null;
  }

  const currentCentre = centres.find(c => c.id === selectedCentreId);
  const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
  const isDisabled = !siteIdToUse;

  return (
    <div className="centre-context-switcher">
      <div className="switcher-label">
        <MapPin size={14} />
        <span>Centre de travail actuel :</span>
      </div>
      
      <div 
        className={`switcher-dropdown ${isOpen ? 'open' : ''} ${isDisabled ? 'disabled' : ''}`} 
        onClick={() => !isDisabled && setIsOpen(!isOpen)}
        style={{ opacity: isDisabled ? 0.5 : 1, cursor: isDisabled ? 'not-allowed' : 'pointer' }}
      >
        <div className="selected-value">
          {isDisabled 
            ? '--- Aucun site sélectionné ---' 
            : (currentCentre ? currentCentre.nom : '--- Choisir un centre ---')}
          <ChevronDown size={16} />
        </div>
        
        {isOpen && !isDisabled && (
          <div className="dropdown-menu">
            {centres.map((centre) => (
              <div 
                key={centre.id} 
                className={`dropdown-item ${selectedCentreId === centre.id ? 'active' : ''}`}
                onClick={() => {
                  setSelectedCentreId(centre.id);
                  setIsOpen(false);
                }}
              >
                {centre.nom} (N°{centre.numero})
              </div>
            ))}
            {centres.length === 0 && (
              <div className="dropdown-item disabled">Aucun centre configuré</div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
