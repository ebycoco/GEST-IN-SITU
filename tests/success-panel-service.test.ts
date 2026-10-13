import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  successPanel,
  SUCCESS_PANEL_DURATION_MS,
  type SuccessPanelState
} from '../src/renderer/src/components/successPanelService';

/**
 * T1 — successPanelService : emplacement unique, remplacement, fermeture automatique, pause/reprise
 * du délai restant (survol + focus), dismiss, nettoyage des minuteurs au désenregistrement.
 * Module TypeScript pur, sans DOM ni dépendance native : exécutable sous le Node système.
 */

describe('successPanelService (T1)', () => {
  let calls: (SuccessPanelState | null)[];
  let unregister: (() => void) | null;
  const last = () => calls[calls.length - 1];

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    unregister = successPanel.register((s) => { calls.push(s); });
  });

  afterEach(() => {
    unregister?.();
    unregister = null;
    vi.useRealTimers();
  });

  it('show() sans écouteur enregistré : aucune exception, aucun minuteur', () => {
    unregister?.();
    unregister = null;
    expect(() => successPanel.show({ title: 'X' })).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('show() notifie le contenu puis ferme automatiquement après la durée', () => {
    successPanel.show({ title: 'Carte délivrée avec succès !', detail: 'Enregistrée sur ce poste' });
    expect(last()).toMatchObject({ title: 'Carte délivrée avec succès !', detail: 'Enregistrée sur ce poste' });
    expect(typeof last()?.id).toBe('number');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(SUCCESS_PANEL_DURATION_MS - 1);
    expect(last()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(last()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un nouveau show() remplace le précédent (id incrémenté) et relance le délai complet', () => {
    successPanel.show({ title: 'A' });
    const idA = last()!.id;
    vi.advanceTimersByTime(2000);
    successPanel.show({ title: 'B' });
    expect(last()).toMatchObject({ title: 'B' });
    expect(last()!.id).toBeGreaterThan(idA);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(SUCCESS_PANEL_DURATION_MS - 1);
    expect(last()).toMatchObject({ title: 'B' });
    vi.advanceTimersByTime(1);
    expect(last()).toBeNull();
  });

  it('deux succès distincts identiques restent deux affichages (pas de déduplication par contenu)', () => {
    successPanel.show({ title: 'Carte délivrée avec succès !' });
    successPanel.show({ title: 'Carte délivrée avec succès !' });
    const shown = calls.filter((c) => c !== null) as SuccessPanelState[];
    expect(shown).toHaveLength(2);
    expect(shown[1].id).toBeGreaterThan(shown[0].id);
  });

  it('dismiss() ferme immédiatement et nettoie le minuteur ; second dismiss sans effet', () => {
    successPanel.show({ title: 'A' });
    successPanel.dismiss();
    expect(last()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const n = calls.length;
    successPanel.dismiss();
    expect(calls).toHaveLength(n);
  });

  it('pause au survol : le panneau reste ; reprise sur le délai restant', () => {
    successPanel.show({ title: 'A' });
    vi.advanceTimersByTime(1000);
    successPanel.pause('hover');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10000);
    expect(last()).toMatchObject({ title: 'A' });
    successPanel.resume('hover');
    vi.advanceTimersByTime(SUCCESS_PANEL_DURATION_MS - 1000 - 1);
    expect(last()).toMatchObject({ title: 'A' });
    vi.advanceTimersByTime(1);
    expect(last()).toBeNull();
  });

  it('survol + focus : la reprise n\'a lieu qu\'une fois les deux raisons levées', () => {
    successPanel.show({ title: 'A' });
    vi.advanceTimersByTime(500);
    successPanel.pause('hover');
    successPanel.pause('focus');
    successPanel.resume('hover');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10000);
    expect(last()).toMatchObject({ title: 'A' });
    successPanel.resume('focus');
    vi.advanceTimersByTime(SUCCESS_PANEL_DURATION_MS - 500 - 1);
    expect(last()).toMatchObject({ title: 'A' });
    vi.advanceTimersByTime(1);
    expect(last()).toBeNull();
  });

  it('show() pendant une pause : pas de minuteur ; reprise sur la durée complète', () => {
    successPanel.show({ title: 'A' });
    successPanel.pause('hover');
    successPanel.show({ title: 'B' });
    expect(last()).toMatchObject({ title: 'B' });
    expect(vi.getTimerCount()).toBe(0);
    successPanel.resume('hover');
    vi.advanceTimersByTime(SUCCESS_PANEL_DURATION_MS - 1);
    expect(last()).toMatchObject({ title: 'B' });
    vi.advanceTimersByTime(1);
    expect(last()).toBeNull();
  });

  it('pause/resume sans panneau visible ou sans pause préalable : sans effet', () => {
    successPanel.pause('hover');
    successPanel.resume('hover');
    successPanel.resume('focus');
    expect(vi.getTimerCount()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('désenregistrement : minuteur nettoyé, show() ultérieur sans effet', () => {
    successPanel.show({ title: 'A' });
    expect(vi.getTimerCount()).toBe(1);
    unregister?.();
    unregister = null;
    expect(vi.getTimerCount()).toBe(0);
    const n = calls.length;
    successPanel.show({ title: 'B' });
    expect(calls).toHaveLength(n);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un écouteur qui lève une exception ne la propage pas à l\'appelant', () => {
    unregister?.();
    unregister = successPanel.register(() => { throw new Error('rendu cassé'); });
    expect(() => successPanel.show({ title: 'A' })).not.toThrow();
    expect(() => successPanel.dismiss()).not.toThrow();
  });
});
