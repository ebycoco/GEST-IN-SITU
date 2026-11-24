import { describe, expect, it } from 'vitest';
import { RequestIdKeeper, SendGuard } from '../src/lib/delivery';

describe('p_request_id : un par tentative, reutilise au reessai', () => {
  it('meme carte -> meme identifiant tant que non efface', () => {
    let n = 0;
    const k = new RequestIdKeeper(() => `id-${++n}`);
    expect(k.forCard('c1')).toBe('id-1');
    expect(k.forCard('c1')).toBe('id-1'); // reessai / « Verifier »
    expect(k.peek()).toEqual({ syncId: 'c1', id: 'id-1' });
  });
  it('reponse definitive (clear) -> nouvelle tentative = nouvel identifiant', () => {
    let n = 0;
    const k = new RequestIdKeeper(() => `id-${++n}`);
    k.forCard('c1');
    k.clear();
    expect(k.peek()).toBeNull();
    expect(k.forCard('c1')).toBe('id-2');
  });
  it('autre carte -> autre identifiant', () => {
    let n = 0;
    const k = new RequestIdKeeper(() => `id-${++n}`);
    k.forCard('c1');
    expect(k.forCard('c2')).toBe('id-2');
  });
  it('generateur par defaut : UUID v4 (crypto.randomUUID)', () => {
    const id = new RequestIdKeeper().forCard('c1');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('garde anti double envoi', () => {
  it('un second appui pendant l\'envoi est ignore', async () => {
    const g = new SendGuard();
    let appels = 0;
    let liberer: () => void = () => undefined;
    const lent = () => new Promise<string>((r) => { appels++; liberer = () => r('ok'); });
    const p1 = g.run(lent);
    expect(g.inFlight).toBe(true);
    const p2 = await g.run(lent);
    expect(p2).toEqual({ skipped: true });
    liberer();
    expect(await p1).toEqual({ skipped: false, value: 'ok' });
    expect(appels).toBe(1);
    expect(g.inFlight).toBe(false);
  });
  it('libere la garde meme en cas d\'erreur', async () => {
    const g = new SendGuard();
    await expect(g.run(() => Promise.reject(new Error('reseau')))).rejects.toThrow('reseau');
    expect(g.inFlight).toBe(false);
    expect(await g.run(() => Promise.resolve(1))).toEqual({ skipped: false, value: 1 });
  });
});
