import React, { useEffect, useState } from 'react';
import { Shield, CheckCircle, AlertTriangle, Edit3, Save, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import DateInput from '../components/DateInput';
import CentreContextSwitcher from '../components/layout/CentreContextSwitcher';
import { useAuthStore } from '../stores/authStore';

export default function EditeurMission1Page() {
  const { user, activeSiteId, selectedCentreId } = useAuthStore();
  
  const [records, setRecords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const loadRecords = async () => {
    setIsLoading(true);
    try {
      const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
      const res = await window.api.cartes.getInvalidDates(siteIdToUse);
      setRecords(res || []);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du chargement des données.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRecords();
  }, [activeSiteId, user?.site_id]);

  const handleSave = async (id: number) => {
    if (editValue.length !== 10) {
      toast.error('Format de date invalide (JJ/MM/AAAA)');
      return;
    }

    try {
      if (user?.role === 'ADMINISTRATEUR' && !selectedCentreId) {
        toast.error('Veuillez sélectionner un centre de travail en haut de la page.');
        return;
      }
      await window.api.cartes.updateDate(id, editValue);
      toast.success('Date mise à jour !');
      setEditingId(null);
      loadRecords();
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de la mise à jour.');
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <CentreContextSwitcher />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ padding: 12, background: 'var(--gradient-button)', borderRadius: 12, color: 'white' }}>
          <Shield size={24} />
        </div>
        <div>
          <h2 style={{ margin: 0 }}>Mission 1 : Assainissement des Dates</h2>
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>Corrigez les dates de naissance mal formées pour garantir l'intégrité de la base.</p>
        </div>
        <button 
          className="btn btn-secondary" 
          onClick={loadRecords} 
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <RefreshCw size={16} /> Rafraîchir
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>Analyse de la base en cours...</div>
        ) : records.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            <CheckCircle size={48} style={{ opacity: 0.2, margin: '0 auto 16px auto', color: 'var(--accent-green)' }} />
            <p>Toutes les dates sont conformes au format JJ/MM/AAAA !</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Assuré</th>
                  <th>Date Actuelle (Invalide)</th>
                  <th>Correction</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id_carte}>
                    <td>
                      <strong>{r.noms} {r.prenoms}</strong><br/>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.num_secu}</span>
                    </td>
                    <td>
                      <span style={{ color: 'var(--warning-color)', fontWeight: 600 }}>
                        {r.date_de_naissance || '(Vide)'}
                      </span>
                    </td>
                    <td>
                      {editingId === r.id_carte ? (
                        <DateInput 
                          value={editValue} 
                          onChange={setEditValue} 
                          autoFocus
                          style={{ minWidth: 150 }}
                        />
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>En attente...</span>
                      )}
                    </td>
                    <td>
                      {editingId === r.id_carte ? (
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button className="btn btn-primary" onClick={() => handleSave(r.id_carte)} title="Sauvegarder">
                            <Save size={16} />
                          </button>
                          <button className="btn btn-secondary" onClick={() => setEditingId(null)} title="Annuler">
                            Annuler
                          </button>
                        </div>
                      ) : (
                        <button className="btn btn-secondary" onClick={() => {
                          setEditingId(r.id_carte);
                          setEditValue(r.date_de_naissance || '');
                        }}>
                          <Edit3 size={16} /> Corriger
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

