import { useEffect, useState } from 'react';
import { DOC_PAGES, getRendered, type RenderedDoc } from '../docs/content';

const PHASES = [
  { phase: 'A', name: 'Foundation & Pterodactyl access' },
  { phase: 'B', name: 'Console subsystem' },
  { phase: 'C', name: 'Incidents, changes, audit' },
  { phase: 'D', name: 'Detection, profiles, log & dependency intelligence' },
  { phase: 'E', name: 'Health, crash-loop, diagnosis (vertical slice)' },
  { phase: 'F', name: 'Remediation, approvals, policy, rollback' },
  { phase: 'G', name: 'Git, network, topology, correlation' },
  { phase: 'H', name: 'Baselines, forecasting, known-good, scheduler' },
  { phase: 'I', name: 'Drift, blast radius, simulator, canary, effectiveness' },
];

const TILES = [
  { value: '9/9', label: 'phases delivered' },
  { value: '63', label: 'MCP tools' },
  { value: '270', label: 'tests on SQLite' },
  { value: '273', label: 'tests with PG + Redis' },
];

export default function Status() {
  const page = DOC_PAGES.find((p) => p.slug === 'status');
  const [rendered, setRendered] = useState<RenderedDoc | null>(null);

  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    getRendered(page).then((r) => {
      if (!cancelled) setRendered(r);
    });
    return () => {
      cancelled = true;
    };
  }, [page]);

  return (
    <main className="mx-auto max-w-[1100px] px-5 pb-20 pt-9 sm:px-7">
      <p className="mono-label mb-3">Living tracker · straight from docs/status.md</p>
      <h1 className="text-[clamp(1.9em,3.6vw,2.6em)] font-extrabold leading-tight tracking-[-0.02em]">
        <span className="grad-text">Project status</span>
      </h1>
      <p className="mt-3 max-w-[720px] text-[1.04em] leading-[1.75] text-muted">
        What actually exists today — tracked per phase and module, verified by the test suite. If it is not real, it is
        labeled PLANNED and it does not ship.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {TILES.map((t) => (
          <div key={t.label} className="stat-tile">
            <p className="font-mono text-[1.5em] font-bold text-white">{t.value}</p>
            <p className="mono-label mt-1">{t.label}</p>
          </div>
        ))}
      </div>

      <section className="mt-12">
        <p className="mono-label mb-4">Phases</p>
        <div className="table-scroll">
          <table className="spec-table">
            <thead>
              <tr>
                <th>Phase</th>
                <th>Scope</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {PHASES.map((p) => (
                <tr key={p.phase}>
                  <td className="font-mono font-bold text-link">{p.phase}</td>
                  <td className="text-ink2">{p.name}</td>
                  <td>
                    <span className="rounded-full border border-[#2ea043]/40 bg-[#2ea043]/10 px-2.5 py-0.5 font-mono text-[11px] font-bold text-[#2ea043]">
                      DONE
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-14 border-t border-white/[0.06] pt-10">
        <p className="mono-label mb-4">Full status document</p>
        {rendered ? (
          <div className="md" dangerouslySetInnerHTML={{ __html: rendered.html }} />
        ) : (
          <p className="text-sm text-faint">Loading…</p>
        )}
      </section>

      <p className="mt-12 text-[13px] text-faint">
        This page renders <code className="inline">docs/status.md</code> from the repository —{' '}
        <a
          href="https://github.com/PotenFYR-Studios/PteroOps-MCP/blob/main/docs/status.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-link hover:text-linkh"
        >
          view it on GitHub
        </a>
        . CI runs the same gates on every change:{' '}
        <a
          href="https://github.com/PotenFYR-Studios/PteroOps-MCP/blob/main/CONTRIBUTING.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-link hover:text-linkh"
        >
          lint, typecheck, tests, build
        </a>
        .
      </p>
    </main>
  );
}
