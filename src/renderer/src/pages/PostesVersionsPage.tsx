import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { MonitorSmartphone, RefreshCw, WifiOff, ShieldAlert, Info, AlertTriangle, MapPin, Filter, X } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import type { PosteVersionRow, PostesVersionsError, PostesVersionsResult } from '../../../shared/types';
import {
  pickReferenceVersion,
  computeRowState,
  summarize,
  sortByLateness,
  sortByColumn,
  formatRelative,
  formatAbsolute,
  SILENT_AFTER_DAYS,
  type PosteState,
  type PosteVersionState,
  type PosteRowState,
  type SortKey,
  type SortDir,
} from './postesVersionsStatus';

// ============================================================================
// Écran SUPER ADMIN « Versions des postes » (docs/PLAN_ECRAN_VERSIONS_POSTES.md,
// choix 4). Consomme window.api.versions.getPostes() (handler `versions:getPostes`,
// qui ne lève jamais : { success:false, error }). Aucune actualisation automatique :
// une lecture au montage + bouton « Actualiser ». Tout le calcul d'état et de tri est
// dans postesVersionsStatus.ts (logique pure).
//
// Mise en page : colonne flex qui occupe la hauteur de la fenêtre ; en-tête, synthèse
// et filtres compacts ; UN SEUL défilement (la zone du tableau, en-tête collant).
// ============================================================================

/** Au-delà de ce nombre de lignes, une alerte invite à affiner (plafond serveur 1000). */
const LARGE_LIST_THRESHOLD = 200;
const NO_SITE = '__NO_SITE__';
/** En dessous de cette largeur (px) de la zone du tableau, « Première vue » est masquée (repli en infobulle). */
const COMPACT_BELOW_PX = 1000;

const STATE_META: Record<PosteState, { label: string; color: string; bg: string; border: string }> = {
  A_JOUR: { label: 'À jour', color: '#34d399', bg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.35)' },
  EN_RETARD: { label: 'En retard', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.14)', border: 'rgba(251, 146, 60, 0.4)' },
  INCONNU: { label: 'Inconnu', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.3)' },
  SILENCIEUX: { label: 'Silencieux', color: '#f87171', bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.4)' },
};

const ERROR_MESSAGES: Record<PostesVersionsError, string> = {
  FORBIDDEN: "Accès réservé au SUPER ADMIN. Votre session ne permet pas de consulter les versions des postes.",
  OFFLINE: 'Connexion Internet requise. Reconnectez ce poste puis cliquez sur « Actualiser » (ou utilisez « Réessayer » dans la barre de connexion).',
  NO_CLIENT: "Le service cloud n'est pas configuré sur ce poste : impossible de lire les versions des postes.",
  TIMEOUT: 'Le serveur met trop de temps à répondre. Réessayez dans un instant avec « Actualiser ».',
  RPC_ERROR: 'Le serveur a refusé la lecture des versions des postes. Réessayez plus tard ou contactez le support.',
  LOCAL_ERROR: 'Lecture de la base locale impossible (noms des sites et agents). Réessayez ou relancez l\'application.',
  INTERNAL: 'Erreur interne lors de la lecture des versions des postes. Réessayez.',
};

function errorMessage(code: string): string {
  return (ERROR_MESSAGES as Record<string, string>)[code] ?? ERROR_MESSAGES.INTERNAL;
}

type StateFilter = 'ALL' | PosteState;
type SuccessResult = Extract<PostesVersionsResult, { success: true }>;

interface Item {
  row: PosteVersionRow;
  info: PosteRowState;
}

interface SortState {
  key: SortKey;
  dir: SortDir;
}

function Badge({ state, small }: { state: PosteState; small?: boolean }) {
  const m = STATE_META[state];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', background: m.bg, color: m.color, border: `1px solid ${m.border}`,
        padding: small ? '1px 6px' : '2px 8px', borderRadius: 20, fontSize: small ? 10 : 12, fontWeight: 800,
        letterSpacing: '0.04em', whiteSpace: 'nowrap',
      }}
    >
      {m.label}
    </span>
  );
}

function formatHour(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export default function PostesVersionsPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER ADMIN';

  // Dernière lecture RÉUSSIE (conservée si une actualisation suivante échoue, sauf FORBIDDEN).
  const [data, setData] = useState<SuccessResult | null>(null);
  const [dataAt, setDataAt] = useState<number>(() => Date.now());
  // Erreur de la dernière tentative (null si elle a réussi).
  const [loadError, setLoadError] = useState<PostesVersionsError | null>(null);
  const [loading, setLoading] = useState(true);
  const [siteFilter, setSiteFilter] = useState<string>('ALL');
  const [stateFilter, setStateFilter] = useState<StateFilter>('ALL');
  const [sort, setSort] = useState<SortState | null>(null);
  // Bandeau d'information : état en mémoire du composant uniquement.
  const [infoOpen, setInfoOpen] = useState(true);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  // Mode compact : largeur de la zone du tableau mesurée par ResizeObserver.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);

  const load = useCallback(async () => {
    const reqId = ++requestRef.current;
    setLoading(true);
    let res: PostesVersionsResult;
    try {
      if (!window.api?.versions?.getPostes) {
        res = { success: false, error: 'INTERNAL' };
      } else {
        res = await window.api.versions.getPostes();
      }
    } catch {
      // Le handler ne lève pas, mais le pont IPC peut échouer : message générique.
      res = { success: false, error: 'INTERNAL' };
    }
    // Ignore une réponse périmée (démontage ou nouvelle requête lancée entre-temps).
    if (!mountedRef.current || reqId !== requestRef.current) return;
    if (res.success) {
      setData(res);
      setDataAt(Date.now());
      setLoadError(null);
    } else {
      setLoadError(res.error);
      // FORBIDDEN : ne rien conserver. Autre erreur : on garde les anciennes lignes (grisées).
      if (res.error === 'FORBIDDEN') setData(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // Libère l'overlay global « Chargement sécurisé… » si cette page est le premier écran
    // consulté après connexion (même réflexe que AgentsPresencePage).
    useAuthStore.getState().setInitialDataLoading(false);
    if (isSuperAdmin) {
      void load();
    } else {
      setLoading(false);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [load, isSuperAdmin]);

  useEffect(() => {
    if (!scrollEl) return;
    const apply = (w: number) => setCompact((prev) => {
      const next = w > 0 && w < COMPACT_BELOW_PX;
      return prev === next ? prev : next;
    });
    apply(scrollEl.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) apply(e.contentRect.width);
    });
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl]);

  const ok = isSuperAdmin ? data : null;
  const errorCode: PostesVersionsError | null = !isSuperAdmin ? 'FORBIDDEN' : loadError;
  const stale = !!ok && !!errorCode; // anciennes données conservées malgré l'erreur

  const reference = useMemo(() => (ok ? pickReferenceVersion(ok.latestVersion, ok.rows) : null), [ok]);

  const items: Item[] = useMemo(() => {
    if (!ok) return [];
    const list = ok.rows.map((row) => ({ row, info: computeRowState(row, reference, dataAt) }));
    return sortByLateness(list);
  }, [ok, reference, dataAt]);

  const summary = useMemo(() => summarize(items.map((i) => i.info.state)), [items]);

  const siteOptions = useMemo(() => {
    const map = new Map<string, string>();
    let hasNone = false;
    for (const { row } of items) {
      if (row.site_sync_id) map.set(row.site_sync_id, row.site_nom || row.site_sync_id.slice(0, 8));
      else hasNone = true;
    }
    const list = [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
    if (hasNone) list.push([NO_SITE, 'Sans site']);
    return list;
  }, [items]);

  const visible = useMemo(() => {
    const filtered = items.filter(({ row, info }) => {
      if (siteFilter !== 'ALL' && (row.site_sync_id ?? NO_SITE) !== siteFilter) return false;
      if (stateFilter !== 'ALL' && info.state !== stateFilter) return false;
      return true;
    });
    return sort ? sortByColumn(filtered, sort.key, sort.dir) : filtered;
  }, [items, siteFilter, stateFilter, sort]);

  // Clic sur un en-tête : asc → desc → retour au tri par défaut.
  const toggleSort = useCallback((key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }, []);

  const selectStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255, 215, 0, 0.25)',
    borderRadius: 8,
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: 600,
    padding: '5px 10px',
    cursor: 'pointer',
    outline: 'none',
    colorScheme: 'dark',
  };

  const bannerStyle = (c: string, bg: string, br: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'flex-start', gap: 10, background: bg, border: `1px solid ${br}`,
    borderRadius: 10, padding: '7px 12px', color: c, fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, flexShrink: 0,
  });

  const summaryCards: Array<{ key: string; label: string; value: number; color: string }> = [
    { key: 'total', label: 'Postes', value: summary.total, color: '#ffd700' },
    { key: 'A_JOUR', label: 'À jour', value: summary.A_JOUR, color: STATE_META.A_JOUR.color },
    { key: 'EN_RETARD', label: 'En retard', value: summary.EN_RETARD, color: STATE_META.EN_RETARD.color },
    { key: 'INCONNU', label: 'Inconnus', value: summary.INCONNU, color: STATE_META.INCONNU.color },
    { key: 'SILENCIEUX', label: `Silencieux (> ${SILENT_AFTER_DAYS} j)`, value: summary.SILENCIEUX, color: STATE_META.SILENCIEUX.color },
  ];

  const columns: Array<{ key: SortKey; label: string }> = [
    { key: 'poste', label: 'Poste' },
    { key: 'site', label: 'Site' },
    { key: 'version', label: 'Version' },
    { key: 'etat', label: 'État' },
    { key: 'lastSeen', label: 'Dernière remontée' },
    { key: 'user', label: 'Dernier utilisateur' },
  ];

  const renderTh = (c: { key: SortKey; label: string }) => {
    const active = sort?.key === c.key;
    const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return (
      <th key={c.key} aria-sort={ariaSort}>
        <button
          type="button"
          className={`pv-th-btn${active ? ' pv-th-active' : ''}`}
          onClick={() => toggleSort(c.key)}
          title={`Trier par « ${c.label} »`}
        >
          <span>{c.label}</span>
          <span className="pv-sort-ind" aria-hidden="true">{active ? (sort!.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
        </button>
      </th>
    );
  };

  return (
    <div className="animate-fade-in pv-root">
      <style dangerouslySetInnerHTML={{ __html: `
        .pv-root { --pv-muted: #a3a8c0; display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; box-sizing: border-box; padding: 12px 20px 10px; overflow: hidden; }
        .pv-card { background: rgba(26, 31, 74, 0.45); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; }
        .pv-btn { background: rgba(255, 215, 0, 0.14); border: 1px solid rgba(255, 215, 0, 0.45); color: #ffd700; padding: 7px 14px; border-radius: 10px; font-weight: 800; font-size: 13px; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: background 0.2s ease; }
        .pv-btn:hover:not(:disabled) { background: rgba(255, 215, 0, 0.26); }
        .pv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .pv-btn-icon { padding: 7px 9px; }
        .pv-btn-icon[aria-pressed="true"] { background: rgba(96, 165, 250, 0.18); border-color: rgba(96, 165, 250, 0.5); color: #93c5fd; }
        .pv-x { background: transparent; border: none; color: inherit; cursor: pointer; padding: 2px; display: flex; flex-shrink: 0; opacity: 0.8; }
        .pv-x:hover { opacity: 1; }
        .pv-spin { animation: pv-spin 1s linear infinite; }
        .pv-scroll { flex: 1 1 auto; min-height: 160px; overflow: auto; }
        .pv-table { width: 100%; border-collapse: collapse; text-align: left; }
        .pv-table th { position: sticky; top: 0; background: #11163a; z-index: 1; padding: 0; border-bottom: 1px solid rgba(255,255,255,0.08); white-space: nowrap; }
        .pv-th-btn { display: flex; align-items: center; gap: 5px; width: 100%; background: transparent; border: none; cursor: pointer; font-size: 11px; font-weight: 700; color: var(--pv-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 8px; text-align: left; }
        .pv-th-btn:hover { color: #e2e8f0; }
        .pv-th-btn:focus-visible { outline: 2px solid #ffd700; outline-offset: -2px; }
        .pv-th-active { color: #ffd700; }
        .pv-sort-ind { font-size: 9px; opacity: 0.45; }
        .pv-th-active .pv-sort-ind { opacity: 1; }
        .pv-table td { font-size: 13px; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--text-secondary); vertical-align: middle; white-space: nowrap; }
        .pv-table tr:hover td { background: rgba(255,255,255,0.03); }
        .pv-site { min-width: 150px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
        .pv-user { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
        /* Données périmées : voile par désaturation (texte à pleine opacité => contraste préservé) + bordure pointillée. */
        .pv-stale { filter: grayscale(0.8); }
        .pv-stale-card { border-style: dashed; border-color: rgba(248, 113, 113, 0.45); }
        /* Zone étroite (< 1000 px) : « Première vue » masquée, marges et largeurs resserrées. */
        .pv-compact .pv-table td { padding: 6px 5px; }
        .pv-compact .pv-th-btn { padding: 8px 5px; }
        .pv-compact .pv-site { min-width: 100px; max-width: 150px; }
        .pv-chip { flex: 1 1 0; min-width: 0; display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 5px 12px; }
        .pv-chip-label { font-size: 10.5px; font-weight: 700; color: var(--pv-muted); text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pv-chip-value { font-size: 20px; font-weight: 800; line-height: 1.1; }
        @keyframes pv-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}} />

      {/* En-tête compact */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div style={{ background: 'linear-gradient(135deg, #ffd700 0%, #b8860b 100%)', width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <MonitorSmartphone size={16} color="black" />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', margin: 0, whiteSpace: 'nowrap' }}>Versions des postes</h2>
          <span style={{ fontSize: 12, color: 'var(--pv-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Version installée de chaque poste, comparée à la dernière version publiée.
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="pv-btn pv-btn-icon"
            aria-pressed={infoOpen}
            title={infoOpen ? "Masquer la note d'information" : "Afficher la note d'information"}
            onClick={() => setInfoOpen((v) => !v)}
          >
            <Info size={16} />
          </button>
          <button className="pv-btn" disabled={loading || !isSuperAdmin} onClick={() => void load()}>
            <RefreshCw size={16} className={loading ? 'pv-spin' : ''} />
            <span>Actualiser</span>
          </button>
        </div>
      </div>

      {/* Bandeau d'information (fermable) */}
      {infoOpen && (
        <div style={bannerStyle('#93c5fd', 'rgba(96, 165, 250, 0.1)', 'rgba(96, 165, 250, 0.3)')}>
          <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ flex: 1 }}>
            Seuls les postes ayant installé une version qui embarque cette fonction se déclarent ici. Un poste absent de la
            liste n'a pas forcément échoué : il n'a peut-être pas encore été mis à jour ou lancé.
          </span>
          <button type="button" className="pv-x" aria-label="Fermer la note d'information" title="Fermer" onClick={() => setInfoOpen(false)}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Erreur (avec ou sans anciennes données conservées) */}
      {errorCode && (
        <div role="alert" style={bannerStyle('#f87171', 'rgba(248, 113, 113, 0.1)', 'rgba(248, 113, 113, 0.35)')}>
          {errorCode === 'OFFLINE' ? <WifiOff size={16} style={{ flexShrink: 0, marginTop: 1 }} /> : <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>
            {stale
              ? `Données du ${formatHour(dataAt)} — actualisation impossible : ${errorMessage(errorCode)}`
              : errorMessage(errorCode)}
          </span>
        </div>
      )}

      {ok && (
        <>
          {(ok.truncated || ok.rows.length > LARGE_LIST_THRESHOLD) && (
            <div role="alert" style={bannerStyle('#fbbf24', 'rgba(251, 191, 36, 0.1)', 'rgba(251, 191, 36, 0.35)')}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                {ok.truncated
                  ? `Liste tronquée : ${ok.counts.nb_listables} postes sont déclarés, seuls ${ok.rows.length} sont affichés. Les synthèses ci-dessous ne portent que sur les lignes affichées.`
                  : `Liste volumineuse (${ok.rows.length} postes) : utilisez les filtres par site et par état pour la parcourir.`}
              </span>
            </div>
          )}

          {/* Synthèse (ligne compacte, grisée si les données sont conservées après une erreur) */}
          <div className={stale ? 'pv-stale' : undefined} style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {summaryCards.map((c) => (
              <div key={c.key} className="pv-card pv-chip">
                <span className="pv-chip-label" title={c.label}>{c.label}</span>
                <span className="pv-chip-value" style={{ color: c.color }}>{c.value}</span>
              </div>
            ))}
          </div>

          {/* Filtres + référence sur une ligne compacte */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 14px', flexShrink: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pv-muted)' }}>
              <MapPin size={14} />
              <span>Site</span>
              <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} style={selectStyle}>
                <option value="ALL" style={{ background: '#0d111b' }}>Tous les sites</option>
                {siteOptions.map(([id, nom]) => (
                  <option key={id} value={id} style={{ background: '#0d111b' }}>{nom}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--pv-muted)' }}>
              <Filter size={14} />
              <span>État</span>
              <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as StateFilter)} style={selectStyle}>
                <option value="ALL" style={{ background: '#0d111b' }}>Tous les états</option>
                {(['EN_RETARD', 'SILENCIEUX', 'INCONNU', 'A_JOUR'] as PosteState[]).map((s) => (
                  <option key={s} value={s} style={{ background: '#0d111b' }}>{STATE_META[s].label}</option>
                ))}
              </select>
            </label>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Référence : <strong style={{ color: '#ffd700' }}>{reference ?? 'inconnue'}</strong>
              {reference && !ok.latestVersion ? ' (plus haute vue)' : ''}
              {' · '}ce poste : <strong style={{ color: 'var(--text-primary)' }}>{ok.currentVersion}</strong>
            </span>
            <span style={{ fontSize: 12, color: 'var(--pv-muted)' }}>
              {visible.length} poste{visible.length > 1 ? 's' : ''} affiché{visible.length > 1 ? 's' : ''}
              {' · '}données lues le {formatAbsolute(new Date(dataAt).toISOString())}
            </span>
          </div>
        </>
      )}

      {/* Corps : chargement / vide / tableau */}
      {loading && !ok ? (
        <div className="pv-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 180, color: 'var(--pv-muted)', fontSize: 13, flexShrink: 0 }}>
          <RefreshCw size={26} className="pv-spin" color="#ffd700" />
          <span>Chargement des versions des postes...</span>
        </div>
      ) : ok && ok.rows.length === 0 ? (
        <div className="pv-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 140, color: 'var(--pv-muted)', fontSize: 14, fontWeight: 600, textAlign: 'center', padding: 16, flexShrink: 0 }}>
          Aucun poste ne s'est encore déclaré.
        </div>
      ) : ok ? (
        <div className={`pv-card${stale ? ' pv-stale pv-stale-card' : ''}`} style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', opacity: loading && !stale ? 0.6 : 1, transition: 'opacity 0.2s ease' }}>
          {visible.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--pv-muted)', fontSize: 13 }}>
              Aucun poste ne correspond à ces filtres.
            </div>
          ) : (
            <div className={`pv-scroll${compact ? ' pv-compact' : ''}`} ref={setScrollEl}>
              <table className="pv-table">
                <thead>
                  <tr>
                    {columns.map(renderTh)}
                    {!compact && (
                      <th>
                        <span className="pv-th-btn" style={{ cursor: 'default' }}>Première vue</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ row, info }, idx) => {
                    const showVersionBadge = info.silent && info.versionState !== 'INCONNU';
                    const site = row.site_nom || '';
                    const login = row.last_user_login || '';
                    return (
                      <tr key={`${row.poste_ref}-${idx}`}>
                        <td title={row.key_kind ? `Clé : ${row.key_kind}` : undefined}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Poste</span>{' '}
                          <span style={{ fontFamily: 'Consolas, monospace', color: '#ffd700', fontWeight: 700 }}>{row.poste_ref}</span>
                          {row.key_kind && (
                            <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--pv-muted)', opacity: 0.8 }}>{row.key_kind}</span>
                          )}
                        </td>
                        <td className="pv-site" title={site || undefined}>{site || '—'}</td>
                        <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{row.app_version || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <Badge state={info.state} />
                            {showVersionBadge && <Badge state={info.versionState as PosteVersionState} small />}
                          </div>
                        </td>
                        <td title={compact ? `${formatAbsolute(row.last_seen_at)}\nPremière vue : ${formatAbsolute(row.first_seen_at)}` : formatAbsolute(row.last_seen_at)}>
                          {formatRelative(row.last_seen_at, dataAt)}
                        </td>
                        <td className="pv-user" title={login || undefined}>{login || '—'}</td>
                        {!compact && (
                          <td title={formatAbsolute(row.first_seen_at)}>
                            {formatAbsolute(row.first_seen_at)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
