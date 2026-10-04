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
 * Absolute OG/Twitter/canonical URLs must match the real deploy origin: a
 * custom domain served at the root, or the GitHub project page under
 * /<repo>/. Mirrors customDomain() so adding public/CNAME later keeps the
 * link preview correct.
 */
function seoOrigin(): Plugin {
  const origin = DOMAIN
    ? `https://${DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
    : 'https://potenfyr-studios.github.io/PteroOps-MCP';
  return {
    name: 'seo-origin',
    transformIndexHtml(html) {
      return html.replaceAll('%OG_ORIGIN%', origin);
    },
  };
}


/**
 * The site renders the repository's markdown docs (docs/*.md), which live
 * outside the Vite root, allow reading one level up and keep the raw imports working.
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
  plugins: [react(), rawMarkdown(), seoOrigin()],
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
});
