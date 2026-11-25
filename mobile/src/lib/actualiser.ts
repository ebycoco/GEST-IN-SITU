// Attente d'une reponse avec ticket de generation (lib/generation.ts), pour « Actualiser »
// (tests/actualiser.test.ts). Le ticket est pris AVANT l'appel ; si une deconnexion, un verrou
// ou un effacement est survenu pendant l'attente, la reponse est declaree perimee et
// l'appelant ne doit plus toucher a l'etat React.

export const PERIME = Symbol('perime');

/**
 * Lance `appel`, attend sa reponse, puis rend PERIME si `aJour()` est devenu faux.
 * `ticket` vient de Generation.ticket(), pris par l'appelant avant cet appel.
 */
export async function attendreSiAJour<T>(ticket: () => boolean, appel: () => Promise<T>): Promise<T | typeof PERIME> {
  const valeur = await appel();
  return ticket() ? valeur : PERIME;
}
