import React, { useEffect, useState } from 'react';
import { Clock, CheckCircle, AlertTriangle, Search, Filter, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';

export default function AdminQueuePage() {
  const [absences, setAbsences] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedAbsence, setSelectedAbsence] = useState<any | null>(null);
  const [note, setNote] = useState('');
  const [newStatus, setNewStatus] = useState('RETROUVE');

  const { user, activeSiteId } = useAuthStore();

  const loadAbsences = async () => {
    setIsLoading(true);
    try {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const res = await window.api.cartes.getAbsences(siteIdToUse || undefined);
      console.log('Absences loaded:', res);
      setAbsences(Array.isArray(res) ? res : []);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du chargement de la file d\'attente.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAbsences();
  }, [activeSiteId, user?.site_id]);

  const handleResolve = async () => {
    if (!selectedAbsence) return;
    try {
      let agent = 'ADMIN';
      try {
        const authData = localStorage.getItem('gest-in-situ-auth');
        if (authData) {
          const parsed = JSON.parse(authData);
          agent = parsed.state?.user?.login || 'ADMIN';
        }
      } catch (e) {
        console.warn('Could not get agent from localStorage', e);
      }
      await window.api.cartes.resoudreAbsence(selectedAbsence.id_carte, {
        status: newStatus,
        agent,
        note
      });
      toast.success('Signalement traité avec succès.');
      setSelectedAbsence(null);
      setNote('');
      loadAbsences();
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du traitement.');
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ padding: 12, background: 'var(--gradient-button)', borderRadius: 12, color: 'white' }}>
          <Clock size={24} />
        </div>
        <div>
          <h2 style={{ margin: 0 }}>File d'attente de Traitement</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Gérez les signalements de cartes introuvables physiquement.</p>
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>Chargement...</div>
        ) : absences.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            <CheckCircle size={48} style={{ opacity: 0.2, margin: '0 auto 16px auto' }} />
            <p>Aucun signalement en attente. Tout est en ordre !</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Signalé par</th>
                  <th>Date Signalement</th>
                  <th>Assuré</th>
                  <th>Rangement</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {absences.map(a => (
                  <tr key={a.id_carte}>
                    <td>
                      <span style={{ fontWeight: 600 }}>{a.agent_signalement_absence}</span>
                    </td>
                    <td>
                      {a.date_signalement_absence ? new Date(a.date_signalement_absence).toLocaleString('fr-FR') : 'Date inconnue'}
                    </td>
                    <td>
                      <strong>{a.noms} {a.prenoms}</strong><br/>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.num_secu}</span>
                    </td>
                    <td>
                      <span className="badge" style={{ background: 'rgba(231, 76, 60, 0.1)', color: '#e74c3c' }}>
                        {a.rangement}
                      </span>
                    </td>
                    <td>
                      <button 
                        className="btn btn-primary" 
                        style={{ padding: '6px 12px', fontSize: 12 }}
                        onClick={() => setSelectedAbsence(a)}
                      >
                        Traiter
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedAbsence && (
        <div className="modal-overlay">
          <div className="modal-content animate-slide-up" style={{ maxWidth: 500 }}>
            <h3 style={{ marginTop: 0 }}>Traitement du Signalement</h3>
            <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-card-hover)', borderRadius: 8 }}>
              <strong>Assuré:</strong> {selectedAbsence.noms} {selectedAbsence.prenoms}<br/>
              <strong>Rangement théorique:</strong> {selectedAbsence.rangement}
            </div>

            <div className="form-group">
              <label className="form-label">Résultat de la recherche</label>
              <select 
                className="form-input" 
                value={newStatus} 
                onChange={e => setNewStatus(e.target.value)}
              >
                <option value="RETROUVE">Carte Retrouvée (Remise en rayon)</option>
                <option value="OK">En fait, elle était là (OK)</option>
                <option value="DEFINITIVEMENT_ABSENT">Définitivement introuvable (Re-commande)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Note / Détails</label>
              <textarea 
                className="form-input" 
                rows={3} 
                value={note} 
                onChange={e => setNote(e.target.value)}
                placeholder="Ex: Retrouvée dans le carton B au lieu de A."
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
              <button className="btn btn-secondary" onClick={() => setSelectedAbsence(null)}>
                Annuler
              </button>
              <button className="btn btn-primary" onClick={handleResolve}>
                Enregistrer la résolution
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
