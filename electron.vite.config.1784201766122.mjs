// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { loadEnv } from "vite";
function copyWorkerPlugin() {
  return {
    name: "copy-worker",
    closeBundle() {
      const outDir = resolve("dist/main/workers");
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      const importWorker = resolve("src/main/workers/import-worker.js");
      if (existsSync(importWorker)) copyFileSync(importWorker, resolve(outDir, "import-worker.js"));
      const uploadWorker = resolve("src/main/workers/upload-worker.js");
      if (existsSync(uploadWorker)) copyFileSync(uploadWorker, resolve(outDir, "upload-worker.js"));
      const statsWorker = resolve("src/main/workers/stats-worker.js");
      if (existsSync(statsWorker)) copyFileSync(statsWorker, resolve(outDir, "stats-worker.js"));
      const downloadWorker = resolve("src/main/workers/download-worker.js");
      if (existsSync(downloadWorker)) copyFileSync(downloadWorker, resolve(outDir, "download-worker.js"));
    }
  };
}
var electron_vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    main: {
      plugins: [externalizeDepsPlugin(), copyWorkerPlugin()],
      define: {
        // Injecter les variables Supabase dans le bundle Main (process.env)
        "process.env.VITE_SUPABASE_URL": JSON.stringify(env.VITE_SUPABASE_URL || ""),
        "process.env.VITE_SUPABASE_ANON_KEY": JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ""),
        "process.env.SUPABASE_SUPERADMIN_PASSWORD": JSON.stringify(env.SUPABASE_SUPERADMIN_PASSWORD || ""),
        "process.env.SUPABASE_SITE_PASSWORD_PREFIX": JSON.stringify(env.SUPABASE_SITE_PASSWORD_PREFIX || "")
      },
      build: {
        outDir: "dist/main",
        rollupOptions: {
          external: ["better-sqlite3"]
        }
      },
      esbuild: {
        drop: ["console", "debugger"]
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      build: {
        outDir: "dist/preload"
      },
      esbuild: {
        drop: ["console", "debugger"]
      }
    },
    renderer: {
      resolve: {
        alias: {
          "@": resolve("src/renderer/src"),
          "@components": resolve("src/renderer/src/components"),
          "@pages": resolve("src/renderer/src/pages"),
          "@stores": resolve("src/renderer/src/stores"),
          "@hooks": resolve("src/renderer/src/hooks"),
          "@utils": resolve("src/renderer/src/utils"),
          "@assets": resolve("src/renderer/src/assets")
        }
      },
      plugins: [react()],
      optimizeDeps: {
        include: ["react", "react-dom", "react-router-dom", "lucide-react"]
      },
      build: {
        outDir: "dist/renderer",
        rollupOptions: {
          input: resolve("src/renderer/index.html")
        }
      },
      esbuild: {
        drop: ["console", "debugger"]
      }
    }
  };
});
export {
  electron_vite_config_default as default
};
