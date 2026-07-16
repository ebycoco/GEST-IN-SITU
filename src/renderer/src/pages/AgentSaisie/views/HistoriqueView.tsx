import React, { useState, useEffect } from 'react';
import { History, Search, Edit2, AlertCircle, FileText } from 'lucide-react';
import { useAuthStore } from '../../../stores/authStore';

export default function HistoriqueView() {
  const { user } = useAuthStore();
  const [saisies, setSaisies] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchSaisies = async () => {
      if (user?.id_user) {
        try {
          setIsLoading(true);
          if (window.api.stats.getAgentRecentSaisies) {
            // On récupère un plus grand nombre de saisies pour l'historique (ex: 50 dernières)
            const recent = await window.api.stats.getAgentRecentSaisies(user.id_user, 50);
            setSaisies(recent);
          }
        } catch (err) {
          console.error("Erreur lors de la récupération de l'historique:", err);
        } finally {
          setIsLoading(false);
        }
      }
    };
    fetchSaisies();
  }, [user]);

  const filteredSaisies = saisies.filter(s => 
    s.noms.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.prenoms.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.num_secu?.includes(searchTerm)
  );

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200, margin: '0 auto' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'white' }}>Historique de vos saisies</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>Retrouvez vos 50 dernières saisies. Vous pouvez modifier celles qui ne sont pas encore envoyées au Cloud.</p>
        </div>
        
        <div style={{ position: 'relative', width: 300 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input 
            type="text" 
            placeholder="Rechercher par nom ou N° CMU..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="form-input"
            style={{ paddingLeft: 36, width: '100%', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}
          />
        </div>
      </div>

      <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement en cours...</div>
        ) : filteredSaisies.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <FileText size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            Aucune saisie trouvée.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Identité</th>
                <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>N° Sécu</th>
                <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Date Saisie</th>
                <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Statut Sync</th>
                <th style={{ padding: '16px 24px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredSaisies.map((saisie) => {
                // En SQLite, is_dirty = 1 signifie non synchronisé
                const canEdit = saisie.is_dirty === 1;
                
                return (
                  <tr key={saisie.id_carte} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ fontWeight: 600, color: 'white' }}>{saisie.noms} {saisie.prenoms}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{saisie.lieu_de_naissance}</div>
                    </td>
                    <td style={{ padding: '16px 24px', fontFamily: 'monospace', color: '#93c5fd' }}>{saisie.num_secu}</td>
                    <td style={{ padding: '16px 24px', color: 'var(--text-muted)', fontSize: 13 }}>
                      {new Date(saisie.created_at || new Date()).toLocaleDateString('fr-FR')}
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      {canEdit ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: 'rgba(255, 152, 0, 0.1)', color: '#ff9800', fontSize: 12, fontWeight: 600 }}>
                          <AlertCircle size={14} /> Local
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', fontSize: 12, fontWeight: 600 }}>
                          Cloud
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      {canEdit ? (
                        <button 
                          title="Modifier"
                          className="btn-outline"
                          style={{ padding: '6px 12px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'white', cursor: 'pointer' }}
                          onClick={() => {
                            // Implémentation de la modification
                            alert("Bientôt disponible : ouverture du formulaire de modification pour la carte ID: " + saisie.id_carte);
                          }}
                        >
                          <Edit2 size={14} /> Modifier
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Verrouillé</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  );
}
