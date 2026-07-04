import React, { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck, CheckCircle, AlertTriangle, Edit3, Save,
  RefreshCw, Search, Database, Award, Trash2, GitMerge,
  Hash, Sparkles, Calendar, KeyRound, Package, TrendingDown
} from 'lucide-react';
import toast from 'react-hot-toast';
import DateInput from '../components/DateInput';
import { useAuthStore } from '../stores/authStore';

type ActiveTab = 'DATES_INVALIDES' | 'DOUBLONS' | 'SANS_SECU' | 'SANS_RANGEMENT';

interface QualityStats {
  doublons: number;
  datesInvalides: number;
  sansSecu: number;
  sansRangement: number;
}

// ─── Compteur Plein Soleil ──────────────────────────────────────────────────
function QualityCounter({
  label, value, icon: Icon, accent, sublabel, onClick, isActive
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent: string;
  sublabel: string;
  onClick: () => void;
  isActive: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        background: isActive
          ? `linear-gradient(135deg, ${accent}22 0%, ${accent}0a 100%)`
          : 'rgba(255,255,255,0.01)',
        border: isActive ? `1.5px solid ${accent}55` : '1px solid rgba(255,255,255,0.06)',
        borderRadius: 20,
        padding: '24px 28px',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Lueur de fond */}
      {isActive && (
        <div style={{
          position: 'absolute', top: -30, right: -30,
          width: 120, height: 120,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${accent}18 0%, transparent 70%)`,
          pointerEvents: 'none'
        }} />
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 14,
          background: `${accent}18`,
          border: `1px solid ${accent}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accent
        }}>
          <Icon size={20} />
        </div>
        {value > 0 && (
          <span style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1,
            color: accent, background: `${accent}15`,
            border: `1px solid ${accent}25`,
            padding: '3px 8px', borderRadius: 20
          }}>
            À traiter
          </span>
        )}
        {value === 0 && (
          <span style={{
            fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1,
            color: '#2ed573', background: 'rgba(46,213,115,0.1)',
            border: '1px solid rgba(46,213,115,0.2)',
            padding: '3px 8px', borderRadius: 20
          }}>
            ✓ OK
          </span>
        )}
      </div>

      <div style={{
        fontSize: 42, fontWeight: 900, color: value > 0 ? accent : '#2ed573',
        lineHeight: 1, marginBottom: 6, letterSpacing: '-2px',
        fontVariantNumeric: 'tabular-nums'
      }}>
        {value.toLocaleString('fr')}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'white', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.3 }}>{sublabel}</div>
    </button>
  );
}

// ─── Composant principal ───────────────────────────────────────────────────
export default function QualiteAssainissementPage() {
  const { user, activeSiteId } = useAuthStore();
  const siteIdToUse = (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id) ?? 1;

  const [activeTab, setActiveTab] = useState<ActiveTab>('DOUBLONS');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [records, setRecords] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<QualityStats>({ doublons: 0, datesInvalides: 0, sansSecu: 0, sansRangement: 0 });
  const [statsLoading, setStatsLoading] = useState(true);

  // Édition en ligne
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isResolving, setIsResolving] = useState<Record<number, boolean>>({});

  // Modales
  const [mergeModal, setMergeModal] = useState<{ isOpen: boolean; target: any; source: any } | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; cardId: number; cardName: string } | null>(null);
  const [saveModal, setSaveModal] = useState<{ isOpen: boolean; cardId: number; label: string; field: 'date_de_naissance' | 'num_secu' | 'rangement'; value: string; oldVal: string } | null>(null);

  const itemsPerPage = 10;

  // ─── Chargement des compteurs de qualité ──────────────────────────────
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [rawDates, rawDoublons, rawSansSecu, rawSansRang] = await Promise.all([
        window.api.cartes.getInvalidDates(siteIdToUse),
        window.api.cartes.getDoublonsPage(siteIdToUse, 0, 1, ''),
        window.api.cartes.getSansNumSecuPage(siteIdToUse, 0, 1, ''),
        window.api.cartes.getSansRangementPage(siteIdToUse, 0, 1, ''),
      ]);
      setStats({
        datesInvalides: (rawDates || []).length,
        doublons: rawDoublons?.total || 0,
        sansSecu: rawSansSecu?.total || 0,
        sansRangement: rawSansRang?.total || 0,
      });
    } catch (err) {
      console.error('Erreur chargement stats qualité:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [siteIdToUse]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // ─── Réinitialiser la page sur changement ─────────────────────────────
  useEffect(() => {
    setCurrentPage(1);
    setEditingId(null);
  }, [searchQuery, activeTab]);

  // ─── Chargement des données paginées ──────────────────────────────────
  const loadTabData = useCallback(async () => {
    setIsLoading(true);
    try {
      const offset = (currentPage - 1) * itemsPerPage;
      let res: { rows: any[], total: number };

      if (activeTab === 'DATES_INVALIDES') {
        const raw = await window.api.cartes.getInvalidDates(siteIdToUse);
        const filtered = (raw || []).filter((r: any) =>
          `${r.noms} ${r.prenoms}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (r.num_secu && r.num_secu.includes(searchQuery)) ||
          (r.rangement && r.rangement.toLowerCase().includes(searchQuery.toLowerCase()))
        );
        res = { rows: filtered.slice(offset, offset + itemsPerPage), total: filtered.length };
      } else if (activeTab === 'DOUBLONS') {
        res = await window.api.cartes.getDoublonsPage(siteIdToUse, offset, itemsPerPage, searchQuery);
      } else if (activeTab === 'SANS_SECU') {
        res = await window.api.cartes.getSansNumSecuPage(siteIdToUse, offset, itemsPerPage, searchQuery);
      } else {
        res = await window.api.cartes.getSansRangementPage(siteIdToUse, offset, itemsPerPage, searchQuery);
      }

      setRecords(res?.rows || []);
      setTotalItems(res?.total || 0);
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors du chargement des données.');
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, currentPage, searchQuery, siteIdToUse]);

  useEffect(() => {
    loadTabData();
  }, [loadTabData]);

  const refreshAll = () => {
    loadStats();
    loadTabData();
  };

  // ─── Handlers d'enregistrement ───────────────────────────────────────
  const handleSaveDate = (card: any) => {
    if (editValue.length !== 10) { toast.error('Format de date invalide (JJ/MM/AAAA)'); return; }
    setSaveModal({ isOpen: true, cardId: card.id_carte, label: `${card.noms} ${card.prenoms}`, field: 'date_de_naissance', value: editValue, oldVal: card.date_de_naissance || '(Vide)' });
  };

  const handleSaveField = (card: any, field: 'num_secu' | 'rangement') => {
    if (!editValue.trim()) { toast.error('La valeur ne peut pas être vide.'); return; }
    if (field === 'num_secu' && editValue.trim().length !== 13) { toast.error('Le numéro de sécurité sociale doit faire exactement 13 chiffres.'); return; }
    setSaveModal({ isOpen: true, cardId: card.id_carte, label: `${card.noms} ${card.prenoms}`, field, value: editValue, oldVal: card[field] || '(Vide)' });
  };

  const executeSave = async () => {
    if (!saveModal) return;
    const { cardId, field, value } = saveModal;
    try {
      setIsResolving(prev => ({ ...prev, [cardId]: true }));
      if (field === 'date_de_naissance') {
        await window.api.cartes.updateDate(cardId, value);
      } else {
        await window.api.cartes.updateQuickFields(cardId, { [field]: value });
      }
      toast.success('Donnée enregistrée !');
      setEditingId(null);
      setSaveModal(null);
      loadTabData();
      loadStats();
    } catch (err) {
      console.error(err);
      toast.error('Erreur lors de la mise à jour.');
    } finally {
      setIsResolving(prev => ({ ...prev, [cardId]: false }));
    }
  };

  const handleDeleteCard = (card: any) => {
    setDeleteModal({ isOpen: true, cardId: card.id_carte, cardName: `${card.noms} ${card.prenoms}` });
  };

  const executeDelete = async () => {
    if (!deleteModal) return;
    try {
      await window.api.cartes.delete(deleteModal.cardId);
      toast.success('Doublon supprimé !');
      setDeleteModal(null);
      loadTabData();
      loadStats();
    } catch (err) {
      toast.error('Impossible de supprimer la carte.');
    }
  };

  const handleMergeCards = (targetCard: any, sourceCard: any) => {
    setMergeModal({ isOpen: true, target: targetCard, source: sourceCard });
  };

  const executeMerge = async () => {
    if (!mergeModal) return;
    const { target, source } = mergeModal;
    try {
      const mergedFields: any = {};
      if (!target.num_secu && source.num_secu) mergedFields.num_secu = source.num_secu;
      if ((!target.rangement || target.rangement === 'NON CLASSE') && source.rangement) mergedFields.rangement = source.rangement;
      if (Object.keys(mergedFields).length > 0) {
        await window.api.cartes.updateQuickFields(target.id_carte, mergedFields);
      }
      await window.api.cartes.delete(source.id_carte);
      toast.success('Cartes fusionnées avec succès !');
      setMergeModal(null);
      loadTabData();
      loadStats();
    } catch (err) {
      toast.error('Erreur lors de la fusion.');
    }
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);

  // Correspondance onglet → compteur
  const tabToStat: Record<ActiveTab, number> = {
    DOUBLONS: stats.doublons,
    DATES_INVALIDES: stats.datesInvalides,
    SANS_SECU: stats.sansSecu,
    SANS_RANGEMENT: stats.sansRangement,
  };

  return (
    <div className="animate-fade-in" style={{ padding: '28px 32px', maxWidth: 1240, margin: '0 auto', color: 'var(--text-primary)' }}>

      {/* ══════════════════════════ HEADER ══════════════════════════════ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{
            width: 60, height: 60,
            background: 'linear-gradient(135deg, #FFD700 0%, #d4af37 100%)',
            borderRadius: 18, color: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(255, 215, 0, 0.2)'
          }}>
            <ShieldCheck size={30} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, letterSpacing: '-0.5px', color: 'white' }}>
              Qualité & Assainissement
            </h1>
            <p style={{ margin: '5px 0 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
              Opérateur Qualité — Intégrité logique, nettoyage des doublons et rangement de la base.
            </p>
          </div>
        </div>
        <button
          className="btn btn-secondary"
          onClick={refreshAll}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12, border: '1px solid var(--border-color)' }}
        >
          <RefreshCw size={16} className={isLoading || statsLoading ? 'animate-spin' : ''} />
          Rafraîchir
        </button>
      </div>

      {/* ══════════════════════ DASHBOARD DE QUALITÉ ════════════════════ */}
      {/* 3 compteurs principaux + 1 compteur secondaire */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
        {/* Compteur 1 — Doublons */}
        <QualityCounter
          label="Doublons Stricts"
          value={statsLoading ? 0 : stats.doublons}
          icon={Database}
          accent="#eccc68"
          sublabel="Fiches identiques à fusionner ou supprimer"
          onClick={() => setActiveTab('DOUBLONS')}
          isActive={activeTab === 'DOUBLONS'}
        />

        {/* Compteur 2 — Dates Invalides */}
        <QualityCounter
          label="Dates Invalides"
          value={statsLoading ? 0 : stats.datesInvalides}
          icon={Calendar}
          accent="#ff7675"
          sublabel="Dates de naissance absentes ou mal formatées"
          onClick={() => setActiveTab('DATES_INVALIDES')}
          isActive={activeTab === 'DATES_INVALIDES'}
        />

        {/* Compteur 3 — CMU Incomplets (Sans Sécu + Sans Rangement) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Sous-compteur Sans Sécu */}
          <button
            onClick={() => setActiveTab('SANS_SECU')}
            style={{
              flex: 1,
              background: activeTab === 'SANS_SECU' ? 'rgba(112,161,255,0.08)' : 'rgba(255,255,255,0.01)',
              border: activeTab === 'SANS_SECU' ? '1.5px solid rgba(112,161,255,0.3)' : '1px solid rgba(255,255,255,0.06)',
              borderRadius: 16, padding: '16px 20px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(112,161,255,0.12)', border: '1px solid rgba(112,161,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#70a1ff' }}>
                <KeyRound size={16} />
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: statsLoading ? 'var(--text-muted)' : (stats.sansSecu > 0 ? '#70a1ff' : '#2ed573'), lineHeight: 1, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
                  {statsLoading ? '…' : stats.sansSecu.toLocaleString('fr')}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 2 }}>Sans Numéro Sécu</div>
              </div>
            </div>
          </button>

          {/* Sous-compteur Sans Rangement */}
          <button
            onClick={() => setActiveTab('SANS_RANGEMENT')}
            style={{
              flex: 1,
              background: activeTab === 'SANS_RANGEMENT' ? 'rgba(46,213,115,0.08)' : 'rgba(255,255,255,0.01)',
              border: activeTab === 'SANS_RANGEMENT' ? '1.5px solid rgba(46,213,115,0.3)' : '1px solid rgba(255,255,255,0.06)',
              borderRadius: 16, padding: '16px 20px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(46,213,115,0.1)', border: '1px solid rgba(46,213,115,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2ed573' }}>
                <Package size={16} />
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: statsLoading ? 'var(--text-muted)' : (stats.sansRangement > 0 ? '#2ed573' : '#2ed573'), lineHeight: 1, letterSpacing: '-1px', fontVariantNumeric: 'tabular-nums' }}>
                  {statsLoading ? '…' : stats.sansRangement.toLocaleString('fr')}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 2 }}>Sans Rangement</div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Score de qualité global */}
      {!statsLoading && (
        <div style={{
          marginBottom: 28, padding: '14px 20px',
          background: 'rgba(255,255,255,0.01)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 14,
          display: 'flex', alignItems: 'center', gap: 16
        }}>
          <Sparkles size={18} style={{ color: '#ffd700', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Score d'intégrité de la base :{' '}
            </span>
            <strong style={{ color: 'white', fontSize: 13 }}>
              {(stats.doublons + stats.datesInvalides + stats.sansSecu + stats.sansRangement) === 0
                ? '✅ Aucune anomalie détectée — Base en parfait état !'
                : `⚠️ ${(stats.doublons + stats.datesInvalides + stats.sansSecu + stats.sansRangement).toLocaleString('fr')} anomalie(s) totale(s) à traiter`
              }
            </strong>
          </div>
          {(stats.doublons + stats.datesInvalides + stats.sansSecu + stats.sansRangement) === 0 && (
            <CheckCircle size={20} style={{ color: '#2ed573', flexShrink: 0 }} />
          )}
          {(stats.doublons + stats.datesInvalides + stats.sansSecu + stats.sansRangement) > 0 && (
            <TrendingDown size={20} style={{ color: '#ffd700', flexShrink: 0 }} />
          )}
        </div>
      )}

      {/* ══════════════════════ SYSTÈME D'ONGLETS ═══════════════════════ */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', gap: 8, marginBottom: 24 }}>
        {[
          { id: 'DOUBLONS', label: '👥 Doublons Stricts', color: '#eccc68', count: stats.doublons },
          { id: 'DATES_INVALIDES', label: '📅 Dates Invalides', color: '#ff7675', count: stats.datesInvalides },
          { id: 'SANS_SECU', label: '🔑 Sans Num. Sécu', color: '#70a1ff', count: stats.sansSecu },
          { id: 'SANS_RANGEMENT', label: '📦 Sans Rangement', color: '#2ed573', count: stats.sansRangement },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id as ActiveTab); setCurrentPage(1); setEditingId(null); }}
            style={{
              padding: '12px 20px', background: 'transparent', border: 'none',
              borderBottom: activeTab === tab.id ? `3px solid ${tab.color}` : '3px solid transparent',
              color: activeTab === tab.id ? 'white' : 'var(--text-secondary)',
              fontWeight: 700, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s ease',
              display: 'flex', alignItems: 'center', gap: 8
            }}
          >
            {tab.label}
            {!statsLoading && tab.count > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 800, color: tab.color,
                background: `${tab.color}18`, border: `1px solid ${tab.color}30`,
                padding: '1px 7px', borderRadius: 20
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════ RECHERCHE ═══════════════════════════════ */}
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: 14, padding: '12px 20px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 16
      }}>
        <Search size={18} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Rechercher par nom, prénom, contact..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 14 }}
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 12 }}>
            Effacer
          </button>
        )}
      </div>

      {/* ══════════════════════ CONTENU ═════════════════════════════════ */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <RefreshCw size={36} className="animate-spin" style={{ color: '#ffd700', margin: '0 auto 16px' }} />
          <p style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Traitement en cours...</p>
        </div>
      ) : records.length === 0 ? (
        <div style={{ background: 'var(--bg-secondary)', border: '1px dashed var(--border-color)', borderRadius: 16, padding: 56, textAlign: 'center' }}>
          <Award size={52} style={{ color: '#2ed573', margin: '0 auto 16px auto', opacity: 0.85 }} />
          <h4 style={{ margin: '0 0 8px 0', fontSize: 17, fontWeight: 800, color: 'white' }}>Intégrité validée !</h4>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 14 }}>Aucune anomalie à résoudre dans cet onglet.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 16 }}>
          <div className="table-container" style={{ overflowX: 'auto' }}>
            <table className="data-table">

              {/* ── ONGLET DOUBLONS ──────────────────────────────────── */}
              {activeTab === 'DOUBLONS' && (
                <>
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 20 }}>Nom & Prénoms</th>
                      <th>Rangement</th>
                      <th>N° Sécu / Contact</th>
                      <th style={{ textAlign: 'right', paddingRight: 20 }}>Actions de Fusion / Suppression</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, i) => {
                      const nextCard = records[i + 1];
                      const prevCard = records[i - 1];
                      const isGroupEnd = !nextCard || nextCard.cle_doublon !== r.cle_doublon;
                      const isGroupStart = !prevCard || prevCard.cle_doublon !== r.cle_doublon;
                      return (
                        <tr key={r.id_carte} style={{
                          background: 'rgba(236,203,104,0.01)',
                          borderLeft: '4px solid #eccc68',
                          borderBottom: isGroupEnd ? '3px solid rgba(255,255,255,0.06)' : '1px solid rgba(255,255,255,0.02)'
                        }}>
                          <td style={{ paddingLeft: 20 }}>
                            <div style={{ fontWeight: 800, color: 'white' }}>{r.noms} {r.prenoms}</div>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>DDN: {r.date_de_naissance || '—'}</span>
                          </td>
                          <td>
                            <span style={{ fontFamily: 'monospace', padding: '3px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}>
                              {r.rangement || 'NON CLASSE'}
                            </span>
                          </td>
                          <td>
                            <div style={{ fontSize: 12 }}>{r.num_secu || '—'}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.contact}</div>
                          </td>
                          <td style={{ textAlign: 'right', paddingRight: 20 }}>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              {isGroupStart && nextCard && nextCard.cle_doublon === r.cle_doublon && (
                                <button className="btn" style={{ background: 'rgba(112,161,255,0.15)', color: '#70a1ff', border: '1px solid rgba(112,161,255,0.25)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 12px', borderRadius: 8 }} onClick={() => handleMergeCards(r, nextCard)}>
                                  <GitMerge size={14} /> Conserver & Fusionner
                                </button>
                              )}
                              {!isGroupStart && prevCard && prevCard.cle_doublon === r.cle_doublon && (
                                <button className="btn" style={{ background: 'rgba(112,161,255,0.15)', color: '#70a1ff', border: '1px solid rgba(112,161,255,0.25)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 12px', borderRadius: 8 }} onClick={() => handleMergeCards(r, prevCard)}>
                                  <GitMerge size={14} /> Conserver & Fusionner
                                </button>
                              )}
                              <button className="btn btn-icon" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.15)', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 8 }} onClick={() => handleDeleteCard(r)}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </>
              )}

              {/* ── ONGLET DATES INVALIDES ───────────────────────────── */}
              {activeTab === 'DATES_INVALIDES' && (
                <>
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 20 }}>Assuré</th>
                      <th>Date Actuelle (Invalide)</th>
                      <th>Correction</th>
                      <th style={{ textAlign: 'right', paddingRight: 20 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(r => (
                      <tr key={r.id_carte}>
                        <td style={{ paddingLeft: 20 }}>
                          <strong>{r.noms} {r.prenoms}</strong><br />
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.num_secu || 'N/A'}</span>
                        </td>
                        <td>
                          <span style={{ color: 'var(--warning-color)', fontWeight: 600, background: 'rgba(243,156,18,0.1)', padding: '4px 8px', borderRadius: 6 }}>
                            {r.date_de_naissance || '(Vide)'}
                          </span>
                        </td>
                        <td>
                          {editingId === r.id_carte
                            ? <DateInput value={editValue} onChange={setEditValue} autoFocus disabled={isResolving[r.id_carte]} />
                            : <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 13 }}>Modification requise</span>
                          }
                        </td>
                        <td style={{ textAlign: 'right', paddingRight: 20 }}>
                          {editingId === r.id_carte ? (
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button className="btn btn-primary" onClick={() => handleSaveDate(r)} disabled={isResolving[r.id_carte]}>
                                {isResolving[r.id_carte] ? <RefreshCw size={14} className="animate-spin" /> : <Save size={16} />}
                              </button>
                              <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Annuler</button>
                            </div>
                          ) : (
                            <button className="btn btn-secondary" onClick={() => { setEditingId(r.id_carte); setEditValue(r.date_de_naissance || ''); }}>
                              <Edit3 size={14} style={{ marginRight: 6 }} /> Corriger la date
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}

              {/* ── ONGLET SANS SÉCU ─────────────────────────────────── */}
              {activeTab === 'SANS_SECU' && (
                <>
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 20 }}>Assuré / Contact</th>
                      <th>Rangement actuel</th>
                      <th>Saisie Numéro Sécurité (13 chiffres)</th>
                      <th style={{ textAlign: 'right', paddingRight: 20 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(r => (
                      <tr key={r.id_carte}>
                        <td style={{ paddingLeft: 20 }}>
                          <strong>{r.noms} {r.prenoms}</strong><br />
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Contact: {r.contact || '—'}</span>
                        </td>
                        <td>
                          <span style={{ fontFamily: 'monospace' }}>{r.rangement || 'NON CLASSE'}</span>
                        </td>
                        <td>
                          {editingId === r.id_carte ? (
                            <input type="text" className="form-input" maxLength={13}
                              style={{ width: 200, height: 36, background: '#0a0e1a', color: 'white', border: '1px solid var(--border-color)' }}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value.replace(/\D/g, ''))}
                            />
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>— (Manquant)</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', paddingRight: 20 }}>
                          {editingId === r.id_carte ? (
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button className="btn btn-primary" onClick={() => handleSaveField(r, 'num_secu')} disabled={isResolving[r.id_carte]}>
                                {isResolving[r.id_carte] ? <RefreshCw size={14} className="animate-spin" /> : <Save size={16} />}
                              </button>
                              <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Annuler</button>
                            </div>
                          ) : (
                            <button className="btn btn-secondary" onClick={() => { setEditingId(r.id_carte); setEditValue(r.num_secu || ''); }}>
                              <Edit3 size={14} style={{ marginRight: 6 }} /> Affecter
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}

              {/* ── ONGLET SANS RANGEMENT ───────────────────────────── */}
              {activeTab === 'SANS_RANGEMENT' && (
                <>
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 20 }}>Assuré / N° Sécu</th>
                      <th>Contact</th>
                      <th>Saisie Emplacement (ex: KM102)</th>
                      <th style={{ textAlign: 'right', paddingRight: 20 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map(r => (
                      <tr key={r.id_carte}>
                        <td style={{ paddingLeft: 20 }}>
                          <strong>{r.noms} {r.prenoms}</strong><br />
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sécu: {r.num_secu || '—'}</span>
                        </td>
                        <td><span>{r.contact || '—'}</span></td>
                        <td>
                          {editingId === r.id_carte ? (
                            <input type="text" className="form-input"
                              style={{ width: 160, height: 36, background: '#0a0e1a', color: 'white', border: '1px solid var(--border-color)', textTransform: 'uppercase' }}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value.toUpperCase())}
                            />
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Non classé</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', paddingRight: 20 }}>
                          {editingId === r.id_carte ? (
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                              <button className="btn btn-primary" onClick={() => handleSaveField(r, 'rangement')} disabled={isResolving[r.id_carte]}>
                                {isResolving[r.id_carte] ? <RefreshCw size={14} className="animate-spin" /> : <Save size={16} />}
                              </button>
                              <button className="btn btn-secondary" onClick={() => setEditingId(null)}>Annuler</button>
                            </div>
                          ) : (
                            <button className="btn btn-secondary" onClick={() => { setEditingId(r.id_carte); setEditValue(r.rangement || ''); }}>
                              <Edit3 size={14} style={{ marginRight: 6 }} /> Affecter
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderTop: '1px solid var(--border-color)', flexWrap: 'wrap', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Affichage de <strong>{totalItems > 0 ? ((currentPage - 1) * itemsPerPage) + 1 : 0}</strong> à <strong>{Math.min(currentPage * itemsPerPage, totalItems)}</strong> sur <strong>{totalItems}</strong> éléments
            </span>
            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} disabled={currentPage === 1} style={{ padding: '8px 16px', fontSize: 13, opacity: currentPage === 1 ? 0.5 : 1, cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}>
                  Précédent
                </button>
                <span style={{ display: 'flex', alignItems: 'center', padding: '0 8px', fontSize: 13, fontWeight: 600 }}>
                  Page {currentPage} sur {totalPages}
                </span>
                <button className="btn btn-secondary" onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} style={{ padding: '8px 16px', fontSize: 13, opacity: currentPage === totalPages ? 0.5 : 1, cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}>
                  Suivant
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════ MODALE DE FUSION ════════════════════════ */}
      {mergeModal?.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5,7,12,0.88)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }} onClick={() => setMergeModal(null)}>
          <div style={{ background: '#0b0f19', border: '1px solid rgba(255,215,0,0.25)', boxShadow: '0 20px 50px rgba(0,0,0,0.5), 0 0 20px rgba(212,175,55,0.05)', borderRadius: 20, width: '100%', maxWidth: 540, padding: 32 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(212,175,55,0.1)', border: '1px solid #d4af37', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffd700' }}>
                <GitMerge size={22} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'white' }}>Confirmation de fusion</h3>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: 12 }}>Assainissement de doublons de cartes</p>
              </div>
            </div>
            <div style={{ background: 'rgba(212,175,55,0.05)', borderLeft: '3px solid #ffd700', padding: '12px 16px', borderRadius: '0 8px 8px 0', marginBottom: 24 }}>
              <p style={{ margin: 0, color: '#ffea79', fontSize: 13, lineHeight: 1.5, fontWeight: 500 }}>
                Les valeurs manquantes de la fiche cible seront complétées et la fiche source sera supprimée définitivement.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: 16, borderRadius: 12 }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', color: '#2ed573', fontWeight: 800, display: 'block', marginBottom: 6 }}>Fiche Cible (Conservée et complétée)</span>
                <strong style={{ fontSize: 14, color: 'white' }}>{mergeModal.target.noms} {mergeModal.target.prenoms}</strong>
                <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>Sécu : {mergeModal.target.num_secu || '—'}</span>
                  <span>Rangement : {mergeModal.target.rangement || '—'}</span>
                </div>
              </div>
              <div style={{ background: 'rgba(239,68,68,0.02)', border: '1px solid rgba(239,68,68,0.1)', padding: 16, borderRadius: 12 }}>
                <span style={{ fontSize: 10, textTransform: 'uppercase', color: '#f87171', fontWeight: 800, display: 'block', marginBottom: 6 }}>Fiche Source (Sera supprimée)</span>
                <strong style={{ fontSize: 14, color: '#f87171' }}>{mergeModal.source.noms} {mergeModal.source.prenoms}</strong>
                <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>Sécu : {mergeModal.source.num_secu || '—'}</span>
                  <span>Rangement : {mergeModal.source.rangement || '—'}</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setMergeModal(null)} style={{ padding: '10px 18px', borderRadius: 10 }}>Annuler</button>
              <button type="button" className="btn btn-primary" onClick={executeMerge} style={{ padding: '10px 22px', borderRadius: 10, background: '#ffd700', color: '#000', fontWeight: 700 }}>Confirmer la fusion</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ MODALE SUPPRESSION ══════════════════════ */}
      {deleteModal?.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5,7,12,0.88)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }} onClick={() => setDeleteModal(null)}>
          <div style={{ background: '#0b0f19', border: '1px solid rgba(239,68,68,0.25)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', borderRadius: 20, width: '100%', maxWidth: 480, padding: 32 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid #f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171' }}>
                <Trash2 size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'white' }}>Supprimer la fiche doublon ?</h3>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: 12 }}>Cette action est irréversible</p>
              </div>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
              Voulez-vous supprimer définitivement la fiche doublon de <strong style={{ color: 'white' }}>{deleteModal.cardName}</strong> ?
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setDeleteModal(null)} style={{ padding: '10px 18px', borderRadius: 10 }}>Annuler</button>
              <button type="button" className="btn" onClick={executeDelete} style={{ padding: '10px 22px', borderRadius: 10, background: '#ef4444', color: '#fff', fontWeight: 700, border: 'none', cursor: 'pointer' }}>Confirmer la suppression</button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ MODALE DE SAUVEGARDE ═══════════════════ */}
      {saveModal?.isOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(5,7,12,0.88)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }} onClick={() => setSaveModal(null)}>
          <div style={{ background: '#0b0f19', border: '1px solid rgba(255,215,0,0.25)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)', borderRadius: 20, width: '100%', maxWidth: 480, padding: 32 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(212,175,55,0.1)', border: '1px solid #ffd700', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffd700' }}>
                <Edit3 size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: 'white' }}>Enregistrer les modifications ?</h3>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: 12 }}>Validation de la correction</p>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-color)', padding: 16, borderRadius: 12, marginBottom: 24 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Modifications apportées à {saveModal.label}</span>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                <div>
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)' }}>Ancienne valeur</span>
                  <span style={{ color: '#f87171', textDecoration: 'line-through' }}>{saveModal.oldVal}</span>
                </div>
                <div style={{ color: '#ffd700', fontWeight: 800 }}>➔</div>
                <div>
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)' }}>Nouvelle valeur</span>
                  <span style={{ color: '#2ed573', fontWeight: 700 }}>{saveModal.value}</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSaveModal(null)} style={{ padding: '10px 18px', borderRadius: 10 }}>Annuler</button>
              <button type="button" className="btn btn-primary" onClick={executeSave} style={{ padding: '10px 22px', borderRadius: 10, background: '#ffd700', color: '#000', fontWeight: 700 }}>Confirmer l'enregistrement</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
