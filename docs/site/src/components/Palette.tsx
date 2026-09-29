import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DOC_PAGES, getRendered, type TocEntry } from '../docs/content';

interface Item {
  label: string;
  sub: string;
  href: string;
}

export default function Palette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [tocBySlug, setTocBySlug] = useState<Record<string, TocEntry[]>>({});
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all(DOC_PAGES.map(async (p) => ({ slug: p.slug, rendered: await getRendered(p) }))).then(
      (results) => {
        if (cancelled) return;
        const next: Record<string, TocEntry[]> = {};
        for (const r of results) next[r.slug] = r.rendered.toc;
        setTocBySlug(next);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = DOC_PAGES.map((p) => ({
      label: p.title,
      sub: 'page',
      href: `/docs/${p.slug}`,
    }));
    for (const p of DOC_PAGES) {
      for (const entry of tocBySlug[p.slug] ?? []) {
        out.push({ label: entry.text, sub: p.title, href: `/docs/${p.slug}#${entry.id}` });
      }
    }
    return out;
  }, [tocBySlug]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 9);
    return items.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(q)).slice(0, 10);
  }, [items, query]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  if (!open) return null;

  const go = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    setQuery('');
    navigate(item.href);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[16vh]"
      style={{ background: 'rgba(11, 13, 20, 0.7)', backdropFilter: 'blur(6px)' }}
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Search documentation"
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-xl border border-white/10"
        style={{ background: '#151828', boxShadow: '0 24px 80px rgba(0, 0, 0, 0.6)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, filtered.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              go(filtered[selected]);
            }
          }}
          placeholder="Search pages and sections…"
          className="w-full border-b border-white/10 bg-transparent px-4 py-3.5 text-[0.95em] text-ink placeholder:text-faint focus:outline-none"
          aria-label="Search query"
        />
        <ul className="max-h-[46vh] overflow-y-auto py-2">
          {filtered.length === 0 && (
            <li className="px-4 py-3 text-sm text-faint">No matches for “{query}”.</li>
          )}
          {filtered.map((item, i) => (
            <li key={item.href}>
              <button
                type="button"
                onMouseEnter={() => setSelected(i)}
                onClick={() => go(item)}
                className={
                  'flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition ' +
                  (i === selected ? 'bg-accent/15 text-white' : 'text-ink2 hover:bg-white/5')
                }
              >
                <span className="truncate">{item.label}</span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                  {item.sub}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 text-[10px] text-faint">
          <span>
            <kbd className="border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono">↑↓</kbd> navigate{' '}
            <kbd className="border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono">{'\u21b5'}</kbd> open
          </span>
          <span>
            <kbd className="border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
