// Identifiant de requete et garde anti double envoi (tests/delivery.test.ts).

/**
 * p_request_id de fn_mobile_delivrer_carte : UN par tentative de retrait d'une carte,
 * genere au premier envoi et REUTILISE tant que la reponse n'est pas definitive
 * (coupure reseau, « Verifier », reconfirmation). Le serveur reconnait alors son propre
 * retrait (OK "reessai": true) au lieu de repondre DEJA_DELIVREE.
 * Efface seulement apres une reponse definitive du serveur (OK ou refus).
 */
export class RequestIdKeeper {
  private current: { syncId: string; id: string } | null = null;

  constructor(private readonly gen: () => string = () => crypto.randomUUID()) {}

  forCard(syncId: string): string {
    if (this.current && this.current.syncId === syncId) return this.current.id;
    this.current = { syncId, id: this.gen() };
    return this.current.id;
  }

  peek(): { syncId: string; id: string } | null {
    return this.current;
  }

  clear(): void {
    this.current = null;
  }
}

/**
 * Garde anti double envoi : un seul appel a la fois. Un second appel pendant le
 * premier est ignore (retourne { skipped: true }), meme si le bouton n'a pas encore
 * ete grise par React (double appui tres rapide).
 */
export class SendGuard {
  private busy = false;

  get inFlight(): boolean {
    return this.busy;
  }

  async run<T>(fn: () => Promise<T>): Promise<{ skipped: true } | { skipped: false; value: T }> {
    if (this.busy) return { skipped: true };
    this.busy = true;
    try {
      return { skipped: false, value: await fn() };
    } finally {
      this.busy = false;
    }
  }
}
