import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

/** custom domain support: public/CNAME presence switches the deploy base path. */
function customDomain(): string | null {
  try {
    const raw = readFileSync(new URL('./public/CNAME', import.meta.url), 'utf8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

const DOMAIN = customDomain();

/**
 * The site renders the repository's markdown docs (docs/*.md), which live
 * outside the Vite root — allow reading one level up and keep the raw imports working.
 */
function rawMarkdown(): Plugin {
  return {
    name: 'raw-markdown',
    config() {
      return { server: { fs: { allow: ['..', '../..'] } } };
    },
  };
}

export default defineConfig({
  base: DOMAIN ? '/' : '/PteroOps-MCP/',
  plugins: [react(), rawMarkdown()],
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
