/**
 * QA terrain agent-13 — page « Gestion des Agents » (AgentsPage) contre le VRAI Postgres DEV ajadkziqaskadlzboeqo.
 * JAMAIS la production. Poste admin = A (ADMINISTRATEUR_SITE), second poste du même site = B.
 * Phases : S1 création/validations/push/téléchargement, S2 lot multi-rôles, S3 actions (Modifier, mot de passe,
 * Désactiver/Activer, Supprimer), S4 « Dernière co. », S6 affichage 1366x768, cycle 3 min, S5 sécurité IPC (fin).
 * Chaque étape est encapsulée (step) : un échec d'étape est journalisé sans interrompre la suite (exploration).
 */
import { test, expect } from '@playwright/test';
import { launchSeededApp, teardownSeededApp, type E2EEnvironment } from '../fixtures/electron-app';
import { supabaseDev, ensureCloudSiteAndCentre, E2E_CLOUD_SUPABASE_URL } from '../fixtures/supabase-dev-client';
import {
  sleep, sqlRead, sqlWrite, waitOnline, loginKey, loginUi, logoutUi, asAdmin, asUser, goAgents, setWindow1366, readRows, readAllRows, readStats,
  toasts, pushLabel, createAgentUI, openNewModal, fillAgentForm, submitModal, modalInventory, shot, PWD, searchBox, refreshList,
  openEdit, clickRowBtn, confirmDialog, dismissAlerts, setRoles, type NewAgent
} from './_agent13_agents_helpers';

const P = 'ZZTEST_AG_';
const log = (...a: any[]) => console.log('[AG]', ...a);
const J = (x: any) => JSON.stringify(x);
const noLic = (t: string[]) => t.filter((x) => !/LICENCE/.test(x));

test.describe.serial('QA terrain — Gestion des Agents (cloud dev)', () => {
  test.setTimeout(2_700_000);
  let A: E2EEnvironment; let B: E2EEnvironment; let failed = false;
  const COLS = 'id_user, login, role, nom_user, prenom_user, email, telephone, statut_actif, site_id, centre_id, sync_id, is_dirty, synced_at, last_login, substr(password_hash,8,14) AS pw14';
  const cloudUser = async (login: string) => (await supabaseDev.from('t_users').select('id_user,login,role,nom_user,prenom_user,email,telephone,statut_actif,site_id,centre_id,sync_id,last_login,updated_at,password_hash').eq('login', login).maybeSingle()).data as any;
  const cloudRoles = async (sync: string) => ((await supabaseDev.from('t_user_roles').select('role').eq('user_sync_id', sync)).data || []).map((r: any) => r.role).sort();
  const localUser = async (env: E2EEnvironment, login: string) => (await sqlRead(env, `SELECT ${COLS} FROM t_users WHERE login='${login.replace(/'/g, "''")}'`))[0];
  const localRoles = async (env: E2EEnvironment, login: string) => (await sqlRead(env, `SELECT r.role FROM t_user_roles r JOIN t_users u ON u.id_user=r.id_user WHERE u.login='${login}' ORDER BY r.role`)).map((r: any) => r.role);
  const hashOf = async (login: string) => (await cloudUser(login))?.password_hash as string | undefined;
  const pick = (u: any) => u ? { role: u.role, nom: u.nom_user, pre: u.prenom_user, actif: u.statut_actif, centre: u.centre_id, site: u.site_id, email: u.email, tel: u.telephone, last_login: u.last_login, dirty: u.is_dirty, pw: u.pw14 || (u.password_hash ? u.password_hash.slice(7, 21) : undefined) } : null;
  const cmp = async (login: string) => {
    const a = await localUser(A, login); const b = B ? await localUser(B, login) : null; const c = await cloudUser(login);
    return { A: pick(a), B: pick(b), cloud: pick(c), rolesA: await localRoles(A, login), rolesB: B ? await localRoles(B, login) : null, rolesCloud: c ? await cloudRoles(c.sync_id) : null };
  };
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e: any) { log(`!! ÉTAPE EN ÉCHEC « ${name} » :`, String(e?.message || e).split('\n')[0].slice(0, 400)); for (const env of [A, B]) { try { if (env) await dismissAlerts(env); } catch { /* */ } } }
  };
  const downloadOnB = async () => { await B.window.getByRole('button', { name: /Télécharger les agents/ }).click(); await sleep(4500); return noLic(await toasts(B)); };
  const pushAll = async () => { await sleep(7000); };
  const agent = (k: string, roles: string[], centreId: number, extra: Partial<NewAgent> = {}): NewAgent => ({ login: P + k, password: 'Mdp-' + k + '_2026', nom: k + 'NOM', prenom: k + 'PRE', roles, centreId, ...extra });

  test.afterEach(async ({}, ti) => { if (ti.status !== ti.expectedStatus) failed = true; });
  test.afterAll(async () => {
    try {
      const { data: us } = await supabaseDev.from('t_users').select('sync_id,login').or('login.like.ZZTEST_%,login.like.E2E_%');
      for (const u of us || []) {
        await supabaseDev.from('t_user_presence').delete().eq('user_sync_id', u.sync_id);
        await supabaseDev.from('t_user_roles').delete().eq('user_sync_id', u.sync_id);
      }
      await supabaseDev.from('t_logs').delete().eq('site_id', 1);
      await supabaseDev.from('t_cartes').delete().like('sync_id', 'zztest-ag-%');
      for (const u of us || []) await supabaseDev.from('t_users').delete().eq('sync_id', u.sync_id);
      await supabaseDev.from('t_centres').delete().ilike('nom', 'ZZTEST_%');
      await supabaseDev.from('t_sites').delete().ilike('nom', 'ZZTEST_%');
      const left = await Promise.all(['t_users', 't_user_roles', 't_user_presence', 't_logs', 't_cartes', 't_centres', 't_sites'].map(async (t) => `${t}=${(await supabaseDev.from(t).select('*', { count: 'exact', head: true })).count}`));
      log('CLEANUP résiduel cloud: ' + left.join(' '));
    } catch (e) { console.error('[AG] cleanup échec', e); }
    for (const e of [A, B]) { if (e) try { await teardownSeededApp(e, failed); } catch { /* */ } }
  });

  test('00 setup : poste admin A + cloud dev', async () => {
    expect(E2E_CLOUD_SUPABASE_URL).toContain('ajadkziqaskadlzboeqo');
    expect(E2E_CLOUD_SUPABASE_URL).not.toContain('itvyayakwgzvfqvdrgyv');
    log('état initial cloud dev:', (await Promise.all(['t_users', 't_user_roles', 't_user_presence', 't_logs', 't_cartes', 't_centres', 't_sites'].map(async (t) => `${t}=${(await supabaseDev.from(t).select('*', { count: 'exact', head: true })).count}`))).join(' '));
    A = await launchSeededApp({ allowRealSync: true });
    expect(await waitOnline(A)).toBe(true);
    await ensureCloudSiteAndCentre(A.seed.siteId, A.seed.centreId);
    for (const [id, n] of [[2, 'ZZTEST_QA_Centre2'], [3, 'ZZTEST_QA_Centre3']] as const) {
      const r = await supabaseDev.from('t_centres').upsert({ id, site_id: A.seed.siteId, nom: n, numero: id, sync_id: `zztest-ag-centre-${id}` }, { onConflict: 'id' });
      expect(r.error?.message).toBeUndefined();
    }
    const full = (await sqlRead(A, `SELECT * FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`))[0];
    const ins = await supabaseDev.from('t_users').insert({ login: full.login, password_hash: full.password_hash, role: full.role, nom_user: full.nom_user, prenom_user: full.prenom_user, statut_actif: 1, site_id: full.site_id, centre_id: null, sync_id: full.sync_id });
    expect(ins.error?.message).toBeUndefined();
    await loginKey(A, 'administrateurSite');
    log('pullCentres A =', J(await A.window.evaluate(async (sid) => (window as any).api.hierarchy.pullCentres(sid), A.seed.siteId)));
    await setWindow1366(A);
    await goAgents(A);
    log('stats initiales A', J(await readStats(A)), 'push', J(await pushLabel(A)));
  });

  test('S1a validations de création (A)', async () => {
    await openNewModal(A);
    log('S1 modal CRÉATION inventaire =', J(await modalInventory(A)));
    await shot(A, '02-modal-creation-1366');
    await step('submit vide', async () => {
      await A.window.getByRole('button', { name: /Créer l'agent/ }).click(); await sleep(500);
      log('S1 submit vide -> modal ouvert =', await A.window.getByRole('heading', { name: /Nouvel Agent/ }).count(), 'toasts', J(noLic(await toasts(A))));
    });
    await step('mdp court/faible', async () => {
      await fillAgentForm(A, { login: P + 'SHORT', password: '12345', nom: 'COURT', roles: ['OPERATEUR_VERIFICATION'], centreId: 1 });
      await submitModal(A);
      log('S1 mdp 5 car -> toasts', J(noLic(await toasts(A))), 'créé ?', J(!!(await localUser(A, P + 'SHORT'))));
      await A.window.locator('input[placeholder="••••••••"]').first().fill('123456');
      await submitModal(A);
      log('S1 mdp "123456" (faible) -> toasts', J(noLic(await toasts(A))), 'créé ?', J(!!(await localUser(A, P + 'SHORT'))));
      await sleep(2500);
    });
    await step('opérateur sans centre', async () => {
      await openNewModal(A);
      await fillAgentForm(A, { login: P + 'NOCENTRE', password: 'Abc123!x', nom: 'SANSCENTRE', roles: ['OPERATEUR_SAISIE'], centreId: null });
      await A.window.getByRole('button', { name: /Créer l'agent/ }).click(); await sleep(500);
      log('S1 opérateur sans centre -> modal ouvert =', await A.window.getByRole('heading', { name: /Nouvel Agent/ }).count(), 'créé ?', J(!!(await localUser(A, P + 'NOCENTRE'))));
      await A.window.getByRole('button', { name: 'Annuler' }).click(); await sleep(400);
    });
    await step('logins spéciaux', async () => {
      for (const [i, l] of [P + 'AVEC ESPACE', P + 'éàù@#', P + "O'BRIEN<b>"].entries()) {
        const r = await createAgentUI(A, { login: l, password: 'Abc123!x', nom: 'SPECIAL' + i, roles: ['OPERATEUR_VERIFICATION'], centreId: 1 });
        log(`S1 login spécial ${J(l)} ->`, J(noLic(r.toasts)), 'stocké =', J((await localUser(A, l))?.login));
      }
    });
  });

  test('S1b création complète ONE + cloud + doublon (A)', async () => {
    await step('création ONE', async () => {
      const r = await createAgentUI(A, agent('ONE', ['OPERATEUR_VERIFICATION'], 2, { password: 'Un-Mdp_2026' }));
      log('S1 création ONE toasts', J(noLic(r.toasts)));
      const l0 = await localUser(A, P + 'ONE');
      log('S1 local ONE immédiat', J(pick(l0)));
      await sleep(6000);
      log('S1 local ONE +6s', J(pick(await localUser(A, P + 'ONE'))));
      const c = await cloudUser(P + 'ONE');
      log('S1 cloud ONE +6s', J({ ...pick(c), sync_id: c?.sync_id, id_user_cloud: c?.id_user }), 'rôles cloud', J(await cloudRoles(l0.sync_id)), 'sync_id local=cloud', l0.sync_id === c?.sync_id);
      log('S1 push label', J(await pushLabel(A)));
      await shot(A, '03-apres-creation-ONE');
    });
    await step('doublon', async () => {
      const hBefore = await hashOf(P + 'ONE');
      const d = await createAgentUI(A, { login: P + 'ONE', password: 'Autre_mdp_99', nom: 'ECRASE', prenom: 'DOUBLON', roles: ['OPERATEUR_QUALITE'], centreId: 3 });
      log('S1 DOUBLON login exact -> toasts', J(noLic(d.toasts)), 'local après =', J(pick(await localUser(A, P + 'ONE'))));
      await sleep(5000);
      log('S1 DOUBLON hash cloud changé =', (await hashOf(P + 'ONE')) !== hBefore, 'cloud =', J(pick(await cloudUser(P + 'ONE'))));
      const d2 = await createAgentUI(A, { login: P + 'one', password: 'Autre_mdp_99', nom: 'CASSE', roles: ['OPERATEUR_QUALITE'], centreId: 3 });
      log('S1 login casse différente accepté ->', J(noLic(d2.toasts)), J(await sqlRead(A, `SELECT login,nom_user FROM t_users WHERE login LIKE '${P}ONE' COLLATE NOCASE`)));
    });
  });

  test('S1c poste B : téléchargement, connexion de ONE, chaîne last_login (S4)', async () => {
    B = await launchSeededApp({ allowRealSync: true });
    expect(await waitOnline(B)).toBe(true);
    await loginKey(B, 'administrateurSite');
    await setWindow1366(B);
    await goAgents(B);
    await step('téléchargement', async () => {
      log('S1 B avant téléchargement (logins)', J((await readAllRows(B)).map((x) => x.login)));
      log('S1 B toasts téléchargement', J(await downloadOnB()));
      log('S1 ONE (A/B/cloud)', J(await cmp(P + 'ONE')));
      log('S1 B lignes ONE UI', J((await readAllRows(B)).filter((x) => x.login === P + 'ONE')));
      await shot(B, '04-B-apres-telechargement');
    });
    await step('connexion ONE sur B', async () => {
      await logoutUi(B);
      log('S1 B login ONE avec ANCIEN mdp (écrasé par doublon) ->', J(await loginUi(B, P + 'ONE', 'Un-Mdp_2026', false)));
      const r = await loginUi(B, P + 'ONE', 'Autre_mdp_99', false);
      log('S1 B login ONE avec NOUVEAU mdp ->', J(r), 'hash=', await B.window.evaluate(() => location.hash));
      await sleep(9000);
      const loc = await localUser(B, P + 'ONE'); const c = await cloudUser(P + 'ONE');
      const pres = (await supabaseDev.from('t_user_presence').select('*').eq('user_sync_id', c.sync_id)).data;
      log('S4 après login de ONE sur B : B.local.last_login =', loc.last_login, '| cloud.t_users.last_login =', c.last_login, '| cloud.t_user_presence =', J(pres));
      await logoutUi(B);
      await asAdmin(B); await goAgents(B);
    });
  });

  test('S4 « Dernière co. » vu depuis le poste admin A', async () => {
    await step('S4 A', async () => {
      await goAgents(A); await refreshList(A);
      const rows = await readAllRows(A);
      log('S4 A : colonne Dernière co. =', J(rows.map((r) => `${r.login}=${r.last}`)));
      log('S4 A local ONE.last_login =', (await localUser(A, P + 'ONE')).last_login, '| admin A.last_login =', (await localUser(A, 'E2E_ADMINISTRATEUR_SITE')).last_login);
      const lg = await sqlRead(A, `SELECT action, login_user, substr(date_action,1,19) d FROM t_logs WHERE action='LOGIN' ORDER BY id_log DESC LIMIT 5`).catch((e) => String(e).slice(0, 150));
      log('S4 A t_logs LOGIN =', J(lg));
      await shot(A, '05-S4-derniere-co-A');
    });
  });

  test('S2 lot de 7 agents multi-rôles/centres + compteurs + recherche + pagination', async () => {
    const batch: NewAgent[] = [
      agent('VERIF', ['OPERATEUR_VERIFICATION'], 1), agent('QUAL', ['OPERATEUR_QUALITE'], 2), agent('SAISIE', ['OPERATEUR_SAISIE'], 3),
      agent('LOGI', ['OPERATEUR_LOGISTIQUE'], 1), agent('APUR', ['OPERATEUR_APUREMENT'], 2), agent('ADMC', ['ADMIN_CENTRE'], 3),
      agent('MULTI', ['OPERATEUR_SAISIE', 'OPERATEUR_QUALITE', 'OPERATEUR_VERIFICATION'], 1)
    ];
    await goAgents(A);
    for (const a of batch) {
      await step('création ' + a.login, async () => {
        const r = await createAgentUI(A, a);
        log(`S2 création ${a.login} [${a.roles.join('+')}] centre=${a.centreId} ->`, J(noLic(r.toasts)), 'modal ouvert =', r.modalStillOpen);
      });
    }
    await step('INVENTAIRE via UI ?', async () => {
      await openNewModal(A);
      const has = await A.window.locator('label', { hasText: /Inventaire/ }).count();
      log('S2 case rôle OPERATEUR_INVENTAIRE présente dans le modal UI =', has > 0);
      await A.window.getByRole('button', { name: 'Annuler' }).click(); await sleep(300);
      const r = await A.window.evaluate(async (d) => { try { return await (window as any).api.users.create(d); } catch (e: any) { return 'ERR ' + e.message; } },
        { login: P + 'INV', password: 'Mdp-INV_2026', nom: 'INVNOM', prenom: 'INVPRE', roles: ['OPERATEUR_INVENTAIRE'], role: 'OPERATEUR_INVENTAIRE', centre_id: 1, statut_actif: 1, site_id: 1 });
      log('S2 création INVENTAIRE via IPC ->', J(r));
    });
    await pushAll();
    await goAgents(A);
    await step('états A/cloud', async () => {
      const rows = await readAllRows(A);
      log('S2 A lignes ZZTEST =', J(rows.filter((x) => x.login.startsWith(P)).map((x) => ({ l: x.login.replace(P, ''), roles: x.roles, centre: x.centre, last: x.last, statut: x.statut }))));
      const st = await readStats(A);
      const exp = { total: rows.length, actifs: rows.filter((r) => /Actif/.test(r.statut) && !/Désactivé/.test(r.statut)).length, admins: rows.filter((r) => r.roles.some((x) => ['ADMINISTRATEUR_SITE', 'ADMIN_CENTRE'].includes(x))).length };
      log('S2 compteurs UI =', J(st), '| recomptés depuis lignes (rôle affiché, multi-rôles inclus) =', J(exp));
      log('S2 pagination texte =', await A.window.evaluate(() => (Array.from(document.querySelectorAll('div')).find((d) => /^Affichage de/.test((d as HTMLElement).innerText || '') && d.children.length < 6) as HTMLElement | undefined)?.innerText));
      for (const k of ['VERIF', 'QUAL', 'SAISIE', 'LOGI', 'APUR', 'ADMC', 'MULTI', 'INV']) log(`S2 cmp ${k} (A/cloud)`, J(await cmp(P + k)));
      log('S2 push label', J(await pushLabel(A)));
      await shot(A, '06-S2-liste-1366');
    });
    await step('recherche', async () => {
      for (const t of ['multi', 'qualite', 'ZZTEST_AG_QU', 'sansrésultat', 'e2e']) { await searchBox(A, t); log(`S2 recherche "${t}" ->`, J((await readAllRows(A)).map((r) => r.login))); }
      await searchBox(A, '');
    });
    await step('B télécharge', async () => {
      log('S2 B toasts', J(await downloadOnB()));
      for (const k of ['VERIF', 'MULTI', 'ADMC', 'INV']) log(`S2 cmp ${k} (A/B/cloud)`, J(await cmp(P + k)));
      log('S2 B stats', J(await readStats(B)), 'push', J(await pushLabel(B)));
    });
  });

  test('S3a Modifier (A)', async () => {
    await goAgents(A);
    await step('inventaire modal édition', async () => {
      await openEdit(A, P + 'MULTI');
      log('S3a modal ÉDITION inventaire =', J(await modalInventory(A)));
      await shot(A, '07-modal-edition');
      await A.window.getByRole('button', { name: 'Annuler' }).click(); await sleep(400);
      log('S3a annulation -> MULTI inchangé =', J((await cmp(P + 'MULTI')).A));
    });
    await step('modif MULTI (nom, prénom, rôles, centre)', async () => {
      await openEdit(A, P + 'MULTI');
      await A.window.getByPlaceholder('NOM DE FAMILLE').fill('MULTIMOD');
      await A.window.getByPlaceholder('Prénoms').fill('PRENOMMOD');
      await setRoles(A.window, ['OPERATEUR_SAISIE', 'OPERATEUR_LOGISTIQUE']);
      await A.window.locator('select.form-select').selectOption('3');
      await submitModal(A);
      log('S3a modif MULTI toasts', J(noLic(await toasts(A))));
      await sleep(6000);
      log('S3a MULTI après (A/cloud)', J(await cmp(P + 'MULTI')));
      await goAgents(A);
      log('S3a MULTI après rechargement page (UI)', J((await readAllRows(A)).filter((x) => x.login === P + 'MULTI')));
    });
    await step('contact par IPC (aucun champ UI)', async () => {
      const id = (await localUser(A, P + 'VERIF')).id_user;
      const r = await A.window.evaluate(async (i) => { try { return await (window as any).api.users.update(i, { email: 'qa@test.ci', telephone: '0102030405' }); } catch (e: any) { return 'ERR ' + e.message; } }, id);
      await sleep(3000);
      log('S3a IPC users.update(email,telephone) ->', J(r), '| local =', J(pick(await localUser(A, P + 'VERIF'))), '| cloud =', J(pick(await cloudUser(P + 'VERIF'))));
      // email/telephone côté cloud posés directement : redescendent-ils sur B ?
      await supabaseDev.from('t_users').update({ email: 'cloud@test.ci', telephone: '0707070707' }).eq('login', P + 'VERIF');
      log('S3a B après pose email/tel cloud + téléchargement', J(await downloadOnB()), J(pick(await localUser(B, P + 'VERIF'))));
    });
    await step('modifier ADMC (rôle ADMIN_CENTRE -> OPERATEUR_SAISIE)', async () => {
      await openEdit(A, P + 'ADMC');
      await setRoles(A.window, ['OPERATEUR_SAISIE']);
      await submitModal(A);
      log('S3a ADMC toasts', J(noLic(await toasts(A))), J((await cmp(P + 'ADMC')).A));
    });
    await step('modifier soi-même (admin site)', async () => {
      await goAgents(A);
      await openEdit(A, 'E2E_ADMINISTRATEUR_SITE');
      log('S3a modal soi-même rôles cochés =', J(await A.window.evaluate(() => Array.from(document.querySelectorAll('form label')).filter((l) => (l.querySelector('input') as HTMLInputElement | null)?.checked).map((l) => (l as HTMLElement).innerText))));
      await A.window.getByPlaceholder('Prénoms').fill('SELFEDIT');
      await submitModal(A);
      log('S3a modifier soi-même -> toasts', J(noLic(await toasts(A))), 'modal ouvert =', await A.window.getByRole('heading', { name: /Modifier l'agent/ }).count());
      if (await A.window.getByRole('heading', { name: /Modifier l'agent/ }).count()) { await A.window.getByRole('button', { name: 'Annuler' }).click(); await sleep(300); }
    });
  });

  test('S3b Mot de passe (réinitialisation)', async () => {
    await goAgents(A);
    await step('reset SAISIE', async () => {
      const h0 = await hashOf(P + 'SAISIE');
      await clickRowBtn(A, P + 'SAISIE', 'Réinitialiser le mot de passe');
      const d1 = await confirmDialog(A, 'mauvais-mdp');
      log('S3b dialogue confirmation =', J(d1), 'toasts après mauvais mdp admin =', J(noLic(await toasts(A))));
      // dialogue toujours ouvert : saisir le bon mot de passe
      await A.window.locator('input[autocomplete="current-password"]').fill(PWD);
      await A.window.getByRole('button', { name: 'Confirmer' }).click();
      await sleep(2500);
      const tt = noLic(await toasts(A)).join(' ');
      const m = /réinitialisé !\s*([A-Za-z0-9]{8})/.exec(tt);
      log('S3b toasts après bon mdp =', J(tt.slice(0, 200)), '| temporaire =', m?.[1]);
      (globalThis as any).__tmp = m?.[1];
      await sleep(5000);
      log('S3b hash cloud changé =', (await hashOf(P + 'SAISIE')) !== h0, '| local dirty =', J(pick(await localUser(A, P + 'SAISIE'))));
      log('S3b B téléchargement', J(await downloadOnB()));
      await logoutUi(B);
      log('S3b B login SAISIE ANCIEN mdp ->', J(await loginUi(B, P + 'SAISIE', 'Mdp-SAISIE_2026', false)));
      log('S3b B login SAISIE mdp TEMPORAIRE ->', J(await loginUi(B, P + 'SAISIE', (globalThis as any).__tmp || 'x', false)), await B.window.evaluate(() => location.hash));
      await logoutUi(B); await asAdmin(B); await goAgents(B);
    });
  });

  test('S3c Désactiver / Réactiver', async () => {
    await goAgents(A);
    await step('désactiver LOGI', async () => {
      const st0 = await readStats(A);
      await clickRowBtn(A, P + 'LOGI', 'Désactiver');
      const d = await confirmDialog(A, 'mauvais');
      log('S3c dialogue désactivation =', J(d), 'toasts mauvais mdp =', J(noLic(await toasts(A))));
      await A.window.locator('input[autocomplete="current-password"]').fill(PWD);
      await A.window.getByRole('button', { name: 'Confirmer' }).click();
      await sleep(2500);
      log('S3c toasts =', J(noLic(await toasts(A))), 'stats avant/après =', J(st0), J(await readStats(A)));
      log('S3c ligne =', J((await readAllRows(A)).filter((x) => x.login === P + 'LOGI')));
      await sleep(4000);
      log('S3c LOGI (A/cloud)', J((await cmp(P + 'LOGI'))));
      await shot(A, '08-S3c-LOGI-desactive');
    });
    await step('B avant téléchargement : connexion LOGI désactivé ?', async () => {
      await logoutUi(B);
      const r = await loginUi(B, P + 'LOGI', 'Mdp-LOGI_2026', false);
      log('S3c B (local encore actif, pas de pull) login LOGI ->', J(r));
      if (r.ok) await logoutUi(B);
      await asAdmin(B); await goAgents(B);
      log('S3c B téléchargement', J(await downloadOnB()), 'B LOGI =', J(pick(await localUser(B, P + 'LOGI'))));
      await logoutUi(B);
      log('S3c B (après pull) login LOGI désactivé ->', J(await loginUi(B, P + 'LOGI', 'Mdp-LOGI_2026', false)));
      await asAdmin(B); await goAgents(B);
    });
    await step('réactiver LOGI', async () => {
      await goAgents(A);
      await clickRowBtn(A, P + 'LOGI', 'Activer');
      const d = await confirmDialog(A, PWD);
      log('S3c réactivation dialogue =', J(d), 'toasts =', J(noLic(await toasts(A))));
      await sleep(5000);
      log('S3c LOGI réactivé (A/cloud)', J(await cmp(P + 'LOGI')), 'stats', J(await readStats(A)));
      log('S3c ligne réactivée', J((await readAllRows(A)).filter((x) => x.login === P + 'LOGI')));
      log('S3c B téléchargement', J(await downloadOnB()), 'B LOGI =', J(pick(await localUser(B, P + 'LOGI'))));
      await logoutUi(B);
      log('S3c B login LOGI réactivé ->', J(await loginUi(B, P + 'LOGI', 'Mdp-LOGI_2026', false)));
      if ((await B.window.evaluate(() => location.hash.includes('/login'))) === false) await logoutUi(B);
      await asAdmin(B); await goAgents(B);
    });
  });

  test('S3d Supprimer définitivement', async () => {
    await step('préparation DEL1/DEL2/DEL3', async () => {
      await goAgents(A);
      for (const k of ['DEL1', 'DEL2', 'DEL3']) await createAgentUI(A, agent(k, ['OPERATEUR_VERIFICATION'], 1));
      await pushAll();
      log('S3d DEL* créés (A/cloud)', J(await Promise.all(['DEL1', 'DEL2', 'DEL3'].map((k) => cmp(P + k).then((c) => ({ k, A: c.A?.actif, cloud: c.cloud?.actif }))))));
      log('S3d B téléchargement', J(await downloadOnB()));
    });
    await step('DEL2 : activité (login sur B, logs, carte locale) avant suppression', async () => {
      await logoutUi(B);
      log('S3d B login DEL2 ->', J(await loginUi(B, P + 'DEL2', 'Mdp-DEL2_2026', false)).slice(0, 120));
      await sleep(8000);
      const lid = await localUser(B, P + 'DEL2');
      log('S3d B logs de DEL2 =', J(await sqlRead(B, `SELECT action, id_user, login_user, is_dirty FROM t_logs WHERE login_user='${P}DEL2' ORDER BY id_log DESC LIMIT 5`).catch((e) => String(e).slice(0, 120))));
      const cl = await supabaseDev.from('t_logs').select('id_log,id_user,login_user,action').eq('login_user', P + 'DEL2');
      log('S3d cloud t_logs DEL2 =', J(cl.data || cl.error), '| id_user local B =', lid.id_user, '| id_user cloud =', (await cloudUser(P + 'DEL2'))?.id_user);
      log('S3d cloud presence DEL2 =', J((await supabaseDev.from('t_user_presence').select('user_sync_id,last_login_at').eq('user_sync_id', lid.sync_id)).data));
      await logoutUi(B); await asAdmin(B); await goAgents(B);
      // carte locale (A) créée par DEL2 et carte cloud référençant son id_user cloud
      const aid = (await localUser(A, P + 'DEL2')).id_user;
      const ins = await sqlWrite(A, `INSERT INTO t_cartes (noms, prenoms, site_id, centre_id, created_by, sync_id) VALUES ('ZZTEST_CARTE','AG',1,1,${aid},'zztest-ag-carte-1')`).catch((e) => 'ERR ' + String(e).slice(0, 200));
      log('S3d carte locale created_by=DEL2 insérée ->', J(ins));
      const cid = (await cloudUser(P + 'DEL2')).id_user;
      const ci = await supabaseDev.from('t_cartes').insert({ sync_id: 'zztest-ag-carte-1', noms: 'ZZTEST_CARTE', prenoms: 'AG', id_site: 1, id_centre: 1, rangement: 'ZZ', created_by: cid, statut: 'EN STOCK' });
      log('S3d carte cloud created_by=DEL2 ->', J(ci.error?.message || 'ok'));
    });
    await step('suppression DEL1 (sans activité)', async () => {
      await goAgents(A);
      await clickRowBtn(A, P + 'DEL1', 'Supprimer définitivement');
      const d = await confirmDialog(A, PWD);
      log('S3d DEL1 dialogue =', J(d), 'toasts =', J(noLic(await toasts(A))));
      await sleep(6000);
      log('S3d DEL1 après : local =', J(await localUser(A, P + 'DEL1') || null), '| cloud =', J(pick(await cloudUser(P + 'DEL1'))), '| UI =', J((await readAllRows(A)).filter((x) => x.login === P + 'DEL1').length));
      log('S3d B (avant pull) DEL1 =', J(pick(await localUser(B, P + 'DEL1'))));
      log('S3d B téléchargement', J(await downloadOnB()), '| B DEL1 après =', J(pick(await localUser(B, P + 'DEL1'))));
      await logoutUi(B);
      const r = await loginUi(B, P + 'DEL1', 'Mdp-DEL1_2026', false);
      log('S3d B login DEL1 supprimé ->', J(r));
      if (r.ok) await logoutUi(B);
      await asAdmin(B); await goAgents(B);
    });
    await step('suppression DEL2 (logs + cartes + présence)', async () => {
      await goAgents(A);
      await clickRowBtn(A, P + 'DEL2', 'Supprimer définitivement');
      await confirmDialog(A, PWD);
      log('S3d DEL2 toasts =', J(noLic(await toasts(A))));
      await sleep(8000);
      log('S3d DEL2 après : local =', J(await localUser(A, P + 'DEL2') || null), '| cloud =', J(pick(await cloudUser(P + 'DEL2'))), '| UI =', J((await readAllRows(A)).filter((x) => x.login === P + 'DEL2').length));
      log('S3d DEL2 outbox =', J(await sqlRead(A, `SELECT * FROM t_outbox WHERE table_name='t_users' ORDER BY rowid DESC LIMIT 3`).catch((e) => String(e).slice(0, 150))));
      log('S3d DEL2 logs main A =', J(((await import('./_agent13_agents_helpers')).appLog(A)).split('\n').filter((l) => /OutboxService/.test(l) && /(DELETE|Suppression|définitive|violates)/.test(l)).slice(-5)));
      log('S3d carte locale created_by orphelin =', J(await sqlRead(A, `SELECT id_carte, created_by FROM t_cartes WHERE sync_id='zztest-ag-carte-1'`)));
    });
    await step('re-création DEL1 après suppression', async () => {
      const r = await createAgentUI(A, agent('DEL1', ['OPERATEUR_QUALITE'], 2));
      log('S3d re-création du login supprimé ->', J(noLic(r.toasts)), J((await cmp(P + 'DEL1')).A));
    });
  });

  test('S6 affichage 1366x768 (A)', async () => {
    await goAgents(A);
    await setWindow1366(A);
    const m = await A.window.evaluate(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const badges = Array.from(document.querySelectorAll('.table-row-hover span.badge')).map((b) => parseFloat(getComputedStyle(b).fontSize));
      const hdr = Array.from(document.querySelectorAll('.table-row-hover')).slice(0, 12);
      const overlaps: string[] = []; const clipped: string[] = [];
      hdr.forEach((row, ri) => {
        const cells = Array.from(row.children) as HTMLElement[];
        cells.forEach((c, ci) => {
          if (c.scrollWidth > c.clientWidth + 1) clipped.push(`r${ri}c${ci}`);
          const nxt = cells[ci + 1]; if (!nxt) return;
          const leaves = (el: HTMLElement) => Array.from(el.querySelectorAll('*')).filter((x) => x.children.length === 0 && (x.textContent || '').trim());
          for (const a of leaves(c)) for (const b of leaves(nxt)) {
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
            if (ra.right > rb.left + 1 && ra.left < rb.right && ra.bottom > rb.top && ra.top < rb.bottom) overlaps.push(`r${ri}:c${ci}/${ci + 1} "${(a.textContent || '').slice(0, 20)}"x"${(b.textContent || '').slice(0, 20)}"`);
          }
        });
      });
      const btn = Array.from(document.querySelectorAll('.table-row-hover button')).slice(0, 4).map((b) => { const r = b.getBoundingClientRect(); return `${b.getAttribute('title')}:${Math.round(r.width)}x${Math.round(r.height)}@x${Math.round(r.left)}`; });
      const tableWrap = document.querySelector('.table-responsive-wrapper') as HTMLElement | null;
      const fonts = Array.from(new Set(Array.from(document.querySelectorAll('.table-row-hover *')).filter((x) => x.children.length === 0 && (x.textContent || '').trim()).map((x) => getComputedStyle(x).fontSize))).sort();
      const centreRows = Array.from(document.querySelectorAll('.table-row-hover')).slice(0, 12).map((r) => Math.round(((r.children[3] as HTMLElement)?.getBoundingClientRect().height) || 0));
      return { vw, vh, badgeFontSizes: Array.from(new Set(badges)), overlaps: overlaps.slice(0, 12), nOverlaps: overlaps.length, clippedCells: clipped.slice(0, 8), btn, wrapScrollW: tableWrap?.scrollWidth, wrapClientW: tableWrap?.clientWidth, fonts, centreCellHeights: centreRows };
    });
    log('S6 mesures 1366x768 =', J(m));
    await shot(A, '09-S6-liste-1366-haut');
    await A.window.evaluate(() => { const el = document.querySelector('.table-responsive-wrapper'); el?.scrollIntoView(); });
    await sleep(500);
    await shot(A, '10-S6-liste-1366-table');
  });

  test('CY cycle comptes ~3 min : désactivation, rôle, session ouverte, écrasement dirty, Dernière co.', async () => {
    await goAgents(A);
    // B : on se connecte comme agent QUAL (session ouverte), sans passer par admin
    await step('B session QUAL', async () => {
      await logoutUi(B);
      const r = await loginUi(B, P + 'QUAL', 'Mdp-QUAL_2026', false);
      log('CY B login QUAL ->', J(r), await B.window.evaluate(() => location.hash));
    });
    // A : actions
    await step('A : désactiver QUAL, supprimer DEL3, changer rôle VERIF, simuler dirty', async () => {
      await clickRowBtn(A, P + 'QUAL', 'Désactiver'); await confirmDialog(A, PWD);
      await clickRowBtn(A, P + 'DEL3', 'Supprimer définitivement'); await confirmDialog(A, PWD);
      await openEdit(A, P + 'VERIF'); await setRoles(A.window, ['OPERATEUR_QUALITE']); await submitModal(A);
      // simulation « désactivation hors-ligne en attente » : local statut 0 + is_dirty 1, cloud encore 1, pas d'outbox
      await sqlWrite(A, `UPDATE t_users SET statut_actif=0, is_dirty=1 WHERE login='${P}APUR'`);
      await sqlWrite(A, `UPDATE t_users SET nom_user='DIRTYEDIT', is_dirty=1 WHERE login='${P}SAISIE'`);
      await sleep(6000);
      log('CY T0 A (cloud) QUAL/DEL3/VERIF/APUR/SAISIE', J(await Promise.all(['QUAL', 'DEL3', 'VERIF', 'APUR', 'SAISIE'].map(async (k) => [k, pick(await cloudUser(P + k)), (await localUser(A, P + k))?.statut_actif]))));
    });
    const t0 = Date.now();
    const snap = async (tag: string) => {
      log(`CY ${tag} B: QUAL local=`, J(pick(await localUser(B, P + 'QUAL'))), '| DEL3 local=', J(pick(await localUser(B, P + 'DEL3'))), '| VERIF local role=', (await localUser(B, P + 'VERIF'))?.role, '| hash UI B =', await B.window.evaluate(() => location.hash));
      log(`CY ${tag} A: APUR local statut/dirty=`, J(pick(await localUser(A, P + 'APUR'))), '| SAISIE local nom/dirty=', J(pick(await localUser(A, P + 'SAISIE'))), '| cloud APUR actif=', (await cloudUser(P + 'APUR'))?.statut_actif);
    };
    for (let i = 0; i < 9; i++) { await sleep(30000); if (i % 2 === 1) await snap(`+${Math.round((Date.now() - t0) / 1000)}s`); }
    await step('A dernière co. après cycle', async () => {
      await goAgents(A); await refreshList(A);
      log('CY A Dernière co. ONE =', J((await readAllRows(A)).filter((x) => x.login === P + 'ONE').map((x) => x.last)), '| A.local ONE.last_login =', (await localUser(A, P + 'ONE')).last_login);
      await shot(A, '11-CY-derniere-co-apres-cycle');
    });
    await step('B après cycle (UI)', async () => { await shot(B, '12-CY-B-session-QUAL'); });
  });

  test('S3e renommage du login puis téléchargement poste B', async () => {
    await step('préparation RENM', async () => { await goAgents(A); await createAgentUI(A, agent('RENM', ['OPERATEUR_VERIFICATION'], 1)); await sleep(6000); await asAdmin(B).catch(() => undefined); await goAgents(B); log('S3e B toasts', J(await downloadOnB())); });
    await step('modifier le LOGIN de QUAL puis téléchargement B', async () => {
      await goAgents(A);
      const before = (await localUser(A, P + 'RENM')).sync_id;
      await openEdit(A, P + 'RENM');
      await A.window.getByPlaceholder('ex: agent_abobo').fill(P + 'RENM2');
      await submitModal(A);
      log('S3a renommage login QUAL->RENM2 toasts', J(noLic(await toasts(A))));
      await sleep(5000);
      log('S3a cloud QUAL / RENM2 =', J(pick(await cloudUser(P + 'RENM'))), J(pick(await cloudUser(P + 'RENM2'))), 'sync_id conservé =', (await cloudUser(P + 'RENM2'))?.sync_id === before);
      log('S3a B téléchargement après renommage ->', J(await downloadOnB()));
      log('S3a B QUAL/RENM2 =', J(pick(await localUser(B, P + 'RENM'))), J(pick(await localUser(B, P + 'RENM2'))));
      log('S3a B logs main (erreurs pull)', J(( (await import('./_agent13_agents_helpers')).appLog(B)).split('\n').filter((l) => /pullAgentsFromCloud/.test(l)).slice(-4)));
    });
  });

  test('S5 cloisonnement / droits (IPC) — destructif, fin de session', async () => {
    await step('B logout', async () => { await logoutUi(B).catch(() => undefined); });
    await goAgents(A);
    await step('prise de contrôle login existant d\'un AUTRE site / SUPER ADMIN (UI)', async () => {
      // site 2 + utilisateur étranger
      await sqlWrite(A, `INSERT OR IGNORE INTO t_sites (id, nom, code, is_active, max_centres, is_permanent, sync_id) VALUES (2,'ZZTEST_SITE2','ZZ-S2',1,4,1,'zztest-ag-site2')`);
      const h = (await localUser(A, P + 'ONE')); void h;
      await sqlWrite(A, `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty) SELECT '${P}FOREIGN', password_hash, 'OPERATEUR_QUALITE', 'ETRANGER', 'SITE2', 1, 2, NULL, 'zztest-ag-foreign', 0 FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`);
      log('S5 FOREIGN avant =', J(pick(await localUser(A, P + 'FOREIGN'))), '| SUPER ADMIN avant =', J(pick(await localUser(A, 'E2E_SUPER_ADMIN'))));
      const r1 = await createAgentUI(A, { login: P + 'FOREIGN', password: 'Pirate_2026', nom: 'PIRATE', roles: ['OPERATEUR_SAISIE'], centreId: 1 });
      log('S5 création login = compte AUTRE SITE -> toasts', J(noLic(r1.toasts)), '| après =', J(pick(await localUser(A, P + 'FOREIGN'))));
      const r2 = await createAgentUI(A, { login: 'E2E_SUPER_ADMIN', password: 'Pirate_2026', nom: 'PIRATE', roles: ['OPERATEUR_SAISIE'], centreId: 1 });
      log('S5 création login = SUPER ADMIN existant -> toasts', J(noLic(r2.toasts)), '| après =', J(pick(await localUser(A, 'E2E_SUPER_ADMIN'))), 'rôles', J(await localRoles(A, 'E2E_SUPER_ADMIN')));
    });
    await step('IPC : rôles interdits / changement de site / cross-site', async () => {
      const call = (fn: string, ...args: any[]) => A.window.evaluate(async ([f, a]: any) => { try { const [ns, m] = f.split('.'); return { ok: true, v: await (window as any).api[ns][m](...a) }; } catch (e: any) { return { ok: false, e: String(e.message || e).slice(0, 220) }; } }, [fn, args]);
      await sqlWrite(A, `INSERT INTO t_users (login, password_hash, role, nom_user, prenom_user, statut_actif, site_id, centre_id, sync_id, is_dirty) SELECT '${P}FOREIGN2', password_hash, 'OPERATEUR_QUALITE', 'ETRANGER2', 'SITE2', 1, 2, NULL, 'zztest-ag-foreign2', 0 FROM t_users WHERE login='E2E_ADMINISTRATEUR_SITE'`);
      const idV = (await localUser(A, P + 'VERIF')).id_user; const idF = (await localUser(A, P + 'FOREIGN2')).id_user;
      log('S5 FOREIGN2 (site 2) id', idF, J(pick(await localUser(A, P + 'FOREIGN2'))));
      log('S5 create roles:[SUPER ADMIN] ->', J(await call('users.create', { login: P + 'SA', password: 'Mdp-SA_2026', nom: 'SA', roles: ['SUPER ADMIN'], role: 'SUPER ADMIN', centre_id: 1 })));
      log('S5 update roles:[ADMINISTRATEUR_SITE] ->', J(await call('users.update', idV, { roles: ['ADMINISTRATEUR_SITE'] })));
      log('S5 update role:\'SUPER ADMIN\' (sans roles[]) ->', J(await call('users.update', idV, { role: 'SUPER ADMIN' })), '| local =', J(pick(await localUser(A, P + 'VERIF'))));
      log('S5 update site_id:2 ->', J(await call('users.update', idV, { site_id: 2 })), '| local =', J(pick(await localUser(A, P + 'VERIF'))));
      log('S5 update agent d\'un autre site (id ' + idF + ') ->', J(await call('users.update', idF, { nom_user: 'HACK' })));
      log('S5 delete agent autre site ->', J(await call('users.delete', idF)), '| hardDelete autre site ->', J(await call('users.hardDelete', idF)));
      log('S5 resetAgentPassword autre site ->', J(await call('users.resetAgentPassword', idF)), '| FOREIGN2 après =', J(pick(await localUser(A, P + 'FOREIGN2') || null)));
      log('S5 getAll(siteId=2) imposé ->', J(((await call('users.getAll', 2)).v || []).map((u: any) => u.login).slice(0, 4)));
    });
    await step('auto-suppression / dernier admin (IPC)', async () => {
      const idSelf = (await localUser(A, 'E2E_ADMINISTRATEUR_SITE')).id_user;
      const call = (fn: string, ...args: any[]) => A.window.evaluate(async ([f, a]: any) => { try { const [ns, m] = f.split('.'); return { ok: true, v: await (window as any).api[ns][m](...a) }; } catch (e: any) { return { ok: false, e: String(e.message || e).slice(0, 220) }; } }, [fn, args]);
      log('S5 users.delete(self) ->', J(await call('users.delete', idSelf)), '| local =', J(pick(await localUser(A, 'E2E_ADMINISTRATEUR_SITE'))));
      await sleep(4000);
      log('S5 cloud admin après self-désactivation =', J(pick(await cloudUser('E2E_ADMINISTRATEUR_SITE'))));
      await call('users.update', idSelf, { statut_actif: 1 });
      log('S5 users.hardDelete(self) ->', J(await call('users.hardDelete', idSelf)));
      await sleep(5000);
      log('S5 admin local/cloud après hardDelete(self) =', J(await localUser(A, 'E2E_ADMINISTRATEUR_SITE') || null), J(pick(await cloudUser('E2E_ADMINISTRATEUR_SITE'))));
    });
  });
});
