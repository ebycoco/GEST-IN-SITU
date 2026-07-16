import React, { useEffect, useState } from 'react';
import { Clock, CheckCircle, AlertTriangle, Search, MapPin, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';

export default function AdminQueuePage() {
  const { user, activeSiteId } = useAuthStore();
  
  const [absentRecords, setAbsentRecords] = useState<any[]>([]);
  const [lostRecords, setLostRecords] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'lost'>('pending');
  const [isLoading, setIsLoading] = useState(true);
  const [isResolving, setIsResolving] = useState<Record<number, boolean>>({});
  const [isReactivating, setIsReactivating] = useState<Record<number, boolean>>({});
  const [resolutionRangements, setResolutionRangements] = useState<Record<number, string>>({});
  const [searchQuery, setSearchQuery] = useState('');

  // Reactivation Modal states
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [reactivateCardId, setReactivateCardId] = useState<number | null>(null);
  const [reactivateRangement, setReactivateRangement] = useState('');

  const loadAllData = async () => {
    setIsLoading(true);
    try {
      let absents = [];
      if (user?.role === 'ADMIN_CENTRE') {
        absents = await window.api.cartes.getAbsencesCentre(user.centre_id!);
      } else {
        const siteIdToUse = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? undefined;
        absents = await window.api.cartes.getAbsencesSite(siteIdToUse);
      }
      
      const siteIdToUseLost = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? undefined;
      const lost = await window.api.cartes.getHistoriquePertes(siteIdToUseLost);
      
      setAbsentRecords(absents || []);
      setLostRecords(lost || []);
    } catch (err) {
      console.error('[loadAllData]', err);
      toast.error("Erreur lors du chargement des données.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, [activeSiteId, user?.site_id]);

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
      loadAllData();
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
      loadAllData();
    } catch (err) {
      console.error('[handleDeclareLost]', err);
      toast.error("Erreur lors de la déclaration de perte.");
    } finally {
      setIsResolving(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleEscaladeSite = async (id: number) => {
    try {
      setIsResolving(prev => ({ ...prev, [id]: true }));
      await window.api.cartes.escaladerAuSite(id, user ? { id_user: user.id_user, login: user.login, site_id: user.site_id } : undefined);
      toast.success("Carte escaladée à l'administrateur du site avec succès.");
      loadAllData();
    } catch (err) {
      console.error('[handleEscaladeSite]', err);
      toast.error("Erreur lors de l'escalade au site.");
    } finally {
      setIsResolving(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleReactivate = async (id: number, rangement: string) => {
    try {
      setIsReactivating(prev => ({ ...prev, [id]: true }));
      await window.api.cartes.reactiverCarte(id, rangement, user ? { role: user.role, site_id: user.site_id } : undefined);
      toast.success("Carte réactivée et réintégrée au stock.");
      setShowReactivateModal(false);
      loadAllData();
    } catch (err) {
      console.error('[handleReactivate]', err);
      toast.error("Erreur lors de la réactivation de la carte.");
    } finally {
      setIsReactivating(prev => ({ ...prev, [id]: false }));
    }
  };

  const filteredAbsents = absentRecords.filter(r => 
    `${r.noms} ${r.prenoms}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.num_secu && r.num_secu.includes(searchQuery)) ||
    (r.rangement && r.rangement.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredLost = lostRecords.filter(r => 
    `${r.noms} ${r.prenoms}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (r.num_secu && r.num_secu.includes(searchQuery)) ||
    (r.rangement && r.rangement.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="animate-fade-in" style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto', color: 'var(--text-primary)' }}>
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
            <Clock size={28} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' }}>File d'attente de Traitement</h2>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
              Gérez les signalements de cartes introuvables physiquement.
            </p>
          </div>
        </div>
        <button 
          className="btn btn-secondary" 
          onClick={loadAllData} 
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12, border: '1px solid var(--border-color)' }}
        >
          <RefreshCw size={16} /> Synchroniser / Rafraîchir
        </button>
      </div>

      {/* TABS / STATS SECTION */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
        gap: 24, 
        marginBottom: 32 
      }}>
        {/* Tab 1: Pending Absences */}
        <div 
          onClick={() => setActiveTab('pending')}
          style={{ 
            background: activeTab === 'pending' ? 'rgba(255, 215, 0, 0.03)' : 'var(--bg-secondary)', 
            border: activeTab === 'pending' ? '2px solid #FFD700' : '1px solid var(--border-color)', 
            borderRadius: 16, 
            padding: 24, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          className="hover-scale"
        >
          <div>
            <span style={{ fontSize: 13, color: activeTab === 'pending' ? '#FFD700' : 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Anomalies Actives</span>
            <h3 style={{ margin: '8px 0 0 0', fontSize: 36, fontWeight: 900, color: activeTab === 'pending' ? '#FFD700' : 'var(--text-primary)' }}>
              {absentRecords.length}
            </h3>
          </div>
          <div style={{ color: activeTab === 'pending' ? '#FFD700' : 'var(--text-secondary)', background: 'rgba(255, 215, 0, 0.05)', padding: 16, borderRadius: 12 }}>
            <Clock size={32} />
          </div>
        </div>

        {/* Tab 2: Lost History */}
        <div 
          onClick={() => setActiveTab('lost')}
          style={{ 
            background: activeTab === 'lost' ? 'rgba(239, 68, 68, 0.03)' : 'var(--bg-secondary)', 
            border: activeTab === 'lost' ? '2px solid #ef4444' : '1px solid var(--border-color)', 
            borderRadius: 16, 
            padding: 24, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          className="hover-scale"
        >
          <div>
            <span style={{ fontSize: 13, color: activeTab === 'lost' ? '#ef4444' : 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Historique des Pertes</span>
            <h3 style={{ margin: '8px 0 0 0', fontSize: 36, fontWeight: 900, color: activeTab === 'lost' ? '#ef4444' : 'var(--text-primary)' }}>
              {lostRecords.length}
            </h3>
          </div>
          <div style={{ color: activeTab === 'lost' ? '#ef4444' : 'var(--text-secondary)', background: 'rgba(239, 68, 68, 0.05)', padding: 16, borderRadius: 12 }}>
            <AlertTriangle size={32} />
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
          placeholder="Rechercher par assuré, sécurité sociale, rangement théorique..."
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

      {/* LIST OF ABSENCES / LOST */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
          <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 16px auto' }} />
          Chargement des données...
        </div>
      ) : activeTab === 'pending' ? (
        filteredAbsents.length === 0 ? (
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
              Félicitations, aucune anomalie physique n'est signalée sur ce site.
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
                      Signalé par : <strong style={{ color: 'var(--text-secondary)' }}>{r.agent_nom_complet ? `${r.agent_nom_complet} (${r.agent_role || 'Agent'})` : (r.agent_signalement_absence || 'Inconnu')}</strong>
                    </div>
                    {r.note_signalement_absence && (
                      <div style={{ marginTop: 8, padding: '8px', background: 'rgba(255, 215, 0, 0.05)', borderRadius: 8, border: '1px solid rgba(255, 215, 0, 0.1)' }}>
                        <span style={{ color: '#FFD700', fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 2 }}>COMMENTAIRE</span>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{r.note_signalement_absence}</div>
                      </div>
                    )}
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
                    {user?.role === 'ADMIN_CENTRE' && (
                      <button 
                        onClick={() => handleEscaladeSite(r.id_carte)}
                        disabled={resolving}
                        style={{ 
                          padding: '12px 24px', 
                          background: 'transparent', 
                          color: '#f97316', 
                          border: '1px solid rgba(249, 115, 22, 0.4)', 
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
                        {resolving ? <RefreshCw size={16} className="animate-spin" /> : 'Escalader au Site'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        filteredLost.length === 0 ? (
          <div style={{ 
            background: 'var(--bg-secondary)', 
            border: '1px dashed var(--border-color)', 
            borderRadius: 16, 
            padding: 48, 
            textAlign: 'center' 
          }}>
            <CheckCircle size={48} style={{ color: '#27ae60', margin: '0 auto 16px auto', opacity: 0.8 }} />
            <h4 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 700 }}>Historique vide</h4>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
              Aucune carte n'est actuellement déclarée perdue sur ce site.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filteredLost.map(r => {
              const reactivating = isReactivating[r.id_carte];
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
                        ❌ PERDUE CONFIRMÉE
                      </span>
                      {r.date_perte && (
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          Perdue le {new Date(r.date_perte).toLocaleDateString()} à {new Date(r.date_perte).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800, textTransform: 'uppercase' }}>
                      {r.noms} {r.prenoms}
                    </h4>
                    <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
                      <span>N° Sécu : {r.num_secu || 'Non renseigné'}</span>
                      <span>Dernier rangement : <strong>{r.rangement || 'Non classé'}</strong></span>
                      {r.site_nom && <span>Centre : {r.site_nom}</span>}
                    </div>
                  </div>

                  {/* Right Column: Actions */}
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button 
                      onClick={() => {
                        setReactivateCardId(r.id_carte);
                        setReactivateRangement(r.rangement || '');
                        setShowReactivateModal(true);
                      }}
                      disabled={reactivating}
                      style={{ 
                        padding: '12px 24px', 
                        background: '#2ecc71', 
                        color: '#000', 
                        border: 'none', 
                        borderRadius: 12, 
                        fontWeight: 700, 
                        fontSize: 14,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        opacity: reactivating ? 0.5 : 1,
                        transition: 'all 0.15s ease'
                      }}
                      className="hover-scale"
                    >
                      {reactivating ? <RefreshCw size={16} className="animate-spin" /> : 'Marquer comme Retrouvée (Réactiver)'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    {/* Reactivation Modal */}
      {showReactivateModal && reactivateCardId !== null && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 11000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            background: 'rgba(2, 6, 23, 0.85)',
            backdropFilter: 'blur(8px)',
            position: 'absolute',
            inset: 0
          }} onClick={() => setShowReactivateModal(false)} />

          <div className="animate-slide-up" style={{
            position: 'relative',
            width: '95%',
            maxWidth: '500px',
            background: '#0f172a',
            borderRadius: '24px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            border: '1px solid rgba(255,255,255,0.1)',
            overflow: 'hidden',
            padding: '32px'
          }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ 
                display: 'inline-flex', 
                padding: 16, 
                background: 'rgba(46, 204, 113, 0.1)', 
                borderRadius: '50%', 
                color: '#2ecc71',
                marginBottom: 16
              }}>
                <CheckCircle size={36} />
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: 22, fontWeight: 800, color: 'white' }}>
                Réactivation de la Carte
              </h3>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>
                Veuillez spécifier le code de rangement où la carte a été réintégrée physiquement.
              </p>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 8, textTransform: 'uppercase' }}>
                Code de Rangement
              </label>
              <input 
                type="text" 
                placeholder="Ex: TK 180"
                value={reactivateRangement}
                onChange={(e) => setReactivateRangement(e.target.value.toUpperCase())}
                className="uppercase"
                style={{
                  width: '100%',
                  padding: '16px',
                  background: '#000',
                  border: '1px solid var(--border-color)',
                  borderRadius: 14,
                  color: '#FFD700',
                  fontSize: 16,
                  fontWeight: 'bold',
                  outline: 'none',
                  textAlign: 'center',
                  transition: 'border-color 0.2s',
                }}
                onFocus={(e) => e.target.style.borderColor = '#FFD700'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-color)'}
              />
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={() => setShowReactivateModal(false)}
                style={{
                  flex: 1,
                  padding: '16px',
                  borderRadius: 14,
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  fontWeight: 850,
                  fontSize: 15,
                  cursor: 'pointer'
                }}
                className="hover-scale"
              >
                Annuler
              </button>
              <button
                onClick={() => handleReactivate(reactivateCardId, reactivateRangement)}
                disabled={!reactivateRangement.trim() || isReactivating[reactivateCardId]}
                style={{
                  flex: 1,
                  padding: '16px',
                  borderRadius: 14,
                  background: '#2ecc71',
                  color: '#000',
                  border: 'none',
                  fontWeight: 850,
                  fontSize: 15,
                  cursor: 'pointer',
                  opacity: (!reactivateRangement.trim() || isReactivating[reactivateCardId]) ? 0.5 : 1
                }}
                className="hover-scale"
              >
                {isReactivating[reactivateCardId] ? <RefreshCw size={16} className="animate-spin" style={{ margin: '0 auto' }} /> : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
