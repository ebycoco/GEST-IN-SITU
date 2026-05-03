import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['better-sqlite3']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@components': resolve('src/renderer/src/components'),
        '@pages': resolve('src/renderer/src/pages'),
        '@stores': resolve('src/renderer/src/stores'),
        '@hooks': resolve('src/renderer/src/hooks'),
        '@utils': resolve('src/renderer/src/utils'),
        '@assets': resolve('src/renderer/src/assets')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: resolve('src/renderer/index.html')
      }
    }
  }
});
