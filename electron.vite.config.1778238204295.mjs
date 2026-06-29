// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync } from "fs";
function copyWorkerPlugin() {
  return {
    name: "copy-worker",
    closeBundle() {
      const srcWorker = resolve("src/main/workers/import-worker.js");
      const outDir = resolve("out/main/workers");
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      copyFileSync(srcWorker, resolve(outDir, "import-worker.js"));
    }
  };
}
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyWorkerPlugin()],
    build: {
      rollupOptions: {
        external: ["better-sqlite3"]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
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
    build: {
      rollupOptions: {
        input: resolve("src/renderer/index.html")
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
