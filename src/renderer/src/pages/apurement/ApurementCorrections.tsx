import React, { useState, useEffect, useCallback, useRef } from 'react';
import { History, Search, ChevronLeft, ChevronRight, CheckCircle2, Clock3, AlertTriangle, Pencil, Undo2, X, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';

const PAGE_SIZE = 20;
const ADMIN_ROLES = ['SUPER ADMIN', 'ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'];

// Présentation du badge de statut de synchro par ligne — même palette que ApurementOverview.tsx
// (pas d'emplacement partagé raisonnable pour un si petit composant, même choix déjà fait pour
// les autres portails opérateurs).
const SYNC_STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; Icon: typeof CheckCircle2 }> = {
  SYNCED: { label: 'Synchronisé', color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.25)', Icon: CheckCircle2 },
  PENDING: { label: 'En attente', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.25)', Icon: Clock3 },
  ERROR: { label: 'Échec', color: '#f87171', bg: 'rgba(248, 113, 113, 0.1)', border: 'rgba(248, 113, 113, 0.25)', Icon: AlertTriangle }
};

function SyncStatusBadge({ status }: { status: string }) {
  const meta = SYNC_STATUS_META[status] || SYNC_STATUS_META.PENDING;
  const { Icon } = meta;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, padding: '3px 8px', borderRadius: 6, fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
      <Icon size={11} /> {meta.label}
    </span>
  );
}

/** "Aujourd'hui" au sens serveur (updated_at) — même convention que la fenêtre de tolérance
 * appliquée côté serveur (corrigerApurementRetirant/annulerApurementDechargement,
 * cartes.queries.ts). Purement informatif ici : l'enforcement réel reste serveur. */
function isUpdatedToday(updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  const todayStr = new Date().toISOString().split('T')[0];
  return updatedAt.slice(0, 10) === todayStr;
}

/**
 * Onglet "Cartes déchargées" du Portail d'Apurement (plan validé — correction/annulation d'un
 * émargement Apurement erroné) : liste paginée des cartes DELIVRE, avec deux actions tracées par
 * ligne (Cas B : corriger les informations du retirant sans changer le statut ; Cas A : annuler
 * complètement un déchargement erroné, retour à EN STOCK). L'enforcement RBAC réel (rôles admin
 * sans limite de temps, OPERATEUR_APUREMENT limité à ses propres émargements du jour même) est
 * appliqué côté serveur (cartes:corrigerApurement/cartes:annulerApurement, voir
 * cartes.queries.ts::assertApurementToleranceWindow) — les indicateurs `isAdmin`/`withinTolerance`
 * ci-dessous ne servent qu'à l'affichage (désactivation informative des boutons), jamais de
 * sécurité côté client.
 */
export default function ApurementCorrections() {
  const { user } = useAuthStore();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);

  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [syncSummary, setSyncSummary] = useState({ synced: 0, pending: 0, error: 0 });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Débounce simple de la recherche (300ms) — évite une requête SQL à chaque frappe, même
  // esprit que le reste de l'app (aucune requête bloquante déclenchée à chaque keystroke).
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const loadList = useCallback(async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      const res = await window.api.stats.getApurementCorrectionsListPaginated(page, PAGE_SIZE, search || undefined);
      setRows(res?.rows || []);
      setTotal(res?.total || 0);
      setSyncSummary(res?.syncSummary || { synced: 0, pending: 0, error: 0 });
    } catch (err) {
      console.error('[ApurementCorrections] Erreur lors du chargement de la liste :', err);
      toast.error('Erreur lors du chargement des cartes déchargées.');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [correctionCarte, setCorrectionCarte] = useState<any | null>(null);
  const [annulationCarte, setAnnulationCarte] = useState<any | null>(null);

  const handleActionSuccess = () => {
    setCorrectionCarte(null);
    setAnnulationCarte(null);
    loadList();
    // Notifie ApurementLayout.tsx (et InventaireLayout.tsx, portails partageant le même
    // événement) pour recalculer dirtyCartesCount/conformeCartesCount, qui pilotent l'état
    // enabled/disabled du bouton "Envoyer les corrections" — même pattern que
    // MissingDataView.tsx/DoublonsView.tsx (AgentQualite).
    window.dispatchEvent(new CustomEvent('app:data-updated'));
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1200, margin: '0 auto', padding: '24px 32px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <History size={20} color="#ec4899" />
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: 'white' }}>Cartes déchargées</h2>
        </div>
        {total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SyncStatusBadge status="SYNCED" />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>{syncSummary.synced}</span>
            <SyncStatusBadge status="PENDING" />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>{syncSummary.pending}</span>
            <SyncStatusBadge status="ERROR" />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{syncSummary.error}</span>
          </div>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
        Corrigez les informations d'un retirant erroné, ou annulez complètement une décharge faite
        par erreur (mauvaise carte). {!isAdmin && 'Vous ne pouvez agir que sur vos propres émargements, le jour même.'}
      </p>

      {/* Recherche */}
      <div className="glass-card" style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, borderRadius: 14 }}>
        <Search size={18} style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder="Rechercher par nom, prénom ou n° sécu..."
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'white', fontSize: 14 }}
        />
        {searchInput && (
          <button onClick={() => setSearchInput('')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="glass-card" style={{ borderRadius: 16, overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement en cours...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
            <History size={48} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            Aucune carte déchargée à afficher.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <th style={{ padding: '16px 20px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Identité</th>
                  <th style={{ padding: '16px 20px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Retirant</th>
                  <th style={{ padding: '16px 20px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Agent / Date</th>
                  <th style={{ padding: '16px 20px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Synchro</th>
                  <th style={{ padding: '16px 20px', fontSize: 12, textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isAgentOwner = !!user && user.role === 'OPERATEUR_APUREMENT' && (r.agent_distributeur || '').trim().toUpperCase() === (user.login || '').trim().toUpperCase();
                  const withinTolerance = isUpdatedToday(r.updated_at);
                  const canAct = isAdmin || (isAgentOwner && withinTolerance);
                  const disabledReason = !canAct
                    ? (isAgentOwner ? "Délai dépassé (jour même uniquement) — contactez un administrateur." : "Vous ne pouvez agir que sur vos propres émargements.")
                    : undefined;
                  return (
                    <tr key={r.id_carte} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                      <td style={{ padding: '16px 20px' }}>
                        <div style={{ fontWeight: 600, color: 'white' }}>{r.noms} {r.prenoms}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {r.num_secu || '—'}{r.rangement ? ` · ${r.rangement}` : ''}
                        </div>
                        {r.apurement_correction_par && (
                          <div style={{ marginTop: 4, fontSize: 11, color: '#f59e0b' }}>
                            Corrigé le {r.apurement_correction_le ? new Date(r.apurement_correction_le).toLocaleString('fr-FR') : '—'} par {r.apurement_correction_par}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '16px 20px' }}>
                        <div style={{ color: 'white', fontSize: 13 }}>{r.nom_retirant || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {r.relation_retirant || ''}{r.num_retirant ? ` · ${r.num_retirant}` : ''}
                        </div>
                      </td>
                      <td style={{ padding: '16px 20px' }}>
                        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{r.agent_distributeur || '—'}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {r.updated_at ? new Date(r.updated_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </div>
                      </td>
                      <td style={{ padding: '16px 20px' }}>
                        <SyncStatusBadge status={r.sync_status} />
                      </td>
                      <td style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} title={disabledReason}>
                          <button
                            onClick={() => setCorrectionCarte(r)}
                            disabled={!canAct}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                              background: canAct ? 'rgba(245, 158, 11, 0.1)' : 'rgba(148, 163, 184, 0.08)',
                              color: canAct ? '#f59e0b' : 'var(--text-muted)',
                              border: `1px solid ${canAct ? 'rgba(245, 158, 11, 0.3)' : 'rgba(148, 163, 184, 0.15)'}`,
                              cursor: canAct ? 'pointer' : 'not-allowed'
                            }}
                          >
                            <Pencil size={13} /> Corriger
                          </button>
                          <button
                            onClick={() => setAnnulationCarte(r)}
                            disabled={!canAct}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                              background: canAct ? 'rgba(239, 68, 68, 0.1)' : 'rgba(148, 163, 184, 0.08)',
                              color: canAct ? '#ef4444' : 'var(--text-muted)',
                              border: `1px solid ${canAct ? 'rgba(239, 68, 68, 0.3)' : 'rgba(148, 163, 184, 0.15)'}`,
                              cursor: canAct ? 'pointer' : 'not-allowed'
                            }}
                          >
                            <Undo2 size={13} /> Annuler la décharge
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
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
              Page {page + 1} sur {totalPages}
            </span>
            <button
              onClick={() => setPage(p => (p + 1 < totalPages ? p + 1 : p))}
              disabled={page + 1 >= totalPages}
              className="btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderRadius: 8, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', background: page + 1 >= totalPages ? 'transparent' : 'rgba(255,255,255,0.05)', color: page + 1 >= totalPages ? 'var(--text-muted)' : 'white', cursor: page + 1 >= totalPages ? 'not-allowed' : 'pointer' }}
            >
              Suivant <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      {correctionCarte && (
        <CorrectionModal carte={correctionCarte} onClose={() => setCorrectionCarte(null)} onSuccess={handleActionSuccess} />
      )}
      {annulationCarte && (
        <AnnulationModal carte={annulationCarte} onClose={() => setAnnulationCarte(null)} onSuccess={handleActionSuccess} />
      )}
    </div>
  );
}

/**
 * Modal de correction (Cas B — plan validé) : les informations du retirant étaient erronées,
 * la carte reste DELIVRE. Gabarit modal-adaptatif-terrain respecté : header fixe (titre +
 * fermeture), body déroulant (formulaire), footer fixe (Annuler / Valider) — jamais coupé sur
 * les petites résolutions terrain (1366x768, cf. skill modal-adaptatif-terrain).
 */
function CorrectionModal({ carte, onClose, onSuccess }: { carte: any; onClose: () => void; onSuccess: () => void }) {
  const [dateDelivrance, setDateDelivrance] = useState((carte.date_delivrance || '').slice(0, 10));
  const [nomRetirant, setNomRetirant] = useState(carte.nom_retirant || '');
  const [numRetirant, setNumRetirant] = useState(carte.num_retirant || '');
  const [relationRetirant, setRelationRetirant] = useState(carte.relation_retirant || 'SOI-MEME');
  const [motif, setMotif] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nomRetirant.trim() || !numRetirant.trim()) {
      toast.error('Le nom et le téléphone du retirant sont obligatoires.');
      return;
    }
    if (!motif.trim()) {
      toast.error('Le motif de la correction est obligatoire.');
      return;
    }
    try {
      setIsSubmitting(true);
      await window.api.cartes.corrigerApurement(carte.id_carte, {
        date_delivrance: dateDelivrance,
        nom_retirant: nomRetirant.trim().toUpperCase(),
        num_retirant: numRetirant.trim(),
        relation_retirant: relationRetirant
      }, motif.trim());
      toast.success('Émargement corrigé avec succès.');
      onSuccess();
    } catch (err: any) {
      toast.error(`Erreur lors de la correction : ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 11000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(8px)', position: 'absolute', inset: 0 }} onClick={onClose} />

      <div className="animate-slide-up" style={{
        position: 'relative', width: '95%', maxWidth: 560, maxHeight: '90vh',
        background: '#0f172a', borderRadius: 24, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column'
      }}>
        {/* Header fixe */}
        <div style={{ padding: '24px 28px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', padding: 10, background: 'rgba(245, 158, 11, 0.1)', borderRadius: 12, color: '#f59e0b' }}>
              <Pencil size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'white' }}>Corriger l'émargement</h3>
              <p style={{ margin: '2px 0 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{carte.noms} {carte.prenoms}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Body déroulant */}
        <form onSubmit={handleSubmit} style={{ overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>DATE DU RETRAIT (Cahier)</label>
              <input
                ref={firstFieldRef}
                className="form-input"
                style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 44, padding: '0 16px', outline: 'none' }}
                type="date"
                value={dateDelivrance}
                onChange={e => setDateDelivrance(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>LIEN DE PARENTÉ</label>
              <select
                className="form-select"
                style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 44, padding: '0 16px', outline: 'none' }}
                value={relationRetirant}
                onChange={e => setRelationRetirant(e.target.value)}
              >
                <option value="SOI-MEME">L'assuré lui-même (Soi-même)</option>
                <option value="CONJOINT">Conjoint (Époux / Épouse)</option>
                <option value="ENFANT">Enfant</option>
                <option value="PARENT">Parent (Père / Mère)</option>
                <option value="FRERE/SOEUR">Frère / Sœur</option>
                <option value="COLLABORATEUR">Collaborateur / Mandataire</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>NOM COMPLET DU RETIRANT *</label>
            <input
              className="form-input"
              style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 44, padding: '0 16px', outline: 'none', textTransform: 'uppercase' }}
              type="text"
              value={nomRetirant}
              onChange={e => setNomRetirant(e.target.value.toUpperCase())}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>N° DE TÉLÉPHONE DU RETIRANT *</label>
            <input
              className="form-input"
              style={{ width: '100%', borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', height: 44, padding: '0 16px', outline: 'none' }}
              type="text"
              value={numRetirant}
              onChange={e => setNumRetirant(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>MOTIF DE LA CORRECTION *</label>
            <textarea
              className="form-input"
              style={{ width: '100%', minHeight: 70, borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: 12, outline: 'none', resize: 'vertical' }}
              placeholder="Ex : Erreur de saisie sur le nom du retirant, corrigé après vérification du cahier."
              value={motif}
              onChange={e => setMotif(e.target.value)}
            />
          </div>
        </form>

        {/* Footer fixe */}
        <div style={{ display: 'flex', gap: 12, padding: '20px 28px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{ flex: 1, padding: 14, borderRadius: 14, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', fontWeight: 700, fontSize: 14, cursor: isSubmitting ? 'not-allowed' : 'pointer' }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{ flex: 1.5, padding: 14, borderRadius: 14, background: '#f59e0b', color: '#000', border: 'none', fontWeight: 800, fontSize: 14, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}
          >
            {isSubmitting ? 'Enregistrement...' : 'Valider la correction'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Modal d'annulation (Cas A — plan validé) : mauvaise carte déchargée, annulation complète
 * (retour à EN STOCK, champs retirant effacés). Style "danger" cohérent avec la gravité de
 * l'action. Même gabarit modal-adaptatif-terrain que CorrectionModal ci-dessus.
 */
function AnnulationModal({ carte, onClose, onSuccess }: { carte: any; onClose: () => void; onSuccess: () => void }) {
  const [motif, setMotif] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const handleConfirm = async () => {
    if (!motif.trim()) {
      toast.error("Le motif de l'annulation est obligatoire.");
      return;
    }
    try {
      setIsSubmitting(true);
      await window.api.cartes.annulerApurement(carte.id_carte, motif.trim());
      toast.success('Décharge annulée — carte remise en stock.');
      onSuccess();
    } catch (err: any) {
      toast.error(`Erreur lors de l'annulation : ${err.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 11000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'rgba(2, 6, 23, 0.85)', backdropFilter: 'blur(8px)', position: 'absolute', inset: 0 }} onClick={onClose} />

      <div className="animate-slide-up" style={{
        position: 'relative', width: '95%', maxWidth: 520, maxHeight: '90vh',
        background: '#0f172a', borderRadius: 24, boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        border: '1px solid rgba(239, 68, 68, 0.2)', overflow: 'hidden',
        display: 'flex', flexDirection: 'column'
      }}>
        {/* Header fixe */}
        <div style={{ padding: '24px 28px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', padding: 10, background: 'rgba(239, 68, 68, 0.1)', borderRadius: 12, color: '#ef4444' }}>
              <RotateCcw size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'white' }}>Annuler la décharge</h3>
              <p style={{ margin: '2px 0 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{carte.noms} {carte.prenoms}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Body déroulant */}
        <div style={{ overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ padding: 16, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 14, display: 'flex', gap: 12 }}>
            <AlertTriangle size={20} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Cette action remet la carte <strong style={{ color: 'white' }}>EN STOCK</strong> et efface les informations du
              retirant actuellement enregistrées ({carte.nom_retirant || 'aucun retirant renseigné'}). L'ancien émargement reste
              consultable dans le journal d'audit. Action tracée, irréversible sans nouvelle intervention.
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>MOTIF DE L'ANNULATION *</label>
            <textarea
              ref={textareaRef}
              className="form-input"
              style={{ width: '100%', minHeight: 90, borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', color: 'white', padding: 12, outline: 'none', resize: 'vertical' }}
              placeholder="Ex : Mauvaise carte sélectionnée par erreur lors de la saisie du cahier historique."
              value={motif}
              onChange={e => setMotif(e.target.value)}
            />
          </div>
        </div>

        {/* Footer fixe */}
        <div style={{ display: 'flex', gap: 12, padding: '20px 28px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            style={{ flex: 1, padding: 14, borderRadius: 14, background: 'transparent', color: 'var(--text-primary)', border: '1px solid var(--border-color)', fontWeight: 700, fontSize: 14, cursor: isSubmitting ? 'not-allowed' : 'pointer' }}
          >
            Retour
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            style={{ flex: 1.5, padding: 14, borderRadius: 14, background: '#ef4444', color: 'white', border: 'none', fontWeight: 800, fontSize: 14, cursor: isSubmitting ? 'not-allowed' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}
          >
            {isSubmitting ? 'Annulation...' : 'Confirmer l\'annulation'}
          </button>
        </div>
      </div>
    </div>
  );
}
