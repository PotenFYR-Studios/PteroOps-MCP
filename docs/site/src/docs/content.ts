import rawGettingStarted from '../../../getting-started.md?raw';
import rawInstallation from '../../../installation.md?raw';
import rawConfiguration from '../../../configuration.md?raw';
import rawAgentGuide from '../../../agent-guide.md?raw';
import rawCapabilityMap from '../../../capability-map.md?raw';
import rawMcpReference from '../../../mcp-reference.md?raw';
import rawMonitoring from '../../../monitoring.md?raw';
import rawIntegrations from '../../../integrations.md?raw';
import rawDemoTranscript from '../../../demo-transcript.md?raw';
import rawStatus from '../../../status.md?raw';

export interface DocPage {
  slug: string;
  title: string;
  category: 'Get started' | 'Operate' | 'Reference' | 'Status';
  summary: string;
  raw: string;
  source: string;
}

export const DOC_PAGES: DocPage[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    category: 'Get started',
    summary: 'Install PteroOps in minutes, connect it to your AI app and run your first real conversations.',
    raw: rawGettingStarted,
    source: 'docs/getting-started.md',
  },
  {
    slug: 'installation',
    title: 'Installation',
    category: 'Get started',
    summary:
      'Every supported install method: one-liner installers, npm/npx, release tarballs, source builds, Docker, Kubernetes, systemd and offline installs.',
    raw: rawInstallation,
    source: 'docs/installation.md',
  },
  {
    slug: 'agent-guide',
    title: 'Agent guide',
    category: 'Operate',
    summary: 'How AI agents should operate PteroOps: the observation-first workflow, safety rules and worked scenarios.',
    raw: rawAgentGuide,
    source: 'docs/agent-guide.md',
  },
  {
    slug: 'capability-map',
    title: 'Capability map',
    category: 'Operate',
    summary: 'What PteroOps can do for you, grouped by job to be done — with the tools, keys and risk level behind each.',
    raw: rawCapabilityMap,
    source: 'docs/capability-map.md',
  },
  {
    slug: 'mcp-reference',
    title: 'MCP reference',
    category: 'Reference',
    summary: 'The full tool, resource and prompt surface with schemas, capabilities and annotations.',
    raw: rawMcpReference,
    source: 'docs/mcp-reference.md',
  },
  {
    slug: 'configuration',
    title: 'Configuration',
    category: 'Reference',
    summary: 'Every environment variable and config file field: servers, storage, retention, security and notifications.',
    raw: rawConfiguration,
    source: 'docs/configuration.md',
  },
  {
    slug: 'monitoring',
    title: 'Monitoring',
    category: 'Reference',
    summary: 'Monitor loops, streaming, Prometheus metrics and the scheduler that keeps PteroOps watching.',
    raw: rawMonitoring,
    source: 'docs/monitoring.md',
  },
  {
    slug: 'integrations',
    title: 'Integrations',
    category: 'Reference',
    summary: 'Connecting PteroOps to Claude Code, Claude Desktop, Cursor, VS Code, Docker and remote HTTP deployments.',
    raw: rawIntegrations,
    source: 'docs/integrations.md',
  },
  {
    slug: 'demo-transcript',
    title: 'Demo transcript',
    category: 'Reference',
    summary: 'A generated, deterministic end-to-end session showing the diagnosis and remediation pipeline in action.',
    raw: rawDemoTranscript,
    source: 'docs/demo-transcript.md',
  },
  {
    slug: 'status',
    title: 'Status',
    category: 'Status',
    summary: 'The living tracker: what exists today, phase by phase and module by module, verified by the test suite.',
    raw: rawStatus,
    source: 'docs/status.md',
  },
];

export const DOC_CATEGORIES: DocPage['category'][] = ['Get started', 'Operate', 'Reference', 'Status'];

export function docBySlug(slug: string): DocPage | undefined {
  return DOC_PAGES.find((p) => p.slug === slug);
}

const GITHUB_BLOB = 'https://github.com/PotenFYR-Studios/PteroOps-MCP/blob/main';
const base = import.meta.env.BASE_URL;

function slugify(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');
}

function rewriteHref(href: string): string {
  if (/^https?:\/\//.test(href) || href.startsWith('#') || href.startsWith('mailto:')) return href;
  const docMatch = /^([a-z0-9-]+)\.md(#.*)?$/.exec(href);
  if (docMatch) return `${base}docs/${docMatch[1]}${docMatch[2] ?? ''}`;
  if (href.startsWith('../')) return `${GITHUB_BLOB}/${href.slice(3)}`;
  return href;
}

export interface TocEntry {
  id: string;
  text: string;
}

export interface RenderedDoc {
  html: string;
  toc: TocEntry[];
}

function transformPre(block: string): string {
  const lang = /<code class="language-([^"]+)"/.exec(block)?.[1] ?? 'text';
  const inner = block.replace(/<code class="language-[^"]+"(>)?/, '<code$1');
  return inner
    .replace('<pre>', `<pre class="spec-pre" data-lang="${lang}">`)
    .replace('</pre>', '<button class="copy-btn" type="button">Copy</button></pre>');
}

async function renderMarkdown(raw: string): Promise<RenderedDoc> {
  const { marked } = await import('marked');
  let html = marked.parse(raw, { gfm: true, async: false }) as string;

  const pres: string[] = [];
  html = html.replace(/<pre>[\s\S]*?<\/pre>/g, (block) => {
    pres.push(transformPre(block));
    return `\u0000PRE${pres.length - 1}\u0000`;
  });

  html = html.replace(/<code>/g, '<code class="inline">');
  html = html.replace(/<table>/g, '<div class="table-scroll"><table class="spec-table">');
  html = html.replace(/<\/table>/g, '</table></div>');

  const toc: TocEntry[] = [];
  html = html.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, level: string, text: string) => {
    const id = slugify(text);
    if (level === '2') toc.push({ id, text: text.replace(/<[^>]*>/g, '') });
    return `<h${level} id="${id}">${text}</h${level}>`;
  });

  html = html.replace(/href="([^"]+)"/g, (_m, href: string) => `href="${rewriteHref(href)}"`);
  html = html.replace(/\u0000PRE(\d+)\u0000/g, (_m, i: string) => pres[Number(i)] ?? '');

  return { html, toc };
}

const renderCache = new Map<string, Promise<RenderedDoc>>();

export function getRendered(page: DocPage): Promise<RenderedDoc> {
  let cached = renderCache.get(page.slug);
  if (!cached) {
    cached = renderMarkdown(page.raw.replace(/^#\s.*\r?\n/, ''));
    renderCache.set(page.slug, cached);
  }
  return cached;
}
