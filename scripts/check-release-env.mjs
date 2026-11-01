#!/usr/bin/env node
/**
 * scripts/check-release-env.mjs
 *
 * Garde-fou de COMPILATION : refuse de construire un installeur « sans configuration ».
 *
 * Contexte : electron.vite.config.ts fige au build trois valeurs dans le paquet
 * (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, FAILSAFE_ROOT_PASSWORD_HASH -> BAKED_...).
 * Si l'empreinte ROOT manque ou est mal écrite (ex. `$` non échappés), ROOT est désactivé SANS
 * aucun avertissement ; si l'URL/la clé Supabase manquent, plus aucune synchronisation.
 *
 * Branché en hook npm « pre » sur `build:win` et `release` UNIQUEMENT (package.json : prebuild:win,
 * prerelease). Ne s'exécute PAS pour `build`, `dev`, `test:e2e` (build e2e avec URL factice et sans
 * empreinte ROOT : volontairement hors garde-fou).
 *
 * Usage (à la racine du projet) :
 *   node scripts/check-release-env.mjs
 *   node scripts/check-release-env.mjs --dossier chemin/vers/un/dossier   (ou variable GIS_ENV_DIR)
 *
 * Fidélité au build : même appel que electron.vite.config.ts, soit
 *   loadEnv('production', <dossier = process.cwd()>, '')
 * (donc mêmes fichiers .env* lus, même précédence : process.env l'emporte sur les fichiers).
 *
 * Garanties : aucune valeur (URL, clé, empreinte) n'est jamais affichée ; code de sortie 1 en cas
 * de problème, 0 sinon. Aucun accès réseau, aucune écriture.
 *
 * Fonctions exportées (testables) : BCRYPT_HASH_PATTERN, checkReleaseEnv, loadReleaseEnv, resolveEnvDir.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

/** Motif copié à l'identique de src/main/ipc/handlers.ts (BCRYPT_HASH_PATTERN) — volontairement non importé. */
export const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * Vérifie un objet d'environnement tel que le build le verra.
 * @param {Record<string, string | undefined>} env
 * @returns {{ variable: string, message: string }[]} liste des problèmes (vide = configuration OK)
 */
export function checkReleaseEnv(env) {
  const problemes = [];
  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  const cle = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  const empreinte = (env.FAILSAFE_ROOT_PASSWORD_HASH ?? '').trim();

  if (!url) {
    problemes.push({ variable: 'VITE_SUPABASE_URL', message: "absente ou vide : l'installeur n'aurait aucune synchronisation avec le serveur." });
  } else if (!url.startsWith('https://')) {
    problemes.push({ variable: 'VITE_SUPABASE_URL', message: "doit commencer par https:// (adresse du serveur Supabase)." });
  }

  if (!cle) {
    problemes.push({ variable: 'VITE_SUPABASE_ANON_KEY', message: "absente ou vide : l'installeur n'aurait aucune synchronisation avec le serveur." });
  }

  if (!empreinte) {
    problemes.push({ variable: 'FAILSAFE_ROOT_PASSWORD_HASH', message: "absente ou vide : le compte ROOT de secours serait désactivé dans l'installeur. Cause probable : ligne absente du .env, ou « $ » non échappés (la valeur est alors vidée à la lecture). Relancez : node scripts/set-root-password.mjs" });
  } else if (!BCRYPT_HASH_PATTERN.test(empreinte)) {
    problemes.push({
      variable: 'FAILSAFE_ROOT_PASSWORD_HASH',
      message: "n'a pas la forme d'une empreinte bcrypt valide. Cause probable : les « $ » n'ont pas été échappés (\\$) dans le fichier .env, ou la valeur a été tronquée/modifiée. Relancez : node scripts/set-root-password.mjs"
    });
  }

  return problemes;
}

/** Dossier racine lu pour les fichiers .env : --dossier, sinon GIS_ENV_DIR, sinon process.cwd() (comme le build). */
export function resolveEnvDir(argv = process.argv, env = process.env) {
  const idx = argv.indexOf('--dossier');
  if (idx !== -1 && argv[idx + 1]) return resolve(argv[idx + 1]);
  if (env.GIS_ENV_DIR) return resolve(env.GIS_ENV_DIR);
  return process.cwd();
}

/** Reproduit exactement le chargement de electron.vite.config.ts (mode production, préfixe vide). */
export function loadReleaseEnv(dossier) {
  return loadEnv('production', dossier, '');
}

function main() {
  const dossier = resolveEnvDir();
  let problemes;
  try {
    problemes = checkReleaseEnv(loadReleaseEnv(dossier));
  } catch (err) {
    console.error(`ERREUR : impossible de lire la configuration de compilation (${err instanceof Error ? err.message : 'erreur inconnue'}).`);
    process.exit(1);
  }

  if (problemes.length === 0) {
    console.log('Configuration de compilation OK');
    return;
  }

  console.error('');
  console.error('COMPILATION REFUSÉE : la configuration du fichier .env est incomplète ou incorrecte.');
  console.error("Sans elle, l'installeur serait livré cassé (pas de synchronisation, compte ROOT de secours désactivé).");
  console.error('');
  for (const p of problemes) {
    console.error(` - ${p.variable} : ${p.message}`);
  }
  console.error('');
  console.error("Rappel : le fichier .env ne doit JAMAIS être commité ni partagé (il contient les secrets de production).");
  console.error('Aucune valeur n\'est affichée par ce contrôle, par sécurité.');
  console.error('');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
