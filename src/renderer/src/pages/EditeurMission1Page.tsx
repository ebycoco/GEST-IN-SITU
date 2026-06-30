import React, { useEffect, useState } from 'react';
import { Shield, CheckCircle, AlertTriangle, Edit3, Save, RefreshCw, Search, MapPin, Database, Award } from 'lucide-react';
import toast from 'react-hot-toast';
import DateInput from '../components/DateInput';
import CentreContextSwitcher from '../components/layout/CentreContextSwitcher';
import { useAuthStore } from '../stores/authStore';

export default function EditeurMission1Page() {
  const { user, activeSiteId, selectedCentreId } = useAuthStore();
  
  const [records, setRecords] = useState<any[]>([]);
  const [absentRecords, setAbsentRecords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState<Record<number, boolean>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [resolutionRangements, setResolutionRangements] = useState<Record<number, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const loadRecords = async () => {
    setIsLoading(true);
    try {
      const siteIdToUse = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? undefined;
      const res = await window.api.cartes.getInvalidDates(siteIdToUse);
      setRecords(res || []);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du chargement des anomalies.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadAbsences = async () => {
    try {
      const siteIdToUse = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? undefined;
      const res = await window.api.cartes.getAbsences(siteIdToUse);
      setAbsentRecords(res || []);
    } catch (err) {
      console.error('[loadAbsences]', err);
    }
  };

  const reloadAll = () => {
    loadRecords();
    loadAbsences();
  };

  useEffect(() => {
    reloadAll();
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
      setIsResolving(prev => ({ ...prev, [id]: true }));
      await window.api.cartes.updateDate(id, editValue);
      toast.success('Date mise à jour !');
      setEditingId(null);
      loadRecords();
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de la mise à jour.');
    } finally {
      setIsResolving(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleResolveAbsence = async (id: number) => {
    const rangement = resolutionRangements[id] || '';
    if (!rangement.trim()) {
      toast.error("Veuillez spécifier le nouveau rangement.");
      return;
    }
    try {
      setIsResolving(prev => ({ ...prev, [id]: true }));
      const auth = localStorage.getItem('gest-in-situ-auth');
      const agent = auth ? JSON.parse(auth).state?.user?.login : 'ADMIN';
      
      await window.api.cartes.resoudreAbsence(id, {
        status: 'OK',
        agent,
        note: `Relocalisée au rangement : ${rangement}`,
        rangement
      });
      toast.success("Carte relocalisée et statut remis à OK.");
      
      setResolutionRangements(prev => {
        const copy = { ...prev };
        delete copy[id];
        return copy;
      });
      loadAbsences();
    } catch (err) {
      console.error('[handleResolveAbsence]', err);
      toast.error("Erreur lors de la résolution de l'absence.");
    } finally {
      setIsResolving(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleDeclareLost = async (id: number) => {
    try {
      setIsResolving(prev => ({ ...prev, [id]: true }));
      await window.api.cartes.declarerPerdue(id);
      toast.success("Carte déclarée perdue avec succès.");
      loadAbsences();
    } catch (err) {
      console.error('[handleDeclareLost]', err);
      toast.error("Erreur lors de la déclaration de perte.");
    } finally {
      setIsResolving(prev => ({ ...prev, [id]: false }));
    }
  };

  // Filter lists based on search query
  const filteredRecords = records.filter(r => 
    `${r.noms} ${r.prenoms}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.num_secu && r.num_secu.includes(searchQuery)) ||
    (r.rangement && r.rangement.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredAbsents = absentRecords.filter(r => 
    `${r.noms} ${r.prenoms}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.num_secu && r.num_secu.includes(searchQuery)) ||
    (r.rangement && r.rangement.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredRecords.slice(indexOfFirstItem, indexOfLastItem);
  const totalPages = Math.ceil(filteredRecords.length / itemsPerPage);

  const totalAnomalies = records.length + absentRecords.length;

  return (
    <div className="animate-fade-in" style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', color: 'var(--text-primary)' }}>
      <CentreContextSwitcher />
      
      {/* HEADER SECTION */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            width: 56, 
            height: 56, 
            background: 'linear-gradient(135deg, #FFD700 0%, #d4af37 100%)', 
            borderRadius: 16, 
            color: '#000',
            boxShadow: '0 8px 24px rgba(255, 215, 0, 0.15)'
          }}>
            <Shield size={28} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' }}>Espace d'Assainissement & de Résolution</h2>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
              Intégrité physique et logique de la base de cartes CMU du site actuel.
            </p>
          </div>
        </div>
        <button 
          className="btn btn-secondary" 
          onClick={reloadAll} 
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12, border: '1px solid var(--border-color)' }}
        >
          <RefreshCw size={16} /> Synchroniser / Rafraîchir
        </button>
      </div>

      {/* STATS SECTION (KPIs) */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
        gap: 24, 
        marginBottom: 32 
      }}>
        {/* KPI 1 */}
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-color)', 
          borderRadius: 16, 
          padding: 24, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Anomalies actives</span>
            <h3 style={{ margin: '8px 0 0 0', fontSize: 36, fontWeight: 900, color: totalAnomalies > 0 ? '#ef4444' : '#27ae60' }}>
              {totalAnomalies}
            </h3>
          </div>
          <div style={{ color: totalAnomalies > 0 ? 'rgba(239, 68, 68, 0.15)' : 'rgba(39, 174, 96, 0.15)', background: totalAnomalies > 0 ? 'rgba(239, 68, 68, 0.05)' : 'rgba(39, 174, 96, 0.05)', padding: 16, borderRadius: 12 }}>
            <AlertTriangle size={32} />
          </div>
        </div>

        {/* KPI 2 */}
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-color)', 
          borderRadius: 16, 
          padding: 24, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between'
        }}>
          <div>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cartes Introuvables</span>
            <h3 style={{ margin: '8px 0 0 0', fontSize: 36, fontWeight: 900, color: '#FFD700' }}>
              {absentRecords.length}
            </h3>
          </div>
          <div style={{ color: 'rgba(255, 215, 0, 0.15)', background: 'rgba(255, 215, 0, 0.05)', padding: 16, borderRadius: 12 }}>
            <MapPin size={32} />
          </div>
        </div>

        {/* KPI 3 */}
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-color)', 
          borderRadius: 16, 
          padding: 24, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between'
        }}>
          <div>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Formatage logique</span>
            <h3 style={{ margin: '8px 0 0 0', fontSize: 36, fontWeight: 900, color: '#4ecdc4' }}>
              {records.length} <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-secondary)' }}>erreurs</span>
            </h3>
          </div>
          <div style={{ color: 'rgba(78, 205, 196, 0.15)', background: 'rgba(78, 205, 196, 0.05)', padding: 16, borderRadius: 12 }}>
            <Database size={32} />
          </div>
        </div>
      </div>

      {/* FILTER & SEARCH ZONE */}
      <div style={{ 
        background: 'var(--bg-secondary)', 
        border: '1px solid var(--border-color)', 
        borderRadius: 16, 
        padding: '16px 24px', 
        marginBottom: 32,
        display: 'flex',
        alignItems: 'center',
        gap: 16
      }}>
        <Search size={20} style={{ color: 'var(--text-secondary)' }} />
        <input 
          type="text" 
          placeholder="Rechercher par assuré, sécurité sociale, rangement..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: 'var(--text-primary)',
            fontSize: 15
          }}
        />
        {searchQuery && (
          <button 
            onClick={() => setSearchQuery('')}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}
          >
            Effacer
          </button>
        )}
      </div>

      {/* SECTION 1: CARTES INTROUVABLES (ABSENTES) */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ 
            width: 4, 
            height: 24, 
            background: '#ef4444', 
            borderRadius: 2 
          }} />
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Anomalies Physiques : Cartes Signalées Introuvables</h3>
        </div>

        {filteredAbsents.length === 0 ? (
          <div style={{ 
            background: 'var(--bg-secondary)', 
            border: '1px dashed var(--border-color)', 
            borderRadius: 16, 
            padding: 48, 
            textAlign: 'center' 
          }}>
            <CheckCircle size={48} style={{ color: '#27ae60', margin: '0 auto 16px auto', opacity: 0.8 }} />
            <h4 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 700 }}>Tout est en ordre !</h4>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
              Félicitations, aucune anomalie physique n'est signalée sur ce site. Tout est au carré !
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filteredAbsents.map(r => {
              const resolving = isResolving[r.id_carte];
              return (
                <div key={r.id_carte} style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 16,
                  padding: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 24,
                  transition: 'transform 0.2s ease',
                }} className="hover-scale">
                  {/* Left Column: Beneficiary */}
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
                        ⚠️ INTROUVABLE
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        Signalée le {r.date_signalement_absence ? new Date(r.date_signalement_absence).toLocaleDateString() : 'N/A'}
                      </span>
                    </div>
                    <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800, textTransform: 'uppercase' }}>
                      {r.noms} {r.prenoms}
                    </h4>
                    <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span>N° Sécu : {r.num_secu || 'Non renseigné'}</span>
                      <span>Né(e) le : {r.date_de_naissance || 'N/A'} à {r.lieu_de_naissance || 'N/A'}</span>
                    </div>
                  </div>

                  {/* Middle Column: Initial Location & Agent */}
                  <div style={{ 
                    flex: 1, 
                    background: 'rgba(255, 255, 255, 0.02)', 
                    border: '1px solid rgba(255, 255, 255, 0.04)', 
                    borderRadius: 12, 
                    padding: '12px 16px',
                    fontSize: 13 
                  }}>
                    <div style={{ color: 'var(--text-secondary)', marginBottom: 2 }}>Rangement théorique initial</div>
                    <div style={{ fontWeight: 700, color: '#ef4444', fontSize: 15 }}>{r.rangement || 'Non classé'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      Signalé par : <strong style={{ color: 'var(--text-secondary)' }}>{r.agent_signalement_absence || 'Inconnu'}</strong>
                    </div>
                  </div>

                  {/* Right Column: Actions */}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <input 
                      type="text" 
                      placeholder="Nouveau Rangement (Ex: TK 180)"
                      value={resolutionRangements[r.id_carte] || ''}
                      onChange={(e) => setResolutionRangements(prev => ({ ...prev, [r.id_carte]: e.target.value.toUpperCase() }))}
                      className="uppercase"
                      disabled={resolving}
                      style={{
                        padding: '12px 16px',
                        background: '#000',
                        border: '1px solid var(--border-color)',
                        borderRadius: 12,
                        color: '#FFD700',
                        fontSize: 14,
                        outline: 'none',
                        width: 220,
                        transition: 'border-color 0.2s',
                      }}
                      onFocus={(e) => e.target.style.borderColor = '#FFD700'}
                      onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
                    />
                    <button 
                      onClick={() => handleResolveAbsence(r.id_carte)}
                      disabled={resolving || !(resolutionRangements[r.id_carte] || '').trim()}
                      style={{ 
                        padding: '12px 24px', 
                        background: '#FFD700', 
                        color: '#000', 
                        border: 'none', 
                        borderRadius: 12, 
                        fontWeight: 700, 
                        fontSize: 14,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        opacity: (resolving || !(resolutionRangements[r.id_carte] || '').trim()) ? 0.5 : 1,
                        transform: 'scale(1)',
                        transition: 'all 0.15s ease'
                      }}
                      className="hover-scale"
                    >
                      {resolving ? <RefreshCw size={16} className="animate-spin" /> : 'Valider la relocalisation'}
                    </button>
                    <button 
                      onClick={() => handleDeclareLost(r.id_carte)}
                      disabled={resolving}
                      style={{ 
                        padding: '12px 24px', 
                        background: 'transparent', 
                        color: '#ef4444', 
                        border: '1px solid rgba(239, 68, 68, 0.4)', 
                        borderRadius: 12, 
                        fontWeight: 700, 
                        fontSize: 14,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        opacity: resolving ? 0.5 : 1,
                        transition: 'all 0.15s ease'
                      }}
                      className="hover-scale"
                    >
                      {resolving ? <RefreshCw size={16} className="animate-spin" /> : 'Déclarer Introuvable'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SECTION 2: ASSAINISSEMENT DATES (ANOMALIES LOGIQUES) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ 
            width: 4, 
            height: 24, 
            background: 'var(--accent-primary)', 
            borderRadius: 2 
          }} />
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Anomalies Logiques : Dates de Naissance Non-Conformes</h3>
        </div>

        {filteredRecords.length === 0 ? (
          <div style={{ 
            background: 'var(--bg-secondary)', 
            border: '1px dashed var(--border-color)', 
            borderRadius: 16, 
            padding: 48, 
            textAlign: 'center' 
          }}>
            <Award size={48} style={{ color: '#4ecdc4', margin: '0 auto 16px auto', opacity: 0.8 }} />
            <h4 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 700 }}>Excellence logique !</h4>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
              Toutes les dates de naissance enregistrées sur ce site respectent le standard ISO.
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
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
                  {currentItems.map(r => {
                    const resolving = isResolving[r.id_carte];
                    return (
                      <tr key={r.id_carte}>
                        <td>
                          <strong>{r.noms} {r.prenoms}</strong><br/>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.num_secu || 'N/A'}</span>
                        </td>
                        <td>
                          <span style={{ color: 'var(--warning-color)', fontWeight: 600, background: 'rgba(243, 156, 18, 0.1)', padding: '4px 8px', borderRadius: 6 }}>
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
                              disabled={resolving}
                            />
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 13 }}>Correction requise</span>
                          )}
                        </td>
                        <td>
                          {editingId === r.id_carte ? (
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button 
                                className="btn btn-primary" 
                                onClick={() => handleSave(r.id_carte)} 
                                title="Sauvegarder"
                                disabled={resolving}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36 }}
                              >
                                {resolving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={16} />}
                              </button>
                              <button className="btn btn-secondary" onClick={() => setEditingId(null)} title="Annuler" disabled={resolving}>
                                Annuler
                              </button>
                            </div>
                          ) : (
                            <button className="btn btn-secondary" onClick={() => {
                              setEditingId(r.id_carte);
                              setEditValue(r.date_de_naissance || '');
                            }}>
                              <Edit3 size={14} style={{ marginRight: 6 }} /> Corriger la date
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination UI Controls */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 24px',
                background: 'rgba(255, 255, 255, 0.01)',
                borderTop: '1px solid var(--border-color)',
                flexWrap: 'wrap',
                gap: 12
              }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  Affichage de <strong>{indexOfFirstItem + 1}</strong> à <strong>{Math.min(indexOfLastItem, filteredRecords.length)}</strong> sur <strong>{filteredRecords.length}</strong> anomalies logiques
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    style={{ padding: '8px 16px', fontSize: 13, opacity: currentPage === 1 ? 0.5 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                  >
                    Précédent
                  </button>
                  <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 13, fontWeight: 600 }}>
                    Page {currentPage} sur {totalPages}
                  </span>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    style={{ padding: '8px 16px', fontSize: 13, opacity: currentPage === totalPages ? 0.5 : 1, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
                  >
                    Suivant
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

