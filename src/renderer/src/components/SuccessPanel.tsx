import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { successPanel, type SuccessPanelState } from './successPanelService';
import { useAuthStore } from '../stores/authStore';

/**
 * Panneau de succès non bloquant (« sceau de validation »), piloté par successPanelService.ts.
 *
 * - Rendu uniquement lorsqu'un succès est affiché : aucun conteneur role="status" vide permanent
 *   (des helpers E2E attendent l'absence de tout [role="status"]).
 * - Ancré en bas à gauche de la zone de contenu, à droite de `.sidebar`, pour ne jamais recouvrir
 *   le pied de la barre latérale (Déconnexion). Position recalculée au resize de la fenêtre et via
 *   ResizeObserver sur `.sidebar` (dépliage/repliage, points de rupture), écouteurs actifs
 *   uniquement pendant l'affichage. Repli prudent (24 px du bord) si `.sidebar` est absente,
 *   masquée ou de largeur nulle : l'absence de chevauchement n'est alors pas garantie.
 * - Fermé dès la fin de session (déconnexion : authStore.user passe à null) : un succès ne survit
 *   pas à la session.
 * - Ne prend jamais le focus. Échap ne ferme que si le focus est dans le panneau. Survol et focus
 *   suspendent le délai (reprise sur le délai restant, cf. service).
 * - Animation SVG/CSS jouée une seule fois (anneau, coche, reflet doré), puis état fixe ; les
 *   styles de base sont l'état final, donc prefers-reduced-motion affiche directement cet état.
 */

const EDGE_GAP_PX = 24;
const FALLBACK_LEFT_PX = 24;
const EXIT_MS = 200;
const PANEL_MAX_WIDTH_PX = 320;

const SEAL_STYLES = `
.gis-seal-panel { animation: gis-seal-panel-in 200ms ease-out both; }
.gis-seal-panel.gis-seal-leaving { animation: gis-seal-panel-out ${EXIT_MS}ms ease-in both; }
.gis-seal-symbol { transform-origin: 32px 32px; animation: gis-seal-settle 350ms ease-in-out 750ms both; }
.gis-seal-disc { transform-origin: 32px 32px; animation: gis-seal-disc-in 200ms ease-out both; }
.gis-seal-ring { stroke-dasharray: 100; stroke-dashoffset: 0; animation: gis-seal-draw 400ms cubic-bezier(.4, 0, .2, 1) 150ms both; }
.gis-seal-check { stroke-dasharray: 100; stroke-dashoffset: 0; animation: gis-seal-draw 350ms ease-in-out 450ms both; }
.gis-seal-glint { transform-origin: 32px 32px; opacity: 0; animation: gis-seal-glint 350ms linear 750ms both; }
.gis-seal-close:hover, .gis-seal-close:focus-visible { color: var(--text-primary); background: rgba(255, 255, 255, 0.06); }
.gis-seal-close:focus-visible { outline: 2px solid #4ecdc4; outline-offset: 1px; }
@keyframes gis-seal-panel-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes gis-seal-panel-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes gis-seal-disc-in { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
@keyframes gis-seal-draw { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
@keyframes gis-seal-glint { 0% { opacity: 0; transform: rotate(0deg); } 30% { opacity: 0.9; } 100% { opacity: 0; transform: rotate(360deg); } }
@keyframes gis-seal-settle { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
@media (prefers-reduced-motion: reduce) {
  .gis-seal-panel, .gis-seal-panel * { animation: none !important; }
}
`;

function computeLeft(): number {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return FALLBACK_LEFT_PX;
  const rect = sidebar.getBoundingClientRect();
  if (rect.width <= 0 || rect.right <= 0) return FALLBACK_LEFT_PX;
  return Math.round(rect.right) + EDGE_GAP_PX;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export default function SuccessPanel() {
  const [panel, setPanel] = useState<SuccessPanelState | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [left, setLeft] = useState(FALLBACK_LEFT_PX);
  const containerRef = useRef<HTMLDivElement>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Abonnement unique au service ; désabonnement et minuterie de sortie nettoyés au démontage.
  useEffect(() => {
    const clearExitTimer = () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
    const unregister = successPanel.register((state) => {
      clearExitTimer();
      if (state) {
        setLeaving(false);
        setPanel(state);
        return;
      }
      previousFocusRef.current = null;
      if (prefersReducedMotion()) {
        setLeaving(false);
        setPanel(null);
        return;
      }
      setLeaving(true);
      exitTimerRef.current = setTimeout(() => {
        exitTimerRef.current = null;
        setLeaving(false);
        setPanel(null);
      }, EXIT_MS);
    });
    return () => {
      unregister();
      clearExitTimer();
    };
  }, []);

  const visible = panel !== null;
  const panelId = panel?.id;

  // Positionnement à droite de `.sidebar`, recalculé tant que le panneau est visible.
  useLayoutEffect(() => {
    if (!visible) return;
    const update = () => setLeft(computeLeft());
    update();
    window.addEventListener('resize', update);
    let observer: ResizeObserver | null = null;
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(sidebar);
    }
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [visible, panelId]);

  // Frontière de session : le panneau est global et survit aux changements de page, mais ne doit
  // pas survivre à la déconnexion (message de l'opérateur précédent visible par le suivant ; et,
  // `.sidebar` disparue, le repli le replace sous le pointeur resté sur l'ancien bouton
  // « Déconnexion », ce qui suspendrait indéfiniment le délai). On se cale sur la fin de session
  // (authStore.user → null) plutôt que sur l'URL : HashRouter navigue via history.pushState, qui
  // ne déclenche jamais `hashchange`. Lecture seule du store, aucune modification.
  const sessionUser = useAuthStore((s) => s.user);
  useEffect(() => {
    if (!sessionUser) successPanel.dismiss();
  }, [sessionUser]);

  if (!panel) return null;

  // Fermeture volontaire (bouton ou Échap) : le focus, s'il était dans le panneau, est rendu à
  // l'élément qui le détenait avant d'y entrer, pour ne pas le perdre au démontage.
  const closeFromPanel = () => {
    const container = containerRef.current;
    const previous = previousFocusRef.current;
    if (container && container.contains(document.activeElement) && previous && previous.isConnected) {
      previous.focus();
    }
    successPanel.dismiss();
  };

  return (
    <>
      <style>{SEAL_STYLES}</style>
      <div
        ref={containerRef}
        role="status"
        data-testid="success-panel"
        className={`gis-seal-panel${leaving ? ' gis-seal-leaving' : ''}`}
        onPointerEnter={() => successPanel.pause('hover')}
        onPointerLeave={() => successPanel.resume('hover')}
        onFocus={(e) => {
          const from = e.relatedTarget as HTMLElement | null;
          if (!from || !containerRef.current?.contains(from)) previousFocusRef.current = from;
          successPanel.pause('focus');
        }}
        onBlur={(e) => {
          if (!containerRef.current?.contains(e.relatedTarget as Node | null)) successPanel.resume('focus');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            closeFromPanel();
          }
        }}
        style={{
          position: 'fixed',
          left,
          bottom: EDGE_GAP_PX,
          zIndex: 10001,
          width: `min(${PANEL_MAX_WIDTH_PX}px, calc(100vw - ${left + EDGE_GAP_PX}px))`,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '12px 12px 12px 14px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderLeft: '2px solid #fbbf24',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-md)',
          fontFamily: 'var(--font-family)'
        }}
      >
        <svg key={panel.id} width={56} height={56} viewBox="0 0 64 64" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
          <g className="gis-seal-symbol">
            <circle className="gis-seal-disc" cx={32} cy={32} r={26} fill="rgba(78, 205, 196, 0.12)" />
            <circle cx={32} cy={32} r={30.5} fill="none" stroke="#fbbf24" strokeWidth={1} opacity={0.4} />
            <circle
              className="gis-seal-ring"
              cx={32} cy={32} r={26}
              fill="none" stroke="#4ecdc4" strokeWidth={3} strokeLinecap="round"
              pathLength={100} transform="rotate(-90 32 32)"
            />
            <path
              className="gis-seal-check"
              d="M20 33 L28 41 L44 24"
              fill="none" stroke="#ffffff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round"
              pathLength={100}
            />
            <g transform="rotate(-90 32 32)">
              <circle
                className="gis-seal-glint"
                cx={32} cy={32} r={29.5}
                fill="none" stroke="#fbbf24" strokeWidth={1.5} strokeLinecap="round"
                pathLength={100} strokeDasharray="11 89"
              />
            </g>
          </g>
        </svg>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, lineHeight: 1.3, color: 'var(--text-primary)' }}>{panel.title}</p>
          {panel.detail ? (
            <p style={{ margin: '2px 0 0 0', fontSize: 13, lineHeight: 1.35, color: 'var(--text-secondary)' }}>{panel.detail}</p>
          ) : null}
        </div>

        <button
          type="button"
          className="gis-seal-close"
          aria-label="Fermer la notification"
          onClick={closeFromPanel}
          style={{
            flexShrink: 0,
            alignSelf: 'flex-start',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            padding: 0,
            border: 'none',
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer'
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
