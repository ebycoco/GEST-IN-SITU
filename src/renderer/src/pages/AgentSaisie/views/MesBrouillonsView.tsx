import React, { useState, useEffect } from 'react';
import { Edit2, AlertCircle, FileText, Search, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { confirmService } from '../../../components/confirmService';
import { useAuthStore } from '../../../stores/authStore';
import SaisieEditModal from '../components/SaisieEditModal';

export default function MesBrouillonsView() {
  const { user, activeSiteId } = useAuthStore();
  const [brouillons, setBrouillons] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 25;
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCarte, setSelectedCarte] = useState<any | null>(null);

  // Résolution de site alignée sur le pattern déjà utilisé par SaisiePage.tsx et
  // useDashboardStats.ts : `activeSiteId` (store useAuthStore) ne représente le contexte de
  // site que pour le SUPER ADMIN (sélecteur de site dans la Sidebar) ; pour tous les autres
  // rôles — dont OPERATEUR_SAISIE — `activeSiteId` reste TOUJOURS null (voir
  // useAuthStore.login(): initialSiteId n'est peuplé que pour ADMINISTRATEUR_SITE/ADMIN_CENTRE)
  // et le site réel de l'utilisateur est `user.site_id`. C'était la cause racine confirmée du
  // blocage permanent sur "Chargement en cours..." : `if (!activeSiteId) return;` était
  // TOUJOURS vrai pour OPERATEUR_SAISIE, empêchant fetchBrouillons() de jamais s'exécuter (et
  // donc `isLoading` de jamais repasser à false).
  const effectiveSiteId = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;

  const fetchBrouillons = async () => {
    if (!effectiveSiteId) {
      // Ne jamais laisser isLoading bloqué à true par un retour anticipé : si le site effectif
      // n'est pas (encore) disponible, on referme explicitement l'état de chargement.
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      const res = await window.api.cartes.getPage(page * limit, limit, { statut: 'BROUILLON', site_id: effectiveSiteId.toString(), created_by: user?.id_user?.toString() });
      setBrouillons(res.rows || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error("Erreur lors de la récupération des brouillons:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (carte: any) => {
    const isConfirmed = await confirmService.confirm({
      title: "Supprimer le brouillon",
      message: `Voulez-vous vraiment supprimer le brouillon de ${carte.noms} ${carte.prenoms} ? Cette action est irréversible.`,
      isDanger: true
    });

    if (isConfirmed) {
      try {
        await window.api.cartes.delete(carte.id_carte, user);
        toast.success("Brouillon supprimé avec succès.");
        fetchBrouillons();
      } catch (err: any) {
        console.error("Erreur de suppression:", err);
        toast.error("Erreur lors de la suppression : " + err.message);
      }
    }
  };

  useEffect(() => {
    fetchBrouillons();

    const handleDataUpdated = () => fetchBrouillons();
    window.addEventListener('app:data-updated', handleDataUpdated);
    return () => window.removeEventListener('app:data-updated', handleDataUpdated);
  }, [user, effectiveSiteId, page]);

  const handlePublishAll = async () => {
    if (total === 0) return;
    const isConfirmed = await confirmService.confirm({
      title: `Valider et publier ${total} brouillon(s) ?`,
      message: `Attention : Ces fiches vont passer au statut "En Stock". Elles seront automatiquement transmises vers le serveur Cloud (Supabase) dès que votre poste est connecté à Internet.`,
      isDanger: false,
      confirmText: "Oui, valider et envoyer vers le Cloud",
      cancelText: "Conserver en brouillon"
    });

    if (isConfirmed) {
      try {
        setIsLoading(true);
        const res = await window.api.cartes.publishDrafts(effectiveSiteId as number, user);
        if (res.skippedInvalidDateCount > 0) {
          toast.success(`${res.publishedCount} brouillon(s) publié(s) avec succès ! ⚠️ ${res.skippedInvalidDateCount} brouillon(s) ignoré(s) car leur date de naissance est invalide ou manquante — corrigez-les avant de réessayer.`);
        } else {
          toast.success(`${res.publishedCount} brouillon(s) publié(s) avec succès !`);
        }
        setPage(0);
        fetchBrouillons();
        window.dispatchEvent(new CustomEvent('app:data-updated'));
      } catch (err: any) {
        console.error("Erreur de publication:", err);
        toast.error("Erreur lors de la publication : " + err.message);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const filteredBrouillons = brouillons.filter(s => 
    s.noms.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.prenoms.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.num_secu?.includes(searchTerm)
  );

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200, margin: '0 auto' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'white' }}>Vos brouillons locaux</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0 0' }}>Ces cartes ne seront pas synchronisées vers Supabase tant que vous ne cliquerez pas sur "Envoyer mes brouillons".</p>
        </div>
        
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <button 
            onClick={handlePublishAll}
            disabled={total === 0 || isLoading}
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', borderRadius: 8, color: 'white', fontWeight: 600, cursor: total === 0 ? 'not-allowed' : 'pointer', opacity: total === 0 ? 0.5 : 1 }}
          >
            VALIDER TOUS LES BROUILLONS ({total})
          </button>
          
          <div style={{ position: 'relative', width: 250 }}>
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
      </div>

      <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement en cours...</div>
        ) : filteredBrouillons.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <FileText size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            Aucun brouillon trouvé.
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
              {filteredBrouillons.map((saisie) => {
                const canEdit = saisie.is_dirty === 1 && saisie.statut === 'BROUILLON';
                
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
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: 'rgba(255, 152, 0, 0.1)', color: '#ff9800', fontSize: 12, fontWeight: 600 }}>
                        <AlertCircle size={14} /> Brouillon
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      {canEdit ? (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                          <button 
                            title="Modifier"
                            className="btn-outline"
                            style={{ padding: '6px 12px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'white', cursor: 'pointer', transition: 'background 0.2s' }}
                            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                            onClick={() => setSelectedCarte(saisie)}
                          >
                            <Edit2 size={14} /> Modifier
                          </button>
                          <button 
                            title="Supprimer"
                            className="btn-outline"
                            style={{ padding: '6px 12px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#ef4444', cursor: 'pointer', transition: 'background 0.2s' }}
                            onMouseOver={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.2)'}
                            onMouseOut={(e) => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
                            onClick={() => handleDelete(saisie)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
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
        {total > limit && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, padding: '16px', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: page === 0 ? 'transparent' : 'rgba(255,255,255,0.05)', color: page === 0 ? 'var(--text-muted)' : 'white', cursor: page === 0 ? 'not-allowed' : 'pointer' }}
            >
              <ChevronLeft size={16} /> Précédent
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Page {page + 1} sur {Math.ceil(total / limit) || 1}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * limit >= total}
              className="btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: (page + 1) * limit >= total ? 'transparent' : 'rgba(255,255,255,0.05)', color: (page + 1) * limit >= total ? 'var(--text-muted)' : 'white', cursor: (page + 1) * limit >= total ? 'not-allowed' : 'pointer' }}
            >
              Suivant <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {selectedCarte && (
        <SaisieEditModal 
          carte={selectedCarte} 
          onClose={() => setSelectedCarte(null)} 
          onSuccess={() => {
            setSelectedCarte(null);
            fetchBrouillons();
          }} 
        />
      )}

    </div>
  );
}
