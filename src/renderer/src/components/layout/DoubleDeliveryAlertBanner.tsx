import { useState, useEffect, useCallback, useRef } from 'react';
import { toast, type ToastOptions } from 'react-hot-toast';
import { AlertTriangle, ChevronDown, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';

type DoubleDeliveryAlert = Awaited<ReturnType<typeof window.api.sync.getDoubleDeliveryAlerts>>[number];

/** jj/mm/aaaa hh:mm (heure locale) ; texte brut si illisible. */
function formatDate(value: string | null): string {
  if (!value) return 'date inconnue';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Toasts de ce composant : en bas au centre, jamais en haut à droite où ils masquaient la bande
 * d'alerte et son bouton (test vivant agent-13 du 2026-11-24, 1366x768). Un id fixe évite
 * d'empiler plusieurs toasts identiques quand plusieurs signaux arrivent à la suite.
 */
const TOAST_ALERT: ToastOptions = { id: 'double-delivery-alert', position: 'bottom-center', duration: 6000 };
const TOAST_ERROR: ToastOptions = { position: 'bottom-center' };

/** Hauteur fixe de la bande repliée (px) : identique pour 1 ou 50 alertes. */
const BAND_HEIGHT = 44;
const PANEL_ID = 'double-delivery-alert-panel';

/**
 * Bannière persistante des alertes « double délivrance » (P1-2, 2026-11-24).
 *
 * Une délivrance faite sur ce poste (souvent hors ligne) a été écartée par le cloud au profit
 * d'une délivrance arrivée avant (téléphone ou autre poste). L'alerte reste affichée sur toutes
 * les pages tant qu'elle n'est pas acquittée (« J'ai vérifié ») ; la source est le journal local
 * t_logs ALERTE_DOUBLE_DELIVRANCE, relu via IPC (portée = session serveur, CLAUDE.md §3).
 *
 * Présentation (révision UI 2026-11-24) : une seule bande rouge compacte de 44 px quel que soit
 * le nombre d'alertes ; le détail s'ouvre au clic dans un panneau SUPERPOSÉ au contenu (position
 * absolue, hauteur bornée et déroulante) : il ne pousse jamais la page, donc les boutons d'action
 * (ex. « Rechercher la Carte ») restent au-dessus du pli à 1366x768.
 *
 * Rafraîchissement : au montage, au changement d'utilisateur / de rôle actif, et sur le signal
 * 'sync:double-delivery-alert' (émis après un envoi qui a créé une alerte). Pas de polling ;
 * abonnement IPC et écouteurs document nettoyés au démontage (CLAUDE.md §2). Liste bornée côté
 * main (50 au plus).
 */
export default function DoubleDeliveryAlertBanner() {
  const userId = useAuthStore((s) => s.user?.id_user);
  const activeRole = useAuthStore((s) => s.user?.role);
  const [alerts, setAlerts] = useState<DoubleDeliveryAlert[]>([]);
  const [pendingAck, setPendingAck] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  /** Relit la liste ; renvoie la liste affichée (vide si rôle non délivreur, erreur, etc.). */
  const refresh = useCallback(async (): Promise<DoubleDeliveryAlert[]> => {
    if (!userId || !window.api?.sync?.getDoubleDeliveryAlerts) {
      setAlerts([]);
      return [];
    }
    try {
      const list = await window.api.sync.getDoubleDeliveryAlerts();
      const safe = Array.isArray(list) ? list : [];
      setAlerts(safe);
      return safe;
    } catch (err) {
      console.error('Failed to fetch double delivery alerts', err);
      return [];
    }
  }, [userId]);

  // activeRole : la portée (centre / site) suit le rôle actif côté main -> relecture au changement.
  useEffect(() => {
    refresh();
  }, [refresh, activeRole]);

  useEffect(() => {
    if (!window.api?.sync?.onDoubleDeliveryAlert) return;
    const unsubscribe = window.api.sync.onDoubleDeliveryAlert((data) => {
      // P2-3 (audit 2026-11-24) : toast seulement si la bannière s'affiche réellement (liste
      // relue non vide) — jamais « voir l'alerte en haut » pour un rôle qui ne la voit pas.
      void refresh().then((list) => {
        if ((data?.count ?? 0) > 0 && list.length > 0) {
          toast.error('Retrait non retenu : une carte avait déjà été remise ailleurs. Voir la bande rouge en haut de l\'écran.', TOAST_ALERT);
        }
      });
    });
    return () => unsubscribe();
  }, [refresh]);

  // Plus aucune alerte -> le panneau se referme (il se rouvrira replié à la prochaine alerte).
  useEffect(() => {
    if (alerts.length === 0) setExpanded(false);
  }, [alerts.length]);

  // Panneau ouvert : fermeture par Échap (focus rendu à la bande) ou clic hors du composant.
  // Écouteurs posés uniquement pendant l'ouverture, retirés à la fermeture / au démontage.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpanded(false);
        toggleRef.current?.focus();
      }
    };
    const onPointer = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setExpanded(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [expanded]);

  const acknowledge = async (idLog: number) => {
    setPendingAck(idLog);
    try {
      const res = await window.api.sync.acknowledgeDoubleDeliveryAlert(idLog);
      if (!res?.success) toast.error('Impossible d\'acquitter cette alerte.', TOAST_ERROR);
    } catch (e) {
      toast.error(`Erreur système : ${e instanceof Error ? e.message : String(e)}`, TOAST_ERROR);
    } finally {
      setPendingAck(null);
      refresh();
    }
  };

  if (alerts.length === 0) return null;

  const count = alerts.length;
  const first = alerts[0];
  const firstNom = [first.prenoms, first.noms].filter(Boolean).join(' ').trim() || 'sans nom';
  const summary = count === 1
    ? <>Retrait non retenu : carte de <strong style={{ fontWeight: 900 }}>{firstNom}</strong> déjà remise ailleurs</>
    : <>{count} retraits non retenus : cartes déjà remises ailleurs</>;

  return (
    <div
      ref={rootRef}
      role="region"
      aria-label="Alertes de retraits non retenus"
      style={{ position: 'relative', flexShrink: 0, margin: '6px 16px 0', zIndex: 200 }}
    >
      {/* Annonce vocale (hors du bouton, dont le contenu est présentationnel en ARIA) à l'apparition
          et à chaque changement du nombre d'alertes. Invisible à l'écran. */}
      <span
        role="alert"
        style={{ position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }}
      >
        {count === 1 ? 'Alerte : 1 retrait non retenu.' : `Alerte : ${count} retraits non retenus.`}
      </span>
      {/* Bande compacte : toujours 44 px, cliquable en entier, rouge plein + texte blanc (lisible au soleil). */}
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={PANEL_ID}
        title={expanded ? 'Masquer le détail' : 'Voir le détail et acquitter'}
        style={{
          width: '100%',
          height: BAND_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 8px 0 14px',
          borderRadius: 10,
          border: '2px solid #fca5a5',
          background: '#b91c1c',
          color: '#ffffff',
          fontSize: 14,
          fontWeight: 700,
          textAlign: 'left',
          cursor: 'pointer',
          boxShadow: '0 4px 14px rgba(185, 28, 28, 0.35)'
        }}
      >
        <AlertTriangle size={20} color="#ffd700" strokeWidth={2.5} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {summary}
        </span>
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            height: 30,
            padding: '0 12px',
            borderRadius: 8,
            background: '#ffd700',
            color: '#111111',
            fontSize: 13,
            fontWeight: 800,
            whiteSpace: 'nowrap'
          }}
        >
          {expanded ? 'Masquer' : 'Voir'}
          <ChevronDown
            size={16}
            strokeWidth={3}
            style={{ transition: 'transform 150ms ease', transform: expanded ? 'rotate(180deg)' : 'none' }}
          />
        </span>
      </button>

      {/* Détail superposé : ne pousse pas la page ; hauteur bornée, déroulant au-delà. */}
      {expanded && (
        <div
          id={PANEL_ID}
          style={{
            position: 'absolute',
            top: BAND_HEIGHT + 6,
            left: 0,
            right: 0,
            maxHeight: 'min(360px, calc(100vh - 160px))',
            overflowY: 'auto',
            padding: 8,
            borderRadius: 10,
            border: '2px solid #dc2626',
            background: 'var(--bg-secondary)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          {alerts.map((a) => {
            const nom = [a.prenoms, a.noms].filter(Boolean).join(' ').trim() || 'sans nom';
            const agent = a.garde.agent_distributeur || 'un autre agent';
            const busy = pendingAck === a.id_log;
            return (
              <div
                key={a.id_log}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  borderLeft: '4px solid #dc2626',
                  background: 'rgba(220, 38, 38, 0.12)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  lineHeight: 1.5
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  Carte <strong style={{ color: '#ffffff' }}>{nom}</strong> déjà remise par{' '}
                  <strong style={{ color: '#ffffff' }}>{agent}</strong> le{' '}
                  <strong style={{ color: '#ffd700' }}>{formatDate(a.garde.date_delivrance)}</strong>
                  {a.garde.nom_retirant ? <> (retirant : {a.garde.nom_retirant})</> : null}
                  {' '}— votre retrait sur ce poste n'a pas été retenu, vérifiez auprès du retirant.
                </span>
                <button
                  type="button"
                  onClick={() => acknowledge(a.id_log)}
                  disabled={busy}
                  aria-label={`J'ai vérifié : carte de ${nom}`}
                  style={{
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 34,
                    padding: '0 14px',
                    borderRadius: 8,
                    border: '1px solid #ffd700',
                    background: '#ffd700',
                    color: '#111111',
                    fontWeight: 800,
                    fontSize: 13,
                    cursor: busy ? 'wait' : 'pointer',
                    opacity: busy ? 0.6 : 1,
                    whiteSpace: 'nowrap'
                  }}
                >
                  <CheckCircle2 size={16} strokeWidth={2.5} aria-hidden="true" />
                  {busy ? 'Envoi…' : 'J\'ai vérifié'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
