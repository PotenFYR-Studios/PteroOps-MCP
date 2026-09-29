# PteroOps docs site

The org-styled documentation website for PteroOps: Vite + React + Tailwind, sharing the PotenFYR
docs design tokens. It renders the repository markdown (`../*.md`) at build time — edit the
markdown, not the site, for content changes.

## Commands

```bash
npm install        # install site dependencies (from this directory)
npm run dev        # local dev server
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build locally
```

From the repository root:

```bash
npm run docs:install
npm run docs:dev
npm run docs:build
```

## Deployment

`.github/workflows/docs.yml` builds and deploys `dist/` to GitHub Pages on pushes that touch
`docs/**`. Enable **Settings → Pages → Build and deployment → GitHub
Actions** once per repository. The base path is `/PteroOps-MCP/` unless `public/CNAME` exists, in
which case the site is served from the custom domain root.
