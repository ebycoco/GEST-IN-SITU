import { describe, expect, it } from 'vitest';
import { attendreSiAJour, PERIME } from '../src/lib/actualiser';
import { Generation } from '../src/lib/generation';

describe('actualiser : reponse perimee ignoree', () => {
  it('rend la reponse si rien ne change pendant l\'appel', async () => {
    const g = new Generation();
    await expect(attendreSiAJour(g.ticket(), async () => 'frais')).resolves.toBe('frais');
  });
  it('rend PERIME si un verrou / une deconnexion survient pendant l\'appel', async () => {
    const g = new Generation();
    let repondre: (v: string) => void = () => undefined;
    const attente = attendreSiAJour(g.ticket(), () => new Promise<string>((r) => { repondre = r; }));
    g.bump(); // verrou pendant l'appel
    repondre('donnees de cartes');
    await expect(attente).resolves.toBe(PERIME);
  });
  it('un appel relance apres le bump est de nouveau accepte', async () => {
    const g = new Generation();
    g.bump();
    await expect(attendreSiAJour(g.ticket(), async () => 1)).resolves.toBe(1);
  });
});
