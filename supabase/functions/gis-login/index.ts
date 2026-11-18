// ============================================================
// supabase/functions/gis-login/index.ts
// GEST-IN-SITU : connexion EN LIGNE d'une personne (chantier B, P1-5c).
//
// Entree  : POST {"login": "...", "password": "..."} (JSON, <= 4 Ko)
// Sortie  : 200 {"ok":true,"token_hash":"...","type":"magiclink","user":{...}}
//           Le POSTE (ou la future PWA) appelle ensuite lui-meme
//           supabase.auth.verifyOtp({ token_hash, type }) avec la cle
//           publishable (decision Q3) : la fonction ne cree JAMAIS de session.
//
// Etapes :
//   1. fn_login_check_and_record(login, 'check')  -> 429 si bloque (0012)
//   2. lecture t_users (service_role) + bcrypt DANS la fonction (C2) :
//      bcryptjs 2.4.3 (meme bibliotheque que le poste), prefixes $2a$/$2b$/$2y$
//      normalises en $2a$ (algorithme identique pour ces empreintes).
//      Login inconnu : comparaison contre une empreinte factice (meme duree).
//   3. echec (login inconnu, mauvais mot de passe, compte inactif, empreinte
//      illisible, sync_id absent) -> 'failure' -> MEME reponse 401 generique
//      (ou 429 + retry_after si ce dernier echec declenche le blocage).
//   4. succes -> 'success' ; controles site (SITE suspendu / licence expiree,
//      comme le poste : signales seulement apres un mot de passe juste) ;
//      compte Auth miroir <sync_id>@users.gest-in-situ.invalid (C7, cree a la
//      premiere connexion, C8, email confirme d'office, aucun envoi) ;
//      generateLink(magiclink) -> fn_auth_identity_upsert(auth_user_id,
//      sync_id) (pose last_online_login_at = now(), base de la regle D3 des
//      30 jours appliquee par le hook 0011) -> renvoi du token_hash.
//
// Securite :
//   - cle secrete lue dans les variables automatiques de la fonction
//     (SUPABASE_SECRET_KEYS.default, sinon SUPABASE_SERVICE_ROLE_KEY) ;
//     jamais de fichier, jamais renvoyee ;
//   - aucun login, mot de passe, empreinte ni jeton dans les journaux :
//     seuls des codes d'evenement (console.log({ evt })) ;
//   - verify_jwt = false au deploiement : l'appelant n'a pas encore de
//     session (la cle publishable n'est pas un JWT) ; l'authentification est
//     le mot de passe lui-meme + la limite de tentatives par login (0012).
//
// CORS (future PWA) : origines autorisees = variable d'environnement
// GIS_ALLOWED_ORIGINS (liste separee par des virgules) si elle est definie,
// sinon DEFAULT_ALLOWED_ORIGINS ci-dessous (serveurs de developpement locaux).
// Un appel sans en-tete Origin (poste Electron, processus principal Node)
// n'est pas concerne par CORS. Une origine non listee ne recoit aucun
// en-tete Access-Control-Allow-Origin (le navigateur bloque la reponse).
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import bcrypt from 'npm:bcryptjs@2.4.3';

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];
const MIRROR_EMAIL_DOMAIN = 'users.gest-in-situ.invalid';
const MAX_BODY_BYTES = 4096;
const MAX_LOGIN_LEN = 128;
const MAX_PASSWORD_LEN = 256;
const SYNC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

const GENERIC_FAIL = { ok: false, error: 'invalid_credentials', message: 'Identifiant ou mot de passe incorrect.' };

// Empreinte factice (cout 10, comme le poste) : egalise la duree pour un login inconnu.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomUUID(), 10);

function allowedOrigins(): string[] {
  const raw = Deno.env.get('GIS_ALLOWED_ORIGINS');
  if (raw && raw.trim() !== '') {
    return raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
  }
  return DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin' };
  const origin = req.headers.get('Origin');
  if (origin && allowedOrigins().includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type';
    h['Access-Control-Expose-Headers'] = 'Retry-After';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

function json(req: Request, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      ...extra,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function logEvt(evt: string): void {
  // Codes seulement : jamais de login, mot de passe, empreinte ni jeton.
  console.log(JSON.stringify({ fn: 'gis-login', evt }));
}

function secretKey(): string | null {
  try {
    const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
    if (raw) {
      const k = JSON.parse(raw)?.['default'];
      if (typeof k === 'string' && k !== '') return k;
    }
  } catch {
    // variable illisible : on tente la cle legacy
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? null;
}

function normalizeHash(h: unknown): string | null {
  if (typeof h !== 'string' || !BCRYPT_RE.test(h)) return null;
  return '$2a$' + h.slice(4);
}

function licenceExpired(expiry: unknown, nowMs: number): boolean {
  // Regle A1 (src/shared/utils/license.ts) : le jour d'echeance est le dernier jour
  // utilisable ; blocage a partir du lendemain 00:00 UTC. Date illisible : pas de blocage.
  if (expiry === null || expiry === undefined) return false;
  const ms = new Date(String(expiry)).getTime();
  if (Number.isNaN(ms)) return false;
  const d = new Date(ms);
  const limit = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 86_400_000;
  return nowMs >= limit;
}

type Attempt = { allowed: boolean; retry_after_s: number; invalid?: boolean; error?: boolean };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return json(req, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' });
  }

  // ---- Lecture bornee du corps ----
  let login: string;
  let password: string;
  try {
    const len = Number(req.headers.get('content-length') ?? '0');
    if (len > MAX_BODY_BYTES) return json(req, 413, { ok: false, error: 'payload_too_large' });
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json(req, 413, { ok: false, error: 'payload_too_large' });
    const body = JSON.parse(text);
    login = typeof body?.login === 'string' ? body.login.trim() : '';
    password = typeof body?.password === 'string' ? body.password : '';
  } catch {
    return json(req, 400, { ok: false, error: 'bad_request' });
  }
  if (login === '' || login.length > MAX_LOGIN_LEN || password === '' || password.length > MAX_PASSWORD_LEN) {
    return json(req, 400, { ok: false, error: 'bad_request' });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const key = secretKey();
  if (!url || !key) {
    logEvt('config_missing');
    return json(req, 503, { ok: false, error: 'service_unavailable' });
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const attempt = async (action: 'check' | 'failure' | 'success'): Promise<Attempt | null> => {
    const { data, error } = await admin.rpc('fn_login_check_and_record', { p_login: login, p_action: action });
    if (error || !data || typeof data !== 'object') return null;
    return data as Attempt;
  };
  const blocked = (a: Attempt) => {
    const s = Math.max(1, Math.ceil(Number(a.retry_after_s) || 60));
    return json(req, 429, {
      ok: false, error: 'too_many_attempts',
      message: 'Trop de tentatives. Reessayez plus tard.', retry_after: s,
    }, { 'Retry-After': String(s) });
  };

  try {
    // ---- 1. Limite de tentatives ----
    const chk = await attempt('check');
    if (!chk) { logEvt('attempts_unavailable'); return json(req, 503, { ok: false, error: 'service_unavailable' }); }
    if (chk.invalid) return json(req, 400, { ok: false, error: 'bad_request' });
    if (chk.error) { logEvt('attempts_error'); return json(req, 503, { ok: false, error: 'service_unavailable' }); }
    if (!chk.allowed) { logEvt('blocked'); return blocked(chk); }

    // ---- 2. Compte + mot de passe ----
    const { data: rows, error: uErr } = await admin
      .from('t_users')
      .select('sync_id, password_hash, statut_actif, role, site_id')
      .eq('login', login)
      .limit(1);
    if (uErr) { logEvt('users_read_error'); return json(req, 503, { ok: false, error: 'service_unavailable' }); }
    const user = rows && rows.length === 1 ? rows[0] : null;

    const hash = user ? normalizeHash(user.password_hash) : null;
    if (user && !hash) logEvt('hash_format_unknown');
    const pwdOk = await bcrypt.compare(password, hash ?? DUMMY_HASH);
    const syncOk = !!user && typeof user.sync_id === 'string' && SYNC_ID_RE.test(user.sync_id);
    if (user && hash && pwdOk && !syncOk) logEvt('sync_id_unusable');
    const actif = !!user && Number(user.statut_actif) === 1;

    if (!user || !hash || !pwdOk || !syncOk || !actif) {
      const f = await attempt('failure');
      logEvt('failure');
      if (f && !f.allowed && !f.invalid) return blocked(f);
      return json(req, 401, GENERIC_FAIL);
    }

    // ---- 3. Mot de passe juste ----
    await attempt('success');
    const syncId: string = user.sync_id;

    const { data: extra } = await admin.from('t_user_roles').select('role').eq('user_sync_id', syncId);
    const roles = new Set<string>([String(user.role ?? '').trim()].filter((r) => r !== ''));
    for (const r of extra ?? []) if (typeof r.role === 'string' && r.role.trim() !== '') roles.add(r.role.trim());
    const isSa = roles.has('SUPER ADMIN');

    if (!isSa) {
      if (user.site_id === null || user.site_id === undefined) {
        logEvt('no_site');
        return json(req, 403, { ok: false, error: 'no_site', message: 'Compte sans site.' });
      }
      const { data: site, error: sErr } = await admin
        .from('t_sites').select('id, is_active, expiry_date, is_permanent').eq('id', user.site_id).maybeSingle();
      if (sErr) { logEvt('site_read_error'); return json(req, 503, { ok: false, error: 'service_unavailable' }); }
      if (!site) { logEvt('no_site'); return json(req, 403, { ok: false, error: 'no_site', message: 'Compte sans site.' }); }
      if (Number(site.is_active) === 0) {
        logEvt('site_suspended');
        return json(req, 403, { ok: false, error: 'site_suspended', message: 'Site suspendu.' });
      }
      if (site.is_permanent !== true && licenceExpired(site.expiry_date, Date.now())) {
        logEvt('licence_expired');
        return json(req, 403, { ok: false, error: 'licence_expired', message: 'Licence du site expiree.' });
      }
    }

    // ---- 4. Compte Auth miroir (C7/C8) ----
    const email = `${syncId.toLowerCase()}@${MIRROR_EMAIL_DOMAIN}`;
    const { data: ident } = await admin
      .from('t_auth_identity').select('auth_user_id').eq('user_sync_id', syncId).maybeSingle();
    if (!ident) {
      const { error: cErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        app_metadata: { sync_id: syncId },
      });
      // Deja present (identite effacee, compte Auth reste) : generateLink le retrouvera.
      if (cErr && (cErr as { code?: string }).code !== 'email_exists') {
        logEvt('mirror_create_error');
        return json(req, 503, { ok: false, error: 'service_unavailable' });
      }
    }

    const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const authUserId = link?.user?.id;
    const tokenHash = link?.properties?.hashed_token;
    if (lErr || !authUserId || !tokenHash) {
      logEvt('generate_link_error');
      return json(req, 503, { ok: false, error: 'service_unavailable' });
    }
    if (ident && ident.auth_user_id !== authUserId) {
      logEvt('identity_mismatch');
      return json(req, 503, { ok: false, error: 'service_unavailable' });
    }

    const { data: upOk, error: upErr } = await admin.rpc('fn_auth_identity_upsert', {
      p_auth_user_id: authUserId,
      p_user_sync_id: syncId,
    });
    if (upErr || upOk !== true) {
      logEvt('identity_upsert_refused');
      return json(req, 503, { ok: false, error: 'service_unavailable' });
    }

    logEvt('success');
    return json(req, 200, {
      ok: true,
      token_hash: tokenHash,
      type: 'magiclink',
      user: {
        sync_id: syncId,
        primary_role: user.role ?? null,
        roles: [...roles].sort(),
        is_super_admin: isSa,
      },
    });
  } catch {
    logEvt('unexpected_error');
    return json(req, 503, { ok: false, error: 'service_unavailable' });
  }
});
