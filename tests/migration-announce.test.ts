import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => '.', isPackaged: false },
  net: { online: false, request: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] }
}));

import { shouldAnnounceMigration, announceMigrationPending } from '../src/main/database/connection';

describe('Annonce de migration (connection.ts)', () => {
  it('décision : base v72 -> annonce ; neuve (0) et à jour -> non', () => {
    expect(shouldAnnounceMigration(72, 73)).toBe(true);
    expect(shouldAnnounceMigration(0, 73)).toBe(false);
    expect(shouldAnnounceMigration(73, 73)).toBe(false);
  });

  it('appelle le callback avec (from, to)', async () => {
    const cb = vi.fn();
    await announceMigrationPending(cb, 72, 73);
    expect(cb).toHaveBeenCalledWith(72, 73);
  });

  it('sans callback : no-op', async () => {
    await expect(announceMigrationPending(undefined, 72, 73)).resolves.toBeUndefined();
  });

  it('callback qui lève (sync ou async) : avalé', async () => {
    await expect(announceMigrationPending(() => { throw new Error('boom'); }, 72, 73)).resolves.toBeUndefined();
    await expect(announceMigrationPending(async () => { throw new Error('boom'); }, 72, 73)).resolves.toBeUndefined();
  });

  it('callback qui ne se résout jamais : abandonné dans le plafond', async () => {
    const t0 = Date.now();
    await announceMigrationPending(() => new Promise<void>(() => {}), 72, 73, 100);
    const dt = Date.now() - t0;
    expect(dt).toBeGreaterThanOrEqual(90);
    expect(dt).toBeLessThan(1000);
  });
});
