import { Link } from 'react-router-dom';
import { Pre } from '../components/Code';

const BADGES = [
  { src: 'https://img.shields.io/badge/MCP-63%20tools-8b5cf6?style=for-the-badge&labelColor=1c1e26', alt: '63 MCP tools' },
  { src: 'https://img.shields.io/badge/Resources-14-ec4899?style=for-the-badge&labelColor=1c1e26', alt: '14 resources' },
  { src: 'https://img.shields.io/badge/Prompts-8-f97316?style=for-the-badge&labelColor=1c1e26', alt: '8 prompts' },
  { src: 'https://img.shields.io/badge/Tests-270-2ea043?style=for-the-badge&labelColor=1c1e26', alt: '270 tests' },
  { src: 'https://img.shields.io/badge/License-MIT-8b5cf6?style=for-the-badge&labelColor=1c1e26', alt: 'MIT license' },
];

const INSTALL = `# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.ps1 | iex

# zero-install via npx (stdio transport)
npx -y github:PotenFYR-Studios/PteroOps-MCP --transport stdio`;

const PIPELINE = [
  'Observe',
  'Detect',
  'Correlate',
  'Diagnose',
  'Explain',
  'Propose',
  'Approve',
  'Remediate',
  'Verify',
  'Roll back',
  'Learn',
];

const STATS = [
  { value: '63', label: 'MCP tools' },
  { value: '14', label: 'resources' },
  { value: '8', label: 'prompts' },
  { value: '270', label: 'tests (SQLite)' },
  { value: 'A–I', label: 'phases delivered' },
];

const WHY = [
  {
    n: '01',
    title: 'Persistent console intelligence',
    body: 'PteroOps streams every console, classifies lines, fingerprints crashes and answers “what happened around 03:12?” from storage, not by asking you to paste logs.',
  },
  {
    n: '02',
    title: 'Application detection',
    body: 'Evidence-weighted detectors recognize Minecraft, Node (Next/Nuxt/SvelteKit/…), Python, PHP, Ruby, Go, Rust, Java, game servers and containers, confidence is never fabricated.',
  },
  {
    n: '03',
    title: 'Crash loops, health & diagnosis',
    body: 'Persistent process events, crash-loop detection, health scoring and a deterministic diagnosis engine that returns facts, causes, confidence and the evidence still missing.',
  },
  {
    n: '04',
    title: 'Change ledger & correlation',
    body: 'File edits, git pulls, config changes and restarts land in one ledger. When something breaks, PteroOps correlates the incident with what changed and when.',
  },
  {
    n: '05',
    title: 'AI code debugging',
    body: 'Stack frames are traced into bounded file snippets, source text can be searched safely, and config syntax checked, so the model debugs with real code, not guesses.',
  },
  {
    n: '06',
    title: 'Policy-gated remediation',
    body: 'Plan, simulate, risk-rate, approve, execute and verify, with automatic rollback, stabilization windows, canaries and honest effectiveness statistics.',
  },
];

const COMPAT = [
  { name: 'Claude Code', setup: 'claude mcp add', note: 'stdio one-liner with npx or a local install' },
  { name: 'Claude Desktop', setup: 'claude_desktop_config.json', note: 'command + args entries for stdio' },
  { name: 'Cursor', setup: '.cursor/mcp.json', note: 'stdio or remote HTTP' },
  { name: 'VS Code', setup: '.vscode/mcp.json', note: 'stdio or `type: http` server entries' },
  { name: 'Codex / other MCP clients', setup: 'client MCP config', note: 'any MCP-capable agent works' },
  { name: 'Remote agents', setup: '--transport http', note: 'bearer-protected /mcp over TLS' },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-[1280px] px-5 pb-20 pt-14 sm:px-7">
      <section className="mx-auto max-w-[860px] text-center">
        <p className="mono-label mb-4">PteroOps docs · v0.1.0 · MCP-native</p>
        <h1 className="text-[clamp(2.2em,5vw,3.4em)] font-extrabold leading-[1.08] tracking-[-0.03em]">
          <span className="grad-text-vivid">AI SRE &amp; self-healing</span>
          <br />
          operations for Pterodactyl
        </h1>
        <p className="mx-auto mt-5 max-w-[700px] text-[1.06em] leading-[1.75] text-muted">
          PteroOps turns your panel into an AI-operable SRE platform: it observes consoles, detects applications,
          diagnoses crash loops, correlates incidents with changes and lets agents remediate, under policy, with
          approval, verification and rollback.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          {BADGES.map((b) => (
            <img key={b.alt} src={b.src} alt={b.alt} height={28} className="h-7" loading="lazy" />
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3.5">
          <Link to="/docs/getting-started" className="btn-primary">
            Get started
          </Link>
          <a
            href="https://github.com/PotenFYR-Studios/PteroOps-MCP"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
          >
            View on GitHub
          </a>
        </div>
      </section>

      <section className="mx-auto mt-12 max-w-[760px]">
        <Pre lang="bash">{INSTALL}</Pre>
      </section>

      <section className="mt-14 grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
        {STATS.map((s) => (
          <div key={s.label} className="stat-tile">
            <p className="font-mono text-[1.5em] font-bold text-white">{s.value}</p>
            <p className="mono-label mt-1">{s.label}</p>
          </div>
        ))}
      </section>

      <section className="mt-14 overflow-x-auto">
        <p className="mono-label mb-4">The loop</p>
        <div className="flex min-w-max items-center gap-2">
          {PIPELINE.map((step, i) => (
            <span key={step} className="flex items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-[0.82em] font-semibold text-ink2">
                {step}
              </span>
              {i < PIPELINE.length - 1 && <span className="text-faint">→</span>}
            </span>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <p className="mono-label mb-4">Why PteroOps</p>
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {WHY.map((w) => (
            <div key={w.n} className="glass-card">
              <div className="icon-tile font-mono text-[0.85em] font-bold text-link">{w.n}</div>
              <h2 className="mt-2 text-[1.02em] font-bold text-white">{w.title}</h2>
              <p className="text-[0.88em] leading-relaxed text-muted">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <p className="mono-label mb-4">Works with</p>
        <div className="table-scroll">
          <table className="spec-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Setup</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {COMPAT.map((c) => (
                <tr key={c.name}>
                  <td className="font-semibold text-ink">{c.name}</td>
                  <td>
                    <code className="inline">{c.setup}</code>
                  </td>
                  <td>{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-faint">
          Full recipes: <Link to="/docs/integrations" className="text-link hover:text-linkh">Integrations</Link>.
        </p>
      </section>

      <section className="mt-16">
        <div className="glass-card items-start p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[1.15em] font-bold text-white">Start with a real server in under five minutes</h2>
            <p className="mt-1 text-[0.9em] text-muted">
              The getting-started guide walks from API key to your first diagnosis conversation.
            </p>
          </div>
          <div className="mt-4 flex shrink-0 gap-3 sm:mt-0">
            <Link to="/docs/getting-started" className="btn-primary">
              Read the guide
            </Link>
            <Link to="/examples" className="btn-ghost">
              See examples
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
