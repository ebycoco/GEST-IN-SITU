import { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';
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
 * Bannière persistante des alertes « double délivrance » (P1-2, 2026-11-24).
 *
 * Une délivrance faite sur ce poste (souvent hors ligne) a été écartée par le cloud au profit
 * d'une délivrance arrivée avant (téléphone ou autre poste). L'alerte reste affichée sur toutes
 * les pages tant qu'elle n'est pas acquittée (« J'ai vérifié ») ; la source est le journal local
 * t_logs ALERTE_DOUBLE_DELIVRANCE, relu via IPC (portée = session serveur, CLAUDE.md §3).
 *
 * Rafraîchissement : au montage, au changement d'utilisateur / de rôle actif, et sur le signal
 * 'sync:double-delivery-alert' (émis après un envoi qui a créé une alerte). Pas de polling ;
 * abonnement IPC nettoyé au démontage (CLAUDE.md §2). Liste bornée côté main (50 au plus).
 */
export default function DoubleDeliveryAlertBanner() {
  const userId = useAuthStore((s) => s.user?.id_user);
  const activeRole = useAuthStore((s) => s.user?.role);
  const [alerts, setAlerts] = useState<DoubleDeliveryAlert[]>([]);
  const [pendingAck, setPendingAck] = useState<number | null>(null);

  const refresh = useCallback(() => {
    if (!userId || !window.api?.sync?.getDoubleDeliveryAlerts) {
      setAlerts([]);
      return;
    }
    window.api.sync.getDoubleDeliveryAlerts()
      .then((list) => setAlerts(Array.isArray(list) ? list : []))
      .catch((err) => console.error('Failed to fetch double delivery alerts', err));
  }, [userId]);

  // activeRole : la portée (centre / site) suit le rôle actif côté main -> relecture au changement.
  useEffect(() => {
    refresh();
  }, [refresh, activeRole]);

  useEffect(() => {
    if (!window.api?.sync?.onDoubleDeliveryAlert) return;
    const unsubscribe = window.api.sync.onDoubleDeliveryAlert((data) => {
      if ((data?.count ?? 0) > 0) {
        toast.error('Retrait non retenu : une carte avait déjà été remise ailleurs. Voir l\'alerte en haut de l\'écran.', { duration: 8000 });
      }
      refresh();
    });
    return () => unsubscribe();
  }, [refresh]);

  const acknowledge = async (idLog: number) => {
    setPendingAck(idLog);
    try {
      const res = await window.api.sync.acknowledgeDoubleDeliveryAlert(idLog);
      if (!res?.success) toast.error('Impossible d\'acquitter cette alerte.');
    } catch (e) {
      toast.error(`Erreur système : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPendingAck(null);
      refresh();
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div
      role="alert"
      style={{
        margin: '8px 16px 0',
        padding: '12px 16px',
        borderRadius: 10,
        border: '2px solid #dc2626',
        background: '#fef2f2',
        color: '#7f1d1d',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxHeight: 220,
        overflowY: 'auto'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 14 }}>
        <AlertTriangle size={18} color="#dc2626" />
        {alerts.length === 1 ? 'Retrait non retenu' : `${alerts.length} retraits non retenus`}
      </div>
      {alerts.map((a) => {
        const nom = [a.prenoms, a.noms].filter(Boolean).join(' ').trim() || 'sans nom';
        const agent = a.garde.agent_distributeur || 'un autre agent';
        return (
          <div
            key={a.id_log}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', fontSize: 13, lineHeight: 1.5 }}
          >
            <span style={{ flex: '1 1 320px', minWidth: 0 }}>
              Carte <strong>{nom}</strong> déjà remise par <strong>{agent}</strong> le <strong>{formatDate(a.garde.date_delivrance)}</strong>
              {a.garde.nom_retirant ? <> (retirant : {a.garde.nom_retirant})</> : null}
              {' '}— votre retrait sur ce poste n'a pas été retenu, vérifiez auprès du retirant.
            </span>
            <button
              type="button"
              onClick={() => acknowledge(a.id_log)}
              disabled={pendingAck === a.id_log}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid #dc2626',
                background: '#dc2626',
                color: '#fff',
                fontWeight: 700,
                fontSize: 12,
                cursor: pendingAck === a.id_log ? 'wait' : 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              J'ai vérifié
            </button>
          </div>
        );
      })}
    </div>
  );
}
