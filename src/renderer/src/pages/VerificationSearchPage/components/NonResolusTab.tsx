import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { Search, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import { toast } from 'react-hot-toast';

export const NonResolusTab = () => {
  const user = useAuthStore((s) => s.user);
  const [nonResolus, setNonResolus] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;

  const loadData = async () => {
    setLoading(true);
    try {
      if (user?.login) {
        // Fetch unresolved absences (those still marked as ABSENT)
        const data = await window.api.cartes.getAgentAbsences(user.login, user.site_id);
        setNonResolus(data || []);
      }
    } catch (error) {
      console.error("Erreur chargement signalements non résolus:", error);
      toast.error("Impossible de charger l'historique.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const totalPages = Math.ceil(nonResolus.length / ITEMS_PER_PAGE) || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedData = nonResolus.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div className="animate-spin" style={{ display: 'inline-block', marginBottom: 16 }}>
          <Search size={24} />
        </div>
        <p>Chargement de vos signalements non résolus...</p>
      </div>
    );
  }

  if (nonResolus.length === 0) {
    return (
      <div style={{ 
        background: 'rgba(255, 255, 255, 0.02)', 
        border: '1px dashed rgba(255, 255, 255, 0.1)', 
        borderRadius: 16, 
        padding: 48, 
        textAlign: 'center' 
      }}>
        <AlertTriangle size={48} style={{ color: '#fbbf24', margin: '0 auto 16px auto', opacity: 0.8 }} />
        <h4 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 700, color: 'white' }}>Aucun signalement en attente</h4>
        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
          Toutes les cartes que vous avez signalées "Introuvables" ont été traitées.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {paginatedData.map((carte) => (
        <div key={carte.id_carte} style={{
          background: 'var(--bg-secondary)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 16,
          padding: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          transition: 'transform 0.2s ease',
        }} className="hover-scale">
          {/* Info Client */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ 
                background: 'rgba(239, 68, 68, 0.1)', 
                color: '#ef4444', 
                padding: '4px 8px', 
                borderRadius: 6, 
                fontSize: 11, 
                fontWeight: 700,
                border: '1px solid rgba(239, 68, 68, 0.2)'
              }}>
                ❌ EN ATTENTE
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Signalée le {carte.date_signalement_absence ? new Date(carte.date_signalement_absence).toLocaleDateString() : 'N/A'}
              </span>
            </div>
            <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800, textTransform: 'uppercase', color: 'white' }}>
              {carte.noms} {carte.prenoms}
            </h4>
            <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span>N° Sécu : {carte.num_secu || 'Non renseigné'}</span>
              <span>Statut : {carte.escalade_niveau === 'NIVEAU_2' ? 'Escaladée au Site' : 'En traitement au Centre'}</span>
            </div>
          </div>

          {/* Rangement d'origine */}
          <div style={{ 
            flex: 1, 
            background: 'rgba(255, 255, 255, 0.02)', 
            border: '1px solid rgba(255, 255, 255, 0.04)', 
            borderRadius: 12, 
            padding: '12px 16px',
            fontSize: 13 
          }}>
            <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>Rangement initial</div>
            <div style={{ fontWeight: 800, color: 'var(--text-muted)', fontSize: 18 }}>{carte.rangement || 'Non classé'}</div>
          </div>
        </div>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 24 }}>
          <button 
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            style={{ 
              padding: '8px 16px', 
              background: 'var(--bg-secondary)', 
              color: 'var(--text-primary)', 
              border: '1px solid var(--border-color)', 
              borderRadius: 8, 
              cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              opacity: currentPage === 1 ? 0.5 : 1
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Page <strong style={{ color: 'var(--text-primary)' }}>{currentPage}</strong> sur {totalPages}
          </span>
          <button 
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            style={{ 
              padding: '8px 16px', 
              background: 'var(--bg-secondary)', 
              color: 'var(--text-primary)', 
              border: '1px solid var(--border-color)', 
              borderRadius: 8, 
              cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
              opacity: currentPage === totalPages ? 0.5 : 1
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
};
