import { Link } from 'react-router-dom';
import { DOC_CATEGORIES, DOC_PAGES } from '../docs/content';

export default function DocsIndex() {
  return (
    <main className="mx-auto max-w-[1100px] px-5 pb-20 pt-9 sm:px-7">
      <p className="mono-label mb-3">PteroOps docs</p>
      <h1 className="text-[clamp(1.9em,3.6vw,2.6em)] font-extrabold leading-tight tracking-[-0.02em]">
        <span className="grad-text">Documentation</span>
      </h1>
      <p className="mt-3 max-w-[720px] text-[1.04em] leading-[1.75] text-muted">
        Everything PteroOps can do, how to install and configure it, and how agents should operate it. Press{' '}
        <kbd className="border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-muted">
          Ctrl K
        </kbd>{' '}
        to jump anywhere.
      </p>

      {DOC_CATEGORIES.filter((c) => c !== 'Status').map((cat) => (
        <section key={cat} className="mt-12">
          <p className="mono-label mb-4">{cat}</p>
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {DOC_PAGES.filter((p) => p.category === cat).map((p) => (
              <Link key={p.slug} to={`/docs/${p.slug}`} className="glass-card">
                <h2 className="text-[1.02em] font-bold text-white">{p.title}</h2>
                <p className="text-[0.88em] leading-relaxed text-muted">{p.summary}</p>
                <p className="mono-label mt-2">{p.source}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <p className="mt-12 text-[13px] text-faint">
        These pages render the repository markdown from <code className="inline">docs/</code> — the same
        files GitHub and your AI tool read. Live status:{' '}
        <Link to="/status" className="text-link hover:text-linkh">
          project status
        </Link>
        .
      </p>
    </main>
  );
}
