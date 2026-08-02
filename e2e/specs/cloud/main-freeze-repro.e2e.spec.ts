/**
 * SCRATCH REPRO — agent-5-qa-optimisation investigation (NOT part of the
 * permanent suite, not meant to be committed). Goal: reproduce a main-process
 * event-loop freeze by racing a real downstream pull (which delegates its
 * SQLite writes to download-worker.js, busy_timeout=60000ms, on a SEPARATE
 * better-sqlite3 connection to the SAME WAL file) against a concurrent
 * cartes:create IPC call on the main thread's OWN connection
 * (busy_timeout=30000ms in src/main/database/connection.ts).
 *
 * Hypothesis under test: better-sqlite3 is fully synchronous — ANY call on
 * the main thread's connection blocks the ENTIRE Node event loop (hence the
 * whole Electron UI/CDP thread) while SQLite's busy-handler retries against
 * a write lock held by another connection (a Worker thread here). If the
 * download-worker's transaction is still running when cartes:create's own
 * synchronous statements try to write, main freezes silently for up to its
 * busy_timeout, with zero log output (logging itself runs on the frozen
 * thread) and total IPC/CDP unresponsiveness — matching the reported ~56s
 * main.log silence and Playwright .fill() timeout.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../../fixtures/electron-app';
import { getTestUser } from '../../fixtures/test-users';
import {
  ensureCloudSiteAndCentre,
  supabaseDev,
  cleanupAllCloudTestData
} from '../../fixtures/supabase-dev-client';

const RUN_ID = Date.now();

test.describe.serial('REPRO — freeze main process pendant pull cloud + création concurrente', () => {
  let env: E2EEnvironment;
  let mainSiteId: number;
  let mainCentreId: number;
  let anyTestFailed = false;

  test.beforeAll(async () => {
    env = await launchSeededApp({ allowRealSync: true });
    mainSiteId = env.seed.siteId;
    mainCentreId = env.seed.centreId;
    await ensureCloudSiteAndCentre(mainSiteId, mainCentreId);

    // Pose un volume de cartes ZZTEST_ côté cloud pour allonger la durée de
    // la transaction du download-worker (grossir la fenêtre de contention
    // avec l'écriture concurrente côté main thread). Un seul INSERT bulk
    // (au lieu de 300 round-trips séquentiels, qui dépassait le timeout du
    // hook beforeAll).
    const BATCH = 300;
    const rows = Array.from({ length: BATCH }, (_, i) => ({
      sync_id: `zztest-freeze-${RUN_ID}-${i}`,
      noms: 'ZZTEST_FREEZE',
      prenoms: `RECORD${i}`,
      date_naissance: '1990-01-01',
      rangement: `R${i % 50}`,
      statut: 'EN STOCK',
      id_site: mainSiteId,
      id_centre: mainCentreId,
      contact: '0102030400',
      num_secu: `ZZTEST-FREEZE-${i}`,
      updated_at: new Date().toISOString()
    }));
    const { error: bulkErr } = await supabaseDev.from('t_cartes').insert(rows);
    if (bulkErr) throw new Error(`[REPRO] Échec insertion bulk cloud : ${bulkErr.message}`);
    console.log(`[REPRO] ${BATCH} cartes ZZTEST_FREEZE posées sur le cloud dev (insert bulk unique).`);
  });

  test.afterAll(async () => {
    if (env) {
      await teardownSeededApp(env, anyTestFailed);
    }
    const residual = await cleanupAllCloudTestData();
    console.log(`[REPRO][CLEANUP] résiduel -> ${JSON.stringify(residual)}`);
  });

  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) anyTestFailed = true;
  });

  test('pull réel (300 cartes) déclenché puis cartes:create concurrent -> mesure du temps de blocage IPC', async () => {
    const { window } = env;
    const user = getTestUser('operateurVerification');
    await window.waitForURL(/#\/login/);
    await window.getByTestId('login-input').fill(user.login);
    await window.getByTestId('password-input').fill(user.password);
    await window.getByTestId('login-submit').click();
    await window.waitForURL(/#\/agent-verification$/, { timeout: 15000 });

    // Déclenche le pull réel SANS attendre sa résolution (fire-and-forget côté
    // renderer), pour créer la fenêtre de contention pendant que le
    // download-worker écrit ses chunks de 300 cartes en SQLite.
    const pullPromise = window.evaluate(
      ({ siteId, user }) => (window as any).api.sync.pullSiteCards(siteId, user),
      { siteId: mainSiteId, user }
    );

    // Attend un court instant pour laisser le pull entrer en phase d'écriture
    // (requête réseau Supabase + spawn du worker), puis tire une rafale de
    // cartes:create concurrentes en mesurant le temps de round-trip IPC de
    // chacune. Un round-trip anormalement long (plusieurs secondes à dizaines
    // de secondes) sur un simple INSERT confirmerait un blocage du thread
    // principal (event loop) plutôt qu'un simple ralentissement réseau (qui
    // n'affecterait pas ces écritures 100% locales).
    await window.waitForTimeout(500);

    const timings: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      await window.evaluate(
        ({ siteId, centreId, i, runId }) => {
          return (window as any).api.cartes.create({
            noms: 'ZZTEST_ANCHOR_LOCAL',
            prenoms: `CONCURRENT${i}`,
            date_de_naissance: '1985-05-05',
            rangement: 'PZ',
            statut: 'EN STOCK',
            site_id: siteId,
            centre_id: centreId,
            contact: `010203${1000 + i}`,
            num_secu: `ZZTEST-ANCHOR-${runId}-${i}`,
            agent_saisie: 'E2E_REPRO_FREEZE'
          });
        },
        { siteId: mainSiteId, centreId: mainCentreId, i, runId: RUN_ID }
      );
      const elapsed = Date.now() - t0;
      timings.push(elapsed);
      console.log(`[REPRO] cartes:create #${i} round-trip IPC = ${elapsed} ms`);
    }

    const pullResult = await pullPromise;
    console.log(`[REPRO] Résultat du pull -> ${JSON.stringify(pullResult)}`);

    const maxTiming = Math.max(...timings);
    console.log(`[REPRO] Timing max observé sur les 5 cartes:create concurrents = ${maxTiming} ms`);
    // Pas d'assertion stricte ici volontairement (script de diagnostic) — le
    // seul but est d'observer/loguer les temps de blocage réels.
    expect(timings.length).toBe(5);
  });
});
