/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_TEMP_PASSWORD?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
