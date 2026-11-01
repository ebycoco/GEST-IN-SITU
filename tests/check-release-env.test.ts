import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Garde-fou de compilation (scripts/check-release-env.mjs) : logique pure + exécution réelle du
 * script sur des dossiers TEMPORAIRES contenant de faux .env (aucun vrai secret, aucun .env du projet).
 */

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'check-release-env.mjs');
const FAUX_HASH = '$2b$10$' + 'a'.repeat(53); // forme bcrypt valide, factice
const FAUX_URL = 'https://exemple-factice.supabase.co';
const FAUXE_CLE = 'cle-anon-factice-pour-test';

type Mod = {
  checkReleaseEnv: (env: Record<string, string | undefined>) => { variable: string; message: string }[];
  BCRYPT_HASH_PATTERN: RegExp;
};

describe('check-release-env : logique', () => {
  let mod: Mod;
  beforeAll(async () => {
    mod = (await import(/* @vite-ignore */ SCRIPT)) as Mod;
  });

  const ok = () => ({ VITE_SUPABASE_URL: FAUX_URL, VITE_SUPABASE_ANON_KEY: FAUXE_CLE, FAILSAFE_ROOT_PASSWORD_HASH: FAUX_HASH });
  const vars = (env: Record<string, string | undefined>) => mod.checkReleaseEnv(env).map(p => p.variable);

  it('configuration valide : aucun problème', () => {
    expect(mod.checkReleaseEnv(ok())).toEqual([]);
  });
  it('tout vide : les 3 variables signalées', () => {
    expect(vars({})).toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'FAILSAFE_ROOT_PASSWORD_HASH']);
  });
  it('URL en http:// refusée', () => {
    expect(vars({ ...ok(), VITE_SUPABASE_URL: 'http://exemple.co' })).toEqual(['VITE_SUPABASE_URL']);
  });
  it('clé anon vide (espaces) refusée', () => {
    expect(vars({ ...ok(), VITE_SUPABASE_ANON_KEY: '   ' })).toEqual(['VITE_SUPABASE_ANON_KEY']);
  });
  it('empreinte non bcrypt refusée, avec conseil set-root-password', () => {
    const p = mod.checkReleaseEnv({ ...ok(), FAILSAFE_ROOT_PASSWORD_HASH: 'motdepasse-en-clair' });
    expect(p.map(x => x.variable)).toEqual(['FAILSAFE_ROOT_PASSWORD_HASH']);
    expect(p[0].message).toContain('set-root-password.mjs');
  });
  it('empreinte tronquée refusée', () => {
    expect(vars({ ...ok(), FAILSAFE_ROOT_PASSWORD_HASH: FAUX_HASH.slice(0, 40) })).toEqual(['FAILSAFE_ROOT_PASSWORD_HASH']);
  });
  it('aucun message ne contient de valeur', () => {
    const texte = JSON.stringify(mod.checkReleaseEnv({ ...ok(), FAILSAFE_ROOT_PASSWORD_HASH: 'SECRET-XYZ', VITE_SUPABASE_URL: 'http://secret-url.co' }));
    expect(texte).not.toContain('SECRET-XYZ');
    expect(texte).not.toContain('secret-url');
  });
});

describe('check-release-env : exécution réelle sur dossiers temporaires', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'gis-check-env-'));
  afterAll(() => fs.rmSync(racine, { recursive: true, force: true }));

  /** Crée un dossier avec un .env, lance le script avec un environnement NETTOYÉ des 3 variables. */
  function lancer(nom: string, contenuEnv: string | null, extraEnv: Record<string, string> = {}) {
    const dossier = path.join(racine, nom);
    fs.mkdirSync(dossier, { recursive: true });
    if (contenuEnv !== null) fs.writeFileSync(path.join(dossier, '.env'), contenuEnv, 'utf8');
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...extraEnv };
    delete env.VITE_SUPABASE_URL; delete env.VITE_SUPABASE_ANON_KEY; delete env.FAILSAFE_ROOT_PASSWORD_HASH;
    Object.assign(env, extraEnv);
    return spawnSync(process.execPath, [SCRIPT, '--dossier', dossier], { env, encoding: 'utf8' });
  }
  const echappe = (h: string) => h.replace(/\$/g, '\\$');
  const envValide = `VITE_SUPABASE_URL=${FAUX_URL}\nVITE_SUPABASE_ANON_KEY=${FAUXE_CLE}\nFAILSAFE_ROOT_PASSWORD_HASH=${echappe(FAUX_HASH)}\n`;

  it('.env valide (empreinte avec $ échappés) : code 0, message court, aucune valeur affichée', () => {
    const r = lancer('valide', envValide);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Configuration de compilation OK');
    const sortie = r.stdout + r.stderr;
    expect(sortie).not.toContain('exemple-factice');
    expect(sortie).not.toContain(FAUXE_CLE);
    expect(sortie).not.toContain('aaaaaaaa');
  });
  it('.env absent : code 1, les 3 variables citées', () => {
    const r = lancer('vide', null);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('VITE_SUPABASE_URL');
    expect(r.stderr).toContain('VITE_SUPABASE_ANON_KEY');
    expect(r.stderr).toContain('FAILSAFE_ROOT_PASSWORD_HASH');
    expect(r.stderr).toContain('COMPILATION REFUSÉE');
    expect(r.stderr).toContain('JAMAIS');
  });
  it('empreinte avec $ NON échappés : code 1 (cause probable expliquée), aucune valeur affichée', () => {
    const r = lancer('dollars', `VITE_SUPABASE_URL=${FAUX_URL}\nVITE_SUPABASE_ANON_KEY=${FAUXE_CLE}\nFAILSAFE_ROOT_PASSWORD_HASH=${FAUX_HASH}\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FAILSAFE_ROOT_PASSWORD_HASH');
    expect(r.stderr).toContain('set-root-password.mjs');
    expect(r.stderr).not.toContain('aaaaaaaa');
    expect(r.stderr).not.toContain('exemple-factice');
  });
  it('empreinte non bcrypt : code 1', () => {
    const r = lancer('pasbcrypt', `VITE_SUPABASE_URL=${FAUX_URL}\nVITE_SUPABASE_ANON_KEY=${FAUXE_CLE}\nFAILSAFE_ROOT_PASSWORD_HASH=pas-une-empreinte\n`);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FAILSAFE_ROOT_PASSWORD_HASH');
    expect(r.stderr).not.toContain('pas-une-empreinte');
  });
  it('URL en http:// : code 1, seule VITE_SUPABASE_URL citée', () => {
    const r = lancer('http', envValide.replace('https://', 'http://'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('VITE_SUPABASE_URL');
    expect(r.stderr).not.toContain('VITE_SUPABASE_ANON_KEY :');
  });
  it('précédence process.env > .env (comme loadEnv du build) : variable d\'environnement valide compense un .env vide', () => {
    const r = lancer('precedence', '', { VITE_SUPABASE_URL: FAUX_URL, VITE_SUPABASE_ANON_KEY: FAUXE_CLE, FAILSAFE_ROOT_PASSWORD_HASH: FAUX_HASH });
    expect(r.status).toBe(0);
  });
});
