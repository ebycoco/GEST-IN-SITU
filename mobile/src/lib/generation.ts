// Compteur de generation (tests/generation.test.ts).
//
// Une reponse asynchrone (recherche, retrait, « Verifier », preuve) arrive parfois APRES
// une deconnexion, un verrou ou un effacement des cartes : elle ne doit alors plus toucher
// l'etat React (sinon des donnees de cartes reapparaissent a l'ecran du compte suivant ou
// derriere le verrou). Chaque appel prend un ticket AVANT son await ; deconnecter,
// verrouiller et effacerCartes font avancer la generation ; au retour, un ticket perime
// signifie « reponse ignoree ».

export class Generation {
  private n = 0;

  get current(): number {
    return this.n;
  }

  /** Invalide toutes les reponses en attente. */
  bump(): void {
    this.n += 1;
  }

  /** Ticket pris avant un appel ; renvoie true tant qu'aucun bump() n'a eu lieu depuis. */
  ticket(): () => boolean {
    const g = this.n;
    return () => g === this.n;
  }
}
