import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { DOC_PAGES } from './docs/content';

const META: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'PteroOps — AI SRE & self-healing operations for Pterodactyl',
    description:
      'PteroOps turns Pterodactyl into an AI-operable SRE platform: persistent console intelligence, application detection, crash-loop diagnosis, incidents, change correlation and policy-controlled remediation with rollback, over MCP.',
  },
  '/docs': {
    title: 'Documentation | PteroOps',
    description:
      'Installation, configuration, the MCP surface, capability map, monitoring, integrations and the agent guide for PteroOps.',
  },
  '/examples': {
    title: 'Examples | PteroOps',
    description:
      'Real PteroOps sessions: diagnosing a crash loop, a change-correlated outage, and a policy-gated remediation with rollback.',
  },
  '/status': {
    title: 'Project status | PteroOps',
    description:
      'Phase-by-phase delivery status for PteroOps: what is implemented, tested and verified — straight from the living status plan.',
  },
  '/about': {
    title: 'About | PteroOps',
    description:
      'PteroOps is an open-source MCP server by PotenFYR Studios: observation before action, evidence before restart, diff before write.',
  },
  '/license': {
    title: 'License | PteroOps',
    description: 'PteroOps is MIT licensed.',
  },
};

export default function SeoManager() {
  const location = useLocation();

  useEffect(() => {
    const docMatch = /^\/docs\/([a-z0-9-]+)$/.exec(location.pathname);
    const doc = docMatch ? DOC_PAGES.find((p) => p.slug === docMatch[1]) : undefined;
    const meta = doc
      ? { title: `${doc.title} | PteroOps docs`, description: doc.summary }
      : META[location.pathname] ?? META['/'];
    document.title = meta.title;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', meta.description);
  }, [location.pathname]);

  return null;
}
