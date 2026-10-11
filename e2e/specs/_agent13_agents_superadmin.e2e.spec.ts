/**
 * QA terrain agent-13 — page « Gestion des Agents » sous SUPER ADMIN (instance isolée, réseau coupé, aucune donnée réelle).
 * Comparaison avec ADMINISTRATEUR_SITE : mêmes actions, périmètre, rôles attribuables.
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import {
  sleep, sqlRead, loginKey, goAgents, setWindow1366, readAllRows, readStats, toasts, pushLabel, createAgentUI, openNewModal,
  modalInventory, shot, PWD, openEdit, clickRowBtn, confirmDialog, dismissAlerts, setRoles, submitModal
} from './_agent13_agents_helpers';

const log = (...a: any[]) => console.log('[AGSA]', ...a);
const J = (x: any) => JSON.stringify(x);
const noLic = (t: string[]) => t.filter((x) => !/LICENCE/.test(x));

test.describe.serial('QA terrain — Gestion des Agents sous SUPER ADMIN', () => {
  test.setTimeout(600_000);
  let S: E2EEnvironment; let failed = false;
  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => { if (S) await teardownSeededApp(S, failed).catch(() => undefined); });
  const step = async (name: string, fn: () => Promise<void>) => { try { await fn(); } catch (e: any) { log(`!! ÉTAPE EN ÉCHEC « ${name} » :`, String(e?.message || e).split('\n')[0].slice(0, 300)); await dismissAlerts(S).catch(() => undefined); } };

  test('SUPER ADMIN : page, rôles attribuables, actions', async () => {
    S = await launchSeededApp();
    await loginKey(S, 'superAdmin');
    await setWindow1366(S);
    log('route après login =', await S.window.evaluate(() => location.hash));
    await goAgents(S);
    log('sous-titre =', await S.window.evaluate(() => (document.querySelector('h2')?.nextElementSibling as HTMLElement)?.innerText));
    const rows = await readAllRows(S);
    log('lignes SUPER ADMIN =', J(rows.map((r) => ({ l: r.login, site: r.site, btn: r.buttons.length }))));
    log('stats', J(await readStats(S)), 'push', J(await pushLabel(S)));
    await shot(S, 'SA-01-liste');
    await openNewModal(S);
    log('rôles proposés au SUPER ADMIN =', J(await S.window.evaluate(() => Array.from(document.querySelectorAll('form label')).map((l) => (l as HTMLElement).innerText).filter((t) => /Opérateur|Administrateur/.test(t)))));
    log('centres proposés =', J(await S.window.evaluate(() => Array.from(document.querySelectorAll('select.form-select option')).map((o) => (o as HTMLElement).innerText))));
    await S.window.getByRole('button', { name: 'Annuler' }).click(); await sleep(300);
    await step('création ADMINISTRATEUR_SITE par SUPER ADMIN', async () => {
      const r = await createAgentUI(S, { login: 'ZZTEST_SA_ADM', password: 'Mdp-ADM_2026', nom: 'ADMNOM', roles: ['ADMINISTRATEUR_SITE'], centreId: null });
      log('création ADMINISTRATEUR_SITE ->', J(noLic(r.toasts)), J(await sqlRead(S, `SELECT login,role,site_id,centre_id,is_dirty FROM t_users WHERE login='ZZTEST_SA_ADM'`)));
    });
    await step('création opérateur', async () => {
      const r = await createAgentUI(S, { login: 'ZZTEST_SA_OP', password: 'Mdp-OP_2026', nom: 'OPNOM', roles: ['OPERATEUR_SAISIE'], centreId: 1 });
      log('création opérateur ->', J(noLic(r.toasts)), J(await sqlRead(S, `SELECT login,role,site_id,centre_id,is_dirty FROM t_users WHERE login='ZZTEST_SA_OP'`)), 'push', J(await pushLabel(S)));
    });
    await step('Modifier / reset / désactiver / réactiver / supprimer sous SUPER ADMIN', async () => {
      await goAgents(S);
      await openEdit(S, 'ZZTEST_SA_OP'); await S.window.getByPlaceholder('Prénoms').fill('MODSA'); await setRoles(S.window, ['OPERATEUR_QUALITE']); await submitModal(S);
      log('SA modifier ->', J(noLic(await toasts(S))), J(await sqlRead(S, `SELECT role,prenom_user,is_dirty FROM t_users WHERE login='ZZTEST_SA_OP'`)));
      await clickRowBtn(S, 'ZZTEST_SA_OP', 'Désactiver'); await confirmDialog(S, PWD);
      log('SA désactiver ->', J(noLic(await toasts(S))), J(await sqlRead(S, `SELECT statut_actif FROM t_users WHERE login='ZZTEST_SA_OP'`)), 'stats', J(await readStats(S)));
      await clickRowBtn(S, 'ZZTEST_SA_OP', 'Activer'); await confirmDialog(S, PWD);
      log('SA réactiver ->', J(noLic(await toasts(S))), J(await sqlRead(S, `SELECT statut_actif FROM t_users WHERE login='ZZTEST_SA_OP'`)));
      await clickRowBtn(S, 'ZZTEST_SA_OP', 'Réinitialiser le mot de passe'); await confirmDialog(S, PWD);
      log('SA reset mdp ->', J(noLic(await toasts(S)).map((t) => t.slice(0, 80))));
      await clickRowBtn(S, 'ZZTEST_SA_OP', 'Supprimer définitivement'); await confirmDialog(S, PWD); await sleep(1500);
      log('SA supprimer (hors ligne) ->', J(noLic(await toasts(S))), J(await sqlRead(S, `SELECT login,statut_actif,is_dirty FROM t_users WHERE login='ZZTEST_SA_OP'`)), 'UI =', (await readAllRows(S)).filter((r) => r.login === 'ZZTEST_SA_OP').length);
    });
    await step('SUPER ADMIN : IPC rôle SUPER ADMIN attribuable', async () => {
      const r = await S.window.evaluate(async () => { try { return await (window as any).api.users.create({ login: 'ZZTEST_SA_SA', password: 'Mdp-SA_2026', nom: 'SA2', roles: ['SUPER ADMIN'], role: 'SUPER ADMIN', site_id: 1, statut_actif: 1 }); } catch (e: any) { return 'ERR ' + e.message; } });
      log('SUPER ADMIN crée SUPER ADMIN (IPC) ->', J(r), J(await sqlRead(S, `SELECT login,role FROM t_users WHERE login='ZZTEST_SA_SA'`)));
    });
  });
});
