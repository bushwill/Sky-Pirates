import { defineConfig } from 'vite';

export default defineConfig({
  // The public website reverse-proxies this app under /flagstrike/.
  base: '/flagstrike/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
