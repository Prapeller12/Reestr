import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base:'./' — относительные пути ассетов, чтобы SPA корректно грузилась из кастомной
// схемы Tauri после встраивания в бинарь (frontend.md §1, принцип 1 — ноль внешних URL).
// Порт 1420 фиксирован и совпадает с devUrl в src-tauri/tauri.conf.json.
export default defineConfig({
  plugins: [react()],
  base: './',
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2021',
    sourcemap: false,
    emptyOutDir: true,
  },
});
