// Verrou d'inactivite (Q4 : 15 min). Logique pure, horloge injectable (tests/idleLock.test.ts).
// On compare des instants (Date.now) au lieu de compter sur un seul setTimeout : sur un
// telephone, les minuteries sont suspendues en arriere-plan ; au retour (visibilitychange),
// check() constate immediatement que le delai est depasse.

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export class IdleClock {
  private last: number;
  private suspended = false;

  constructor(
    private readonly timeoutMs: number = IDLE_TIMEOUT_MS,
    private readonly now: () => number = Date.now,
  ) {
    this.last = now();
  }

  /** Activite de l'operateur (toucher, frappe) : repart de zero. */
  touch(): void {
    this.last = this.now();
  }

  /**
   * Suspend le verrou (envoi en cours : on ne verrouille jamais au milieu d'un
   * retrait). La reprise compte comme une activite.
   */
  setSuspended(v: boolean): void {
    this.suspended = v;
    if (!v) this.touch();
  }

  /** Vrai si le verrou doit s'enclencher maintenant. */
  shouldLock(): boolean {
    return !this.suspended && this.now() - this.last >= this.timeoutMs;
  }

  remainingMs(): number {
    return Math.max(0, this.timeoutMs - (this.now() - this.last));
  }
}
