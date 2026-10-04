const PRINCIPLES = [
  {
    title: 'Evidence before action',
    body: 'Every recommendation carries the facts behind it, process events, log patterns, diffs, health probes, or says what evidence is missing. Guessing is reported as guessing.',
  },
  {
    title: 'Diff before write',
    body: 'File changes are hash-guarded, snapshot first, dry-run against the previous content, and re-read to verify. A write that cannot be verified is a failed write.',
  },
  {
    title: 'Diagnose before restart',
    body: 'Restarts are remediation, not troubleshooting. PteroOps refuses tool shapes that encourage restart-first operation; incidents must be explainable first.',
  },
  {
    title: 'Nothing fake ships',
    body: 'No stubs, no mock implementations in src, no fabricated confidence. Detectors cap confidence honestly and unfinished capabilities are labeled PLANNED.',
  },
  {
    title: 'Policy is the gate',
    body: 'Capability check, policy and risk rating, audit record, change ledger, every mutating action walks the same path, including approvals and rollback arming.',
  },
  {
    title: 'Secrets never leak',
    body: 'One redaction engine covers logs, errors, MCP payloads, audit events, console captures and incidents, with a dedicated test corpus for secret-bearing fields.',
  },
];

export default function About() {
  return (
    <main className="mx-auto max-w-[1100px] px-5 pb-20 pt-9 sm:px-7">
      <p className="mono-label mb-3">About</p>
      <h1 className="text-[clamp(1.9em,3.6vw,2.6em)] font-extrabold leading-tight tracking-[-0.02em]">
        <span className="grad-text">Operations software that shows its work</span>
      </h1>
      <p className="mt-3 max-w-[760px] text-[1.04em] leading-[1.75] text-muted">
        PteroOps is an open-source MCP server by PotenFYR Studios. It gives any MCP-capable AI agent real operational
        context for Pterodactyl, consoles, applications, changes, health and incidents, and a policy-controlled path
        to act on it: <span className="text-ink2">Observe → Detect → Correlate → Diagnose → Explain → Propose → Approve → Remediate → Verify → Roll back → Learn</span>.
      </p>

      <section className="mt-12">
        <p className="mono-label mb-4">Principles</p>
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div key={p.title} className="glass-card">
              <h2 className="text-[1.02em] font-bold text-white">{p.title}</h2>
              <p className="text-[0.88em] leading-relaxed text-muted">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14 grid gap-4 md:grid-cols-3">
        <div className="glass-card">
          <p className="mono-label">Organization</p>
          <h2 className="text-[1.05em] font-bold text-white">PotenFYR Studios</h2>
          <p className="text-[0.88em] leading-relaxed text-muted">
            We build open tooling for infrastructure and community platforms. PteroOps is the operations counterpart to
            our other projects.
          </p>
          <a
            href="https://potenfyr.in"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 text-sm text-link hover:text-linkh"
          >
            potenfyr.in →
          </a>
        </div>
        <div className="glass-card">
          <p className="mono-label">Source</p>
          <h2 className="text-[1.05em] font-bold text-white">GitHub</h2>
          <p className="text-[0.88em] leading-relaxed text-muted">
            Issues, discussions and pull requests are welcome. Contributions follow the documented quality gates and
            evidence discipline.
          </p>
          <a
            href="https://github.com/PotenFYR-Studios/PteroOps-MCP"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 text-sm text-link hover:text-linkh"
          >
            github.com/PotenFYR-Studios/PteroOps-MCP →
          </a>
        </div>
        <div className="glass-card">
          <p className="mono-label">Community</p>
          <h2 className="text-[1.05em] font-bold text-white">Discord</h2>
          <p className="text-[0.88em] leading-relaxed text-muted">
            Questions, deployment help and design discussion. Ask before inventing behavior, that rule is in the
            agent guide too.
          </p>
          <a
            href="https://discord.com/invite/zUaN2FPBec"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 text-sm text-link hover:text-linkh"
          >
            Join the Discord →
          </a>
        </div>
      </section>

      <p className="mt-12 text-[13px] text-faint">
        PteroOps is an independent project. It is not affiliated with, endorsed by, or supported by Pterodactyl or
        its maintainers. “Pterodactyl” is used only to describe compatibility.
      </p>
    </main>
  );
}
