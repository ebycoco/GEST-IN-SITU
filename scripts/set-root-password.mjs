#!/usr/bin/env node
/**
 * scripts/set-root-password.mjs
 *
 * Définit le mot de passe du compte de secours ROOT en enregistrant son EMPREINTE bcrypt
 * (clé FAILSAFE_ROOT_PASSWORD_HASH) dans le fichier .env — jamais le mot de passe lui-même.
 *
 * Usage (à la racine du projet) :
 *   node scripts/set-root-password.mjs
 *   node scripts/set-root-password.mjs --fichier chemin/vers/un/autre.env   (ou variable GIS_ENV_FILE)
 *
 * Garanties :
 *  - saisie MASQUÉE (rien n'est affiché pendant la frappe), demandée deux fois ;
 *  - refus si moins de 16 caractères ou si les deux saisies diffèrent ;
 *  - seule la ligne FAILSAFE_ROOT_PASSWORD_HASH est écrite/remplacée : les autres lignes
 *    et les fins de ligne du fichier sont conservées telles quelles ;
 *  - le mot de passe n'est ni écrit sur disque, ni affiché, ni journalisé.
 *
 * Note `$` : une empreinte bcrypt contient des `$` ($2b$10$...). electron-vite lit .env via
 * vite.loadEnv (dotenv-expand) qui interpréterait `$2b` comme une variable ; chaque `$` est donc
 * écrit échappé (`\$`), forme prouvée relue à l'identique par loadEnv (tests/set-root-password.test.ts).
 *
 * Fonctions exportées (testables) : validateRootPassword, buildEnvLine, upsertEnvLine,
 * hashRootPassword, writeRootHashToEnvFile.
 */
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';

export const ENV_KEY = 'FAILSAFE_ROOT_PASSWORD_HASH';
export const MIN_PASSWORD_LENGTH = 16;
export const BCRYPT_ROUNDS = 10;

// Ligne entière de la clé (multiligne, global) ; [ \t] et non \s pour ne jamais déborder sur
// les lignes voisines. `.*` s'arrête avant \r ou \n.
const KEY_LINE = /^[ \t]*(?:export[ \t]+)?FAILSAFE_ROOT_PASSWORD_HASH[ \t]*=.*$/gm;

/** Retourne un message d'erreur (français) si le mot de passe est refusé, sinon null. */
export function validateRootPassword(password, confirmation) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Mot de passe trop court : ${MIN_PASSWORD_LENGTH} caractères minimum.`;
  }
  if (confirmation !== undefined && password !== confirmation) {
    return 'Les deux saisies sont différentes.';
  }
  return null;
}

/** Empreinte bcrypt (10 tours) du mot de passe. */
export function hashRootPassword(password) {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

/** Ligne .env correspondante, avec chaque `$` échappé pour dotenv-expand. */
export function buildEnvLine(hash) {
  return `${ENV_KEY}=${hash.replace(/\$/g, '\\$')}`;
}

/**
 * Remplace (toutes les occurrences de) la ligne FAILSAFE_ROOT_PASSWORD_HASH, ou l'ajoute en fin
 * de fichier si absente. Les autres lignes et le style de fin de ligne (CRLF/LF) sont préservés.
 */
export function upsertEnvLine(content, hash) {
  const newLine = buildEnvLine(hash);
  const eol = content.includes('\r\n') ? '\r\n' : content.includes('\n') ? '\n' : '\r\n';
  // Remplacement par expression régulière sur le texte brut : les fins de ligne (même mixtes)
  // et toutes les autres lignes restent octet pour octet identiques. Fonction de remplacement
  // (et non chaîne) pour que les `$` de l'empreinte ne soient pas interprétés par replace().
  let replaced = false;
  const updated = content.replace(KEY_LINE, () => {
    replaced = true;
    return newLine;
  });
  if (replaced) return updated;
  if (content.length === 0) return newLine + eol;
  // Ajout : s'assurer que le contenu existant se termine par une fin de ligne.
  const endsWithEol = /\r?\n$/.test(content);
  return content + (endsWithEol ? '' : eol) + newLine + eol;
}

/** Écrit l'empreinte dans le fichier (création si absent), via fichier temporaire puis renommage. */
export function writeRootHashToEnvFile(envPath, hash) {
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const next = upsertEnvLine(current, hash);
  const tmp = `${envPath}.tmp-${process.pid}`;
  writeFileSync(tmp, next, 'utf8');
  renameSync(tmp, envPath);
}

/** Lit une saisie masquée sur le terminal (mode brut), sans jamais l'afficher. */
function promptHidden(question) {
  return new Promise((resolvePrompt, rejectPrompt) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buffer = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolvePrompt(buffer);
          return;
        }
        if (ch === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          rejectPrompt(new Error('Saisie annulée.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          buffer = buffer.slice(0, -1);
        } else if (ch >= ' ') {
          buffer += ch;
        }
      }
    };
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on('data', onData);
  });
}

function resolveTargetPath() {
  const argIdx = process.argv.indexOf('--fichier');
  if (argIdx !== -1 && process.argv[argIdx + 1]) return resolve(process.argv[argIdx + 1]);
  if (process.env.GIS_ENV_FILE) return resolve(process.env.GIS_ENV_FILE);
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error('Ce script demande un terminal interactif (saisie masquée du mot de passe).');
    process.exit(1);
  }
  const target = resolveTargetPath();
  console.log(`Fichier cible : ${target}`);
  console.log(`Choisissez le mot de passe ROOT (${MIN_PASSWORD_LENGTH} caractères minimum). Rien ne s'affiche pendant la saisie.`);
  const first = await promptHidden('Mot de passe : ');
  const second = await promptHidden('Confirmez le mot de passe : ');
  const problem = validateRootPassword(first, second);
  if (problem) {
    console.error(`Refusé : ${problem} Aucune modification n'a été faite.`);
    process.exit(1);
  }
  writeRootHashToEnvFile(target, hashRootPassword(first));
  console.log('');
  console.log('Empreinte enregistrée dans le fichier (le mot de passe lui-même n\'est écrit nulle part).');
  console.log('IMPORTANT : notez le mot de passe dans un endroit sûr, il est impossible de le retrouver ensuite.');
  console.log('Pour que ROOT fonctionne sur les postes, il faut reconstruire puis publier une nouvelle version.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`Erreur : ${err.message}`);
    process.exit(1);
  });
}
