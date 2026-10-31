import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import bcrypt from 'bcryptjs';
import { loadEnv } from 'vite';
// @ts-expect-error — script Node pur (.mjs) sans déclaration de types ; tests/ est hors du périmètre de tsc.
import * as script from '../scripts/set-root-password.mjs';

/**
 * Script scripts/set-root-password.mjs : logique pure testée sur des fichiers temporaires
 * (jamais sur le vrai .env). Inclut la preuve que la valeur relue via vite.loadEnv (utilisé par
 * electron.vite.config.ts) est identique à l'empreinte d'origine.
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gest-in-situ-test-set-root-pwd-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const HASH = bcrypt.hashSync('Mdp_Root_Jetable_Test_2026', 4);

describe('validateRootPassword', () => {
  it('refuse moins de 16 caractères', () => {
    expect(script.validateRootPassword('court', 'court')).toMatch(/trop court/i);
    expect(script.validateRootPassword('a'.repeat(15), 'a'.repeat(15))).toMatch(/trop court/i);
  });
  it('refuse deux saisies différentes', () => {
    expect(script.validateRootPassword('a'.repeat(16), 'b'.repeat(16))).toMatch(/différentes/);
  });
  it('accepte 16 caractères identiques deux fois', () => {
    expect(script.validateRootPassword('a'.repeat(16), 'a'.repeat(16))).toBeNull();
  });
});

describe('upsertEnvLine', () => {
  it('ajoute la ligne sans toucher aux autres (fins de ligne CRLF conservées)', () => {
    const before = 'A=1\r\n# commentaire\r\nB="x y"\r\n';
    const after = script.upsertEnvLine(before, HASH);
    expect(after.startsWith(before)).toBe(true);
    expect(after).toBe(before + script.buildEnvLine(HASH) + '\r\n');
  });

  it("ajoute en fin de fichier même sans saut de ligne final, en LF", () => {
    const after = script.upsertEnvLine('A=1\nB=2', HASH);
    expect(after).toBe('A=1\nB=2\n' + script.buildEnvLine(HASH) + '\n');
  });

  it('remplace une ligne existante sans modifier les autres', () => {
    const before = 'A=1\r\nFAILSAFE_ROOT_PASSWORD_HASH=ancienne\r\nC=3\r\n';
    const after = script.upsertEnvLine(before, HASH);
    expect(after).toBe('A=1\r\n' + script.buildEnvLine(HASH) + '\r\nC=3\r\n');
  });

  it("ne confond pas une clé voisine et ne supprime aucune autre ligne", () => {
    const before = 'FAILSAFE_ROOT_PASSWORD_HASH_AUTRE=zzz\nFAILSAFE_ROOT_PASSWORD=ancien\n';
    const after = script.upsertEnvLine(before, HASH);
    expect(after.startsWith(before)).toBe(true);
    expect(after.endsWith(script.buildEnvLine(HASH) + '\n')).toBe(true);
  });

  it("crée le contenu si le fichier est vide", () => {
    expect(script.upsertEnvLine('', HASH)).toContain(script.buildEnvLine(HASH));
  });
});

describe('écriture réelle + relecture par vite.loadEnv', () => {
  it("la valeur relue par loadEnv est IDENTIQUE à l'empreinte (échappement des $)", () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'env-'));
    const envPath = path.join(dir, '.env');
    fs.writeFileSync(envPath, 'VITE_SUPABASE_URL=https://exemple.invalid\n', 'utf8');

    script.writeRootHashToEnvFile(envPath, HASH);

    const written = fs.readFileSync(envPath, 'utf8');
    expect(written).toContain('VITE_SUPABASE_URL=https://exemple.invalid');
    // Le mot de passe n'apparaît nulle part, seule l'empreinte (échappée) est écrite.
    expect(written).not.toContain('Mdp_Root_Jetable_Test_2026');

    delete process.env.FAILSAFE_ROOT_PASSWORD_HASH; // loadEnv donne priorité à process.env
    const env = loadEnv('production', dir, '');
    expect(env.FAILSAFE_ROOT_PASSWORD_HASH).toBe(HASH);
    expect(bcrypt.compareSync('Mdp_Root_Jetable_Test_2026', env.FAILSAFE_ROOT_PASSWORD_HASH)).toBe(true);
    // Contre-preuve : sans échappement, la valeur serait altérée par dotenv-expand.
    fs.writeFileSync(envPath, `FAILSAFE_ROOT_PASSWORD_HASH=${HASH}\n`, 'utf8');
    delete process.env.FAILSAFE_ROOT_PASSWORD_HASH;
    expect(loadEnv('production', dir, '').FAILSAFE_ROOT_PASSWORD_HASH).not.toBe(HASH);
  });
});
