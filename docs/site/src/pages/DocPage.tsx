import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { DOC_CATEGORIES, DOC_PAGES, docBySlug, getRendered, type RenderedDoc, type TocEntry } from '../docs/content';

const GITHUB_BLOB = 'https://github.com/PotenFYR-Studios/PteroOps-MCP/blob/main';

export default function DocPage() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const page = slug ? docBySlug(slug) : undefined;
  const [rendered, setRendered] = useState<RenderedDoc | null>(null);
  const [activeId, setActiveId] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const articleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!page) return;
    let cancelled = false;
    setRendered(null);
    getRendered(page).then((r) => {
      if (!cancelled) setRendered(r);
    });
    return () => {
      cancelled = true;
    };
  }, [page]);

  useEffect(() => {
    const el = articleRef.current;
    if (!el || !rendered) return;

    const headings = el.querySelectorAll('h2[id], h3[id]');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: '-80px 0px -65% 0px' },
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [rendered]);

  useEffect(() => {
    if (!rendered || !location.hash) return;
    const id = location.hash.slice(1);
    const target = document.getElementById(id);
    if (target) target.scrollIntoView();
  }, [rendered, location.hash]);

  const index = useMemo(() => DOC_PAGES.findIndex((p) => p.slug === slug), [slug]);
  const prev = index > 0 ? DOC_PAGES[index - 1] : undefined;
  const next = index >= 0 && index < DOC_PAGES.length - 1 ? DOC_PAGES[index + 1] : undefined;

  if (!page) {
    return (
      <main className="mx-auto max-w-[820px] px-5 pb-20 pt-16 text-center">
        <h1 className="text-2xl font-bold text-white">Page not found</h1>
        <p className="mt-3 text-muted">
          That doc doesn’t exist —{' '}
          <Link to="/docs" className="text-link hover:text-linkh">
            back to the docs index
          </Link>
          .
        </p>
      </main>
    );
  }

  const toc = rendered?.toc ?? [];
  const groups = DOC_CATEGORIES.map((cat) => ({ cat, pages: DOC_PAGES.filter((p) => p.category === cat) })).filter(
    (g) => g.pages.length,
  );

  return (
    <main className="mx-auto max-w-[1400px] px-5 pb-20 pt-9 sm:px-7">
      <p className="mono-label mb-3">
        PteroOps docs · v0.1.0 ·{' '}
        <Link to="/docs" className="normal-case tracking-normal text-link hover:text-linkh">
          all docs
        </Link>
      </p>

      <div className="mt-6 grid gap-10 lg:grid-cols-[240px_minmax(0,1fr)_220px]">
        <aside className="hidden lg:block">
          <div className="sticky top-[84px] max-h-[calc(100vh-140px)] overflow-y-auto pr-2">
            {groups.map((g) => {
              const isOpen = !collapsed[g.cat];
              return (
                <div key={g.cat} className="mb-6">
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.cat]: isOpen }))}
                    aria-expanded={isOpen}
                    className="mb-2 flex w-full items-center justify-between text-[10px] font-bold uppercase tracking-[0.15em] text-faint transition hover:text-muted"
                  >
                    {g.cat}
                    <span aria-hidden className={'inline-block text-[9px] transition-transform ' + (isOpen ? '' : '-rotate-90')}>
                      ▾
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="space-y-0.5 border-l border-white/[0.05]">
                      {g.pages.map((p) => (
                        <li key={p.slug}>
                          <Link
                            to={`/docs/${p.slug}`}
                            className={
                              'block rounded-lg px-3 py-1.5 text-[13px] transition ' +
                              (p.slug === page.slug
                                ? 'bg-accent/15 text-white'
                                : 'text-muted hover:bg-white/5 hover:text-white')
                            }
                          >
                            {p.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <article className="min-w-0">
          <h1 className="text-[clamp(1.8em,3.4vw,2.4em)] font-extrabold leading-tight tracking-[-0.02em] text-white">
            {page.title}
          </h1>
          <p className="mt-2 max-w-[720px] text-[1em] leading-[1.7] text-muted">{page.summary}</p>
          <p className="mono-label mt-3">
            Source:{' '}
            <a
              href={`${GITHUB_BLOB}/${page.source}`}
              target="_blank"
              rel="noopener noreferrer"
              className="normal-case tracking-normal text-link hover:text-linkh"
            >
              {page.source}
            </a>
          </p>
          <hr className="my-7 border-white/[0.06]" />
          {rendered ? (
            <div ref={articleRef} className="md" dangerouslySetInnerHTML={{ __html: rendered.html }} />
          ) : (
            <p className="text-sm text-faint">Loading…</p>
          )}

          <nav className="mt-14 flex flex-col gap-3 border-t border-white/[0.06] pt-6 sm:flex-row sm:justify-between">
            {prev ? (
              <Link to={`/docs/${prev.slug}`} className="text-sm text-muted hover:text-link">
                ← {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link to={`/docs/${next.slug}`} className="text-sm text-muted hover:text-link sm:text-right">
                {next.title} →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </article>

        <aside className="hidden lg:block">
          <div className="sticky top-[84px] max-h-[calc(100vh-140px)] overflow-y-auto pl-1">
            {toc.length > 0 && (
              <>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-faint">On this page</p>
                <ul className="space-y-0.5 border-l border-white/[0.05]">
                  {toc.map((t: TocEntry) => (
                    <li key={t.id}>
                      <a
                        href={`#${t.id}`}
                        className={
                          'block rounded-lg px-3 py-1 text-[12.5px] transition ' +
                          (activeId === t.id
                            ? 'text-white'
                            : 'text-muted hover:bg-white/5 hover:text-white')
                        }
                      >
                        {t.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
