import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base: the built site works from any static host or sub-path. Hash routing needs no server rewrites.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
