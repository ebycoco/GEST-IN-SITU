import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { MonitorSmartphone, RefreshCw, WifiOff, ShieldAlert, Info, AlertTriangle, MapPin, Filter } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import type { PosteVersionRow, PostesVersionsError, PostesVersionsResult } from '../../../shared/types';
import {
  pickReferenceVersion,
  computeRowState,
  summarize,
  sortByLateness,
  formatRelative,
  formatAbsolute,
  SILENT_AFTER_DAYS,
  type PosteState,
  type PosteVersionState,
  type PosteRowState,
} from './postesVersionsStatus';

// ============================================================================
// Écran SUPER ADMIN « Versions des postes » (docs/PLAN_ECRAN_VERSIONS_POSTES.md,
// choix 4). Consomme window.api.versions.getPostes() (handler `versions:getPostes`,
// qui ne lève jamais : { success:false, error }). Aucune actualisation automatique :
// une lecture au montage + bouton « Actualiser ». Tout le calcul d'état est dans
// postesVersionsStatus.ts (logique pure).
// ============================================================================

/** Au-delà de ce nombre de lignes, une alerte invite à affiner (plafond serveur 1000). */
const LARGE_LIST_THRESHOLD = 200;
const NO_SITE = '__NO_SITE__';

const STATE_META: Record<PosteState, { label: string; color: string; bg: string; border: string }> = {
  A_JOUR: { label: 'À jour', color: '#34d399', bg: 'rgba(52, 211, 153, 0.12)', border: 'rgba(52, 211, 153, 0.35)' },
  EN_RETARD: { label: 'En retard', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.14)', border: 'rgba(251, 146, 60, 0.4)' },
  INCONNU: { label: 'Inconnu', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.3)' },
  SILENCIEUX: { label: 'Silencieux', color: '#f87171', bg: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.4)' },
};

const ERROR_MESSAGES: Record<PostesVersionsError, string> = {
  FORBIDDEN: "Accès réservé au SUPER ADMIN. Votre session ne permet pas de consulter les versions des postes.",
  OFFLINE: 'Connexion Internet requise. Reconnectez ce poste puis cliquez sur « Actualiser ».',
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

interface Item {
  row: PosteVersionRow;
  info: PosteRowState;
}

function Badge({ state, small }: { state: PosteState; small?: boolean }) {
  const m = STATE_META[state];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', background: m.bg, color: m.color, border: `1px solid ${m.border}`,
        padding: small ? '1px 6px' : '3px 9px', borderRadius: 20, fontSize: small ? 10 : 12, fontWeight: 800,
        letterSpacing: '0.04em', whiteSpace: 'nowrap',
      }}
    >
      {m.label}
    </span>
  );
}

export default function PostesVersionsPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER ADMIN';

  const [result, setResult] = useState<PostesVersionsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number>(() => Date.now());
  const [siteFilter, setSiteFilter] = useState<string>('ALL');
  const [stateFilter, setStateFilter] = useState<StateFilter>('ALL');
  const mountedRef = useRef(true);
  const requestRef = useRef(0);

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
    setResult(res);
    setLoadedAt(Date.now());
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

  const ok = result && result.success ? result : null;
  const errorCode: PostesVersionsError | null = !isSuperAdmin
    ? 'FORBIDDEN'
    : result && !result.success
      ? result.error
      : null;

  const reference = useMemo(() => (ok ? pickReferenceVersion(ok.latestVersion, ok.rows) : null), [ok]);

  const items: Item[] = useMemo(() => {
    if (!ok) return [];
    const list = ok.rows.map((row) => ({ row, info: computeRowState(row, reference, loadedAt) }));
    return sortByLateness(list);
  }, [ok, reference, loadedAt]);

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

  const visible = useMemo(
    () =>
      items.filter(({ row, info }) => {
        if (siteFilter !== 'ALL' && (row.site_sync_id ?? NO_SITE) !== siteFilter) return false;
        if (stateFilter !== 'ALL' && info.state !== stateFilter) return false;
        return true;
      }),
    [items, siteFilter, stateFilter]
  );

  const selectStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255, 215, 0, 0.25)',
    borderRadius: 8,
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: 600,
    padding: '7px 12px',
    cursor: 'pointer',
    outline: 'none',
    colorScheme: 'dark',
  };

  const bannerStyle = (c: string, bg: string, br: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'flex-start', gap: 10, background: bg, border: `1px solid ${br}`,
    borderRadius: 12, padding: '10px 14px', color: c, fontSize: 13, fontWeight: 600, lineHeight: 1.4,
  });

  const summaryCards: Array<{ key: string; label: string; value: number; color: string }> = [
    { key: 'total', label: 'Postes', value: summary.total, color: '#ffd700' },
    { key: 'A_JOUR', label: 'À jour', value: summary.A_JOUR, color: STATE_META.A_JOUR.color },
    { key: 'EN_RETARD', label: 'En retard', value: summary.EN_RETARD, color: STATE_META.EN_RETARD.color },
    { key: 'INCONNU', label: 'Inconnus', value: summary.INCONNU, color: STATE_META.INCONNU.color },
    { key: 'SILENCIEUX', label: `Silencieux (> ${SILENT_AFTER_DAYS} j)`, value: summary.SILENCIEUX, color: STATE_META.SILENCIEUX.color },
  ];

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: '100vh', overflowY: 'auto', padding: '20px 28px 80px' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .pv-card { background: rgba(26, 31, 74, 0.45); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; }
        .pv-btn { background: rgba(255, 215, 0, 0.14); border: 1px solid rgba(255, 215, 0, 0.45); color: #ffd700; padding: 9px 16px; border-radius: 10px; font-weight: 800; font-size: 13px; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: background 0.2s ease; }
        .pv-btn:hover:not(:disabled) { background: rgba(255, 215, 0, 0.26); }
        .pv-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .pv-spin { animation: pv-spin 1s linear infinite; }
        .pv-table { width: 100%; border-collapse: collapse; text-align: left; }
        .pv-table th { position: sticky; top: 0; background: #11163a; z-index: 1; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; padding: 10px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); white-space: nowrap; }
        .pv-table td { font-size: 13px; padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); color: var(--text-secondary); vertical-align: middle; }
        .pv-table tr:hover td { background: rgba(255,255,255,0.03); }
        @keyframes pv-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}} />

      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: 'linear-gradient(135deg, #ffd700 0%, #b8860b 100%)', width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <MonitorSmartphone size={18} color="black" />
          </div>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>Versions des postes</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
              Version installée de chaque poste, comparée à la dernière version publiée.
            </p>
          </div>
        </div>
        <button className="pv-btn" disabled={loading || !isSuperAdmin} onClick={() => void load()}>
          <RefreshCw size={16} className={loading ? 'pv-spin' : ''} />
          <span>Actualiser</span>
        </button>
      </div>

      {/* Bandeau d'information (toujours visible) */}
      <div style={bannerStyle('#93c5fd', 'rgba(96, 165, 250, 0.1)', 'rgba(96, 165, 250, 0.3)')}>
        <Info size={18} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Seuls les postes ayant installé une version qui embarque cette fonction se déclarent ici. Un poste absent de la
          liste n'a pas forcément échoué : il n'a peut-être pas encore été mis à jour ou lancé.
        </span>
      </div>

      {/* Erreur */}
      {errorCode && (
        <div role="alert" style={bannerStyle('#f87171', 'rgba(248, 113, 113, 0.1)', 'rgba(248, 113, 113, 0.35)')}>
          {errorCode === 'OFFLINE' ? <WifiOff size={18} style={{ flexShrink: 0 }} /> : <ShieldAlert size={18} style={{ flexShrink: 0 }} />}
          <span>{errorMessage(errorCode)}</span>
        </div>
      )}

      {ok && (
        <>
          {/* Version de référence */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, fontSize: 13, color: 'var(--text-secondary)' }}>
            <span>
              Version de référence : <strong style={{ color: '#ffd700' }}>{reference ?? 'inconnue'}</strong>
              {reference && !ok.latestVersion ? ' (la plus haute vue parmi les postes)' : ''}
            </span>
            <span>
              Version de ce poste : <strong style={{ color: 'var(--text-primary)' }}>{ok.currentVersion}</strong>
            </span>
          </div>

          {(ok.truncated || ok.rows.length > LARGE_LIST_THRESHOLD) && (
            <div role="alert" style={bannerStyle('#fbbf24', 'rgba(251, 191, 36, 0.1)', 'rgba(251, 191, 36, 0.35)')}>
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                {ok.truncated
                  ? `Liste tronquée : ${ok.counts.nb_listables} postes sont déclarés, seuls ${ok.rows.length} sont affichés. Les synthèses ci-dessous ne portent que sur les lignes affichées.`
                  : `Liste volumineuse (${ok.rows.length} postes) : utilisez les filtres par site et par état pour la parcourir.`}
              </span>
            </div>
          )}

          {/* Synthèse */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
            {summaryCards.map((c) => (
              <div key={c.key} className="pv-card" style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.label}</span>
                <span style={{ fontSize: 26, fontWeight: 800, color: c.color, lineHeight: 1.1 }}>{c.value}</span>
              </div>
            ))}
          </div>

          {/* Filtres */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              <MapPin size={14} />
              <span>Site</span>
              <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} style={selectStyle}>
                <option value="ALL" style={{ background: '#0d111b' }}>Tous les sites</option>
                {siteOptions.map(([id, nom]) => (
                  <option key={id} value={id} style={{ background: '#0d111b' }}>{nom}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
              <Filter size={14} />
              <span>État</span>
              <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value as StateFilter)} style={selectStyle}>
                <option value="ALL" style={{ background: '#0d111b' }}>Tous les états</option>
                {(['EN_RETARD', 'SILENCIEUX', 'INCONNU', 'A_JOUR'] as PosteState[]).map((s) => (
                  <option key={s} value={s} style={{ background: '#0d111b' }}>{STATE_META[s].label}</option>
                ))}
              </select>
            </label>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {visible.length} poste{visible.length > 1 ? 's' : ''} affiché{visible.length > 1 ? 's' : ''}
              {' · '}données lues le {formatAbsolute(new Date(loadedAt).toISOString())}
            </span>
          </div>
        </>
      )}

      {/* Corps : chargement / vide / tableau */}
      {loading && !ok ? (
        <div className="pv-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 180, color: 'var(--text-muted)', fontSize: 13 }}>
          <RefreshCw size={26} className="pv-spin" color="#ffd700" />
          <span>Chargement des versions des postes...</span>
        </div>
      ) : ok && ok.rows.length === 0 ? (
        <div className="pv-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 140, color: 'var(--text-muted)', fontSize: 14, fontWeight: 600, textAlign: 'center', padding: 16 }}>
          Aucun poste ne s'est encore déclaré.
        </div>
      ) : ok ? (
        <div className="pv-card" style={{ overflow: 'hidden', opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s ease' }}>
          {visible.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              Aucun poste ne correspond à ces filtres.
            </div>
          ) : (
            <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 380px)', minHeight: 240 }}>
              <table className="pv-table">
                <thead>
                  <tr>
                    <th>Poste</th>
                    <th>Site</th>
                    <th>Version</th>
                    <th>État</th>
                    <th>Dernière remontée</th>
                    <th>Dernier utilisateur</th>
                    <th>Première vue</th>
                    <th>Clé</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ row, info }, idx) => {
                    const showVersionBadge = info.silent && info.versionState !== 'INCONNU';
                    return (
                      <tr key={`${row.poste_ref}-${idx}`}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>Poste</span>{' '}
                          <span style={{ fontFamily: 'Consolas, monospace', color: '#ffd700', fontWeight: 700 }}>{row.poste_ref}</span>
                        </td>
                        <td style={{ overflowWrap: 'anywhere' }}>{row.site_nom || '—'}</td>
                        <td style={{ fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{row.app_version || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                            <Badge state={info.state} />
                            {showVersionBadge && <Badge state={info.versionState as PosteVersionState} small />}
                          </div>
                        </td>
                        <td title={formatAbsolute(row.last_seen_at)} style={{ whiteSpace: 'nowrap' }}>
                          {formatRelative(row.last_seen_at, loadedAt)}
                        </td>
                        <td>{row.last_user_login || '—'}</td>
                        <td title={formatAbsolute(row.first_seen_at)} style={{ whiteSpace: 'nowrap' }}>
                          {formatAbsolute(row.first_seen_at)}
                        </td>
                        <td style={{ fontSize: 12 }}>{row.key_kind || '—'}</td>
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
