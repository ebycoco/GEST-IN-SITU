// Configuration par variables Vite (mobile/.env.local, ignore par git ; modele : .env.example).
// Cle PUBLIQUE uniquement : la cle publishable est faite pour etre visible dans le navigateur.

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
const gis = (import.meta.env.VITE_GIS_LOGIN_URL ?? '').trim();

export const config = {
  supabaseUrl: url,
  publishableKey: key,
  gisLoginUrl: gis !== '' ? gis : `${url}/functions/v1/gis-login`,
  valide: /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)/.test(url) && key !== '',
};
