/**
 * Helpers partagés des specs QA terrain agent-13 « Gestion des Agents » (AgentsPage).
 * Ne matche pas *.e2e.spec.ts : jamais découvert comme test. Projet Supabase DEV ajadkziqaskadlzboeqo UNIQUEMENT.
 */
import { join } from 'path';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Page } from '@playwright/test';
import type { E2EEnvironment } from '../fixtures/electron-app';
import { getTestUser } from '../fixtures/test-users';

const execFileAsync = promisify(execFile);
export const SHOT_DIR = join(__dirname, '..', '..', 'test-results', 'agent13-screenshots');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sqlRun(env: E2EEnvironment, sql: string, write = false): Promise<any[]> {
  const script = `
    const Database = require('better-sqlite3');
    const db = new Database(process.argv[1], { readonly: ${write ? 'false' : 'true'}, timeout: 20000 });
    try {
      const st = db.prepare(process.argv[2]);
      const out = st.reader ? st.all() : [st.run()];
      process.stdout.write('__Q__:' + JSON.stringify(out));
    } finally { db.close(); }`;
  const electronPath = require('electron') as unknown as string;
  const { stdout } = await execFileAsync(electronPath, ['-e', script, env.seed.dbPath, sql],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf-8' });
  return JSON.parse(stdout.split(/\r?\n/).reverse().find((l) => l.startsWith('__Q__:'))!.slice(6));
}
export const sqlRead = (env: E2EEnvironment, sql: string) => sqlRun(env, sql, false);
export const sqlWrite = (env: E2EEnvironment, sql: string) => sqlRun(env, sql, true);

export const appLog = (env: E2EEnvironment) => {
  const dir = join(env.userDataDir, 'logs');
  return existsSync(dir) ? readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n') : '';
};

export async function waitOnline(env: E2EEnvironment) {
  for (let i = 0; i < 120; i++) {
    const s = await env.window.evaluate(async () => { try { return (await (window as any).api.sync.getStatus()).state; } catch { return null; } });
    if (s === 'ONLINE') return true;
    await sleep(500);
  }
  return false;
}

export const PWD = 'E2E_Test_Pwd_2026!';

export async function dismissAlerts(env: E2EEnvironment): Promise<string[]> {
  const w = env.window; const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const ok = w.locator('button.btn-danger', { hasText: /^OK$/ });
    if (!(await ok.count())) break;
    const txt = await w.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button.btn-danger')).find((x) => (x as HTMLElement).innerText.trim() === 'OK') as HTMLElement | undefined;
      const card = b?.parentElement?.parentElement as HTMLElement | undefined;
      return (card?.innerText || '').replace(/[\r\n]+/g, ' | ');
    });
    out.push(txt);
    await ok.first().click();
    await sleep(400);
  }
  return out;
}

export async function loginUi(env: E2EEnvironment, login: string, password: string, expectOk = true): Promise<any> {
  const w = env.window;
  await dismissAlerts(env);
  await w.waitForURL(/#\/login/, { timeout: 30000 });
  await w.getByTestId('login-input').fill(login);
  await w.getByTestId('password-input').fill(password);
  await w.getByTestId('login-submit').click();
  if (expectOk) { await w.waitForFunction(() => !location.hash.includes('/login'), null, { timeout: 30000 }); return true; }
  await sleep(2500);
  const stillLogin = await w.evaluate(() => location.hash.includes('/login'));
  const alerts = await dismissAlerts(env);
  const toastTxt = await toasts(env);
  return { ok: !stillLogin, stillLogin, alerts, toasts: toastTxt };
}
export async function asUser(env: E2EEnvironment, login: string, pwd: string) {
  const onLogin = await env.window.evaluate(() => location.hash.includes('/login'));
  if (!onLogin) await logoutUi(env);
  return loginUi(env, login, pwd, true);
}
export const asAdmin = (env: E2EEnvironment) => asUser(env, 'E2E_ADMINISTRATEUR_SITE', PWD);
export async function readAllRows(env: E2EEnvironment): Promise<RowInfo[]> {
  const all: RowInfo[] = [];
  const w = env.window;
  // retour page 1
  for (let i = 0; i < 10; i++) { const prev = w.getByRole('button', { name: 'Précédent' }); if (await prev.count() && await prev.isEnabled()) await prev.click(); else break; await sleep(150); }
  for (let i = 0; i < 20; i++) {
    all.push(...(await readRows(env)));
    const next = w.getByRole('button', { name: 'Suivant' });
    if (await next.count() && await next.isEnabled()) { await next.click(); await sleep(250); } else break;
  }
  return all;
}

export async function loginKey(env: E2EEnvironment, key: string) {
  const u = getTestUser(key);
  return loginUi(env, u.login, u.password);
}
export async function logoutUi(env: E2EEnvironment) {
  await env.window.getByRole('button', { name: 'Déconnexion' }).click();
  await env.window.waitForURL(/#\/login/, { timeout: 15000 });
}
export async function goAgents(env: E2EEnvironment) {
  await env.window.evaluate(() => { window.location.hash = '#/dashboard'; });
  await sleep(500);
  await env.window.evaluate(() => { window.location.hash = '#/agents'; });
  await env.window.getByRole('heading', { name: 'Gestion des Agents' }).waitFor({ timeout: 20000 });
  await sleep(1200);
}
export async function setWindow1366(env: E2EEnvironment) {
  await env.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('splash'));
    if (w) { w.unmaximize(); w.setContentSize(1366, 768); }
  });
  await sleep(700);
}

export interface RowInfo {
  login: string; name: string; roles: string[]; site: string; centre: string; contact: string; last: string; statut: string; buttons: string[];
}
export async function readRows(env: E2EEnvironment): Promise<RowInfo[]> {
  return env.window.evaluate(() => Array.from(document.querySelectorAll('.table-row-hover')).map((r) => {
    const cells = Array.from(r.children) as HTMLElement[];
    const t = (i: number) => (cells[i]?.innerText || '').replace(/\n+/g, ' | ').trim();
    const loginTxt = (cells[0]?.innerText || '').split('\n').find((x) => x.trim().startsWith('@')) || '';
    return {
      login: loginTxt.replace('@', '').trim(),
      name: (cells[0]?.innerText || '').split('\n').filter((x) => x.trim() && !x.trim().startsWith('@')).slice(-1)[0] || '',
      roles: Array.from(cells[1]?.querySelectorAll('span') || []).map((s) => (s as HTMLElement).innerText.trim()),
      site: t(2), centre: t(3), contact: t(4), last: t(5), statut: t(6),
      buttons: Array.from(cells[7]?.querySelectorAll('button') || []).map((b) => b.getAttribute('title') || '')
    };
  }));
}
export async function readStats(env: E2EEnvironment) {
  return env.window.evaluate(() => Array.from(document.querySelectorAll('.card')).map((c) => (c as HTMLElement).innerText.replace(/\n+/g, ' ').trim()).filter((x) => /Total Agents|Agents Actifs|Administrateurs|Opérateurs/.test(x)));
}
export async function toasts(env: E2EEnvironment): Promise<string[]> {
  return env.window.evaluate(() => Array.from(document.querySelectorAll('[role="status"]')).map((e) => (e as HTMLElement).innerText.replace(/\n+/g, ' ').trim()).filter(Boolean));
}
export async function pushLabel(env: E2EEnvironment) {
  return env.window.evaluate(() => {
    const bs = Array.from(document.querySelectorAll('button')).filter((b) => /Envoyer vers le Cloud|Synchronisation en cours/.test(b.innerText));
    const b = bs[0] as HTMLButtonElement | undefined;
    const upToDate = document.body.innerText.includes('À jour');
    return { label: b?.innerText.trim() || null, disabled: b?.disabled ?? null, upToDate };
  });
}
export async function searchBox(env: E2EEnvironment, text: string) {
  await env.window.getByPlaceholder('Rechercher un agent...').fill(text);
  await sleep(400);
}
export async function refreshList(env: E2EEnvironment) {
  await env.window.locator('button[title="Rafraîchir la liste"]').click();
  await sleep(1500);
}

export interface NewAgent { login: string; password: string; nom: string; prenom?: string; roles: string[]; centreId?: number | null }
const ROLE_LABEL: Record<string, string> = {
  OPERATEUR_VERIFICATION: 'Opérateur de Vérification', OPERATEUR_SAISIE: 'Opérateur de Saisie', OPERATEUR_LOGISTIQUE: 'Opérateur Logistique',
  OPERATEUR_QUALITE: 'Opérateur Qualité', OPERATEUR_APUREMENT: 'Opérateur Apurement', ADMINISTRATEUR_SITE: 'Administrateur de Site', ADMIN_CENTRE: 'Administrateur de Centre'
};
export async function openNewModal(env: E2EEnvironment) {
  await env.window.getByRole('button', { name: /Nouvel Agent/ }).click();
  await env.window.getByRole('heading', { name: /Nouvel Agent/ }).waitFor({ timeout: 5000 });
}
export async function setRoles(w: Page, roles: string[]) {
  // coche d'abord les rôles voulus puis décoche les autres (le dernier rôle ne peut pas être décoché)
  for (const r of roles) {
    const cb = w.locator('label', { hasText: ROLE_LABEL[r] }).locator('input[type=checkbox]');
    if (await cb.count() === 0) throw new Error('case rôle introuvable: ' + r);
    if (!(await cb.isChecked())) await cb.check();
  }
  for (const r of Object.keys(ROLE_LABEL)) {
    if (roles.includes(r)) continue;
    const cb = w.locator('label', { hasText: ROLE_LABEL[r] }).locator('input[type=checkbox]');
    if (await cb.count() && await cb.isChecked()) await cb.uncheck();
  }
}
export async function fillAgentForm(env: E2EEnvironment, a: NewAgent, isNew = true) {
  const w = env.window;
  await w.getByPlaceholder('ex: agent_abobo').fill(a.login);
  if (isNew) await w.locator('input[placeholder="••••••••"]').first().fill(a.password);
  await w.getByPlaceholder('NOM DE FAMILLE').fill(a.nom);
  await w.getByPlaceholder('Prénoms').fill(a.prenom || '');
  await setRoles(w, a.roles);
  await w.locator('select.form-select').selectOption(a.centreId ? String(a.centreId) : '');
}
export async function submitModal(env: E2EEnvironment) {
  await env.window.getByRole('button', { name: /Créer l'agent|Mettre à jour/ }).click();
  await sleep(1500);
}
export async function createAgentUI(env: E2EEnvironment, a: NewAgent) {
  await openNewModal(env);
  await fillAgentForm(env, a, true);
  await submitModal(env);
  const modalOpen = await env.window.getByRole('heading', { name: /Nouvel Agent|Modifier l'agent/ }).count();
  return { toasts: await toasts(env), modalStillOpen: modalOpen > 0 };
}
export function rowLocator(w: Page, login: string) {
  return w.locator('.table-row-hover', { has: w.locator(`text="@${login}"`) });
}
export async function clickRowBtn(env: E2EEnvironment, login: string, title: string) {
  await searchBox(env, login);
  await rowLocator(env.window, login).locator(`button[title="${title}"]`).click();
}
export async function confirmDialog(env: E2EEnvironment, adminPwd?: string, accept = true) {
  const w = env.window;
  await sleep(500);
  const hasPwd = await w.locator('input[autocomplete="current-password"]').count();
  const dlgText = await w.locator('p:near(h3)').first().innerText().catch(() => '');
  if (!accept) { await w.getByRole('button', { name: 'Annuler' }).last().click(); await sleep(500); return { hasPwd, dlgText }; }
  if (hasPwd && adminPwd !== undefined) await w.locator('input[autocomplete="current-password"]').fill(adminPwd);
  await w.getByRole('button', { name: 'Confirmer' }).click();
  await sleep(1800);
  return { hasPwd, dlgText };
}
export async function openEdit(env: E2EEnvironment, login: string) {
  await clickRowBtn(env, login, 'Modifier');
  await env.window.getByRole('heading', { name: "Modifier l'agent" }).waitFor({ timeout: 5000 });
}
export async function modalInventory(env: E2EEnvironment) {
  return env.window.evaluate(() => {
    const form = document.querySelector('form');
    if (!form) return null;
    return {
      inputs: Array.from(form.querySelectorAll('input,select')).map((i) => `${i.tagName}:${(i as HTMLInputElement).type || ''}:${(i as HTMLInputElement).placeholder || ''}`),
      buttons: Array.from(form.querySelectorAll('button')).map((b) => (b as HTMLElement).innerText.trim() || b.getAttribute('title') || 'icon')
    };
  });
}
export async function shot(env: E2EEnvironment, name: string) {
  await env.window.screenshot({ path: join(SHOT_DIR, `agent13-AG-${name}.png`) });
}
