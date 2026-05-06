import React, { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { MapPin, ChevronDown } from 'lucide-react';

export default function CentreContextSwitcher() {
  const user = useAuthStore((s) => s.user);
  const selectedCentreId = useAuthStore((s) => s.selectedCentreId);
  const setSelectedCentreId = useAuthStore((s) => s.setSelectedCentreId);
  
  const [centres, setCentres] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (user?.site_id) {
      window.api.hierarchy.getCentres(user.site_id).then(setCentres);
    }
  }, [user?.site_id]);

  if (user?.role !== 'ADMINISTRATEUR' && user?.role !== 'SUPER ADMIN') {
    return null;
  }

  const currentCentre = centres.find(c => c.id === selectedCentreId);

  return (
    <div className="centre-context-switcher">
      <div className="switcher-label">
        <MapPin size={14} />
        <span>Centre de travail actuel :</span>
      </div>
      
      <div className={`switcher-dropdown ${isOpen ? 'open' : ''}`} onClick={() => setIsOpen(!isOpen)}>
        <div className="selected-value">
          {currentCentre ? currentCentre.nom : '--- Choisir un centre ---'}
          <ChevronDown size={16} />
        </div>
        
        {isOpen && (
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
