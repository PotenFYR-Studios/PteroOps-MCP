import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import SeoManager from './SeoManager';
import Palette from './components/Palette';

const NAV = [
  { to: '/', label: 'Home' },
  { to: '/docs', label: 'Docs' },
  { to: '/examples', label: 'Examples' },
  { to: '/status', label: 'Status' },
  { to: '/about', label: 'About' },
];

const RIGHT_LINKS = [
  { href: 'https://potenfyr.in', label: 'Website' },
  { href: 'https://discord.com/invite/zUaN2FPBec', label: 'Discord' },
  { href: 'https://github.com/PotenFYR-Studios/PteroOps-MCP', label: 'GitHub' },
];

const FOOTER_COLS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: 'Docs',
    links: [
      { label: 'Getting started', href: '/docs/getting-started' },
      { label: 'Installation', href: '/docs/installation' },
      { label: 'Configuration', href: '/docs/configuration' },
      { label: 'MCP reference', href: '/docs/mcp-reference' },
    ],
  },
  {
    title: 'Operate',
    links: [
      { label: 'Agent guide', href: '/docs/agent-guide' },
      { label: 'Capability map', href: '/docs/capability-map' },
      { label: 'Monitoring', href: '/docs/monitoring' },
      { label: 'Integrations', href: '/docs/integrations' },
    ],
  },
  {
    title: 'Project',
    links: [
      { label: 'Status', href: '/status' },
      { label: 'Examples', href: '/examples' },
      { label: 'License', href: '/license' },
      { label: 'GitHub', href: 'https://github.com/PotenFYR-Studios/PteroOps-MCP', external: true },
    ],
  },
];

export default function App() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest('.copy-btn');
      if (!btn) return;
      const code = btn.closest('pre')?.querySelector('code');
      if (!code) return;
      navigator.clipboard.writeText(code.textContent ?? '').then(() => {
        btn.textContent = 'Copied';
        btn.classList.add('ok');
        setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('ok');
        }, 1400);
      });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  return (
    <div className="relative min-h-screen">
      <SeoManager />
      <Palette />

      {/* 56px sticky blur navbar (SPEC 5.1) */}
      <header
        className="sticky top-0 z-50 flex h-14 items-center gap-3.5 border-b border-white/[0.08] px-5"
        style={{ background: 'rgba(11, 13, 20, 0.72)', backdropFilter: 'blur(14px) saturate(1.4)' }}
      >
        <Link to="/" className="flex shrink-0 items-center gap-2.5 font-semibold text-white" style={{ fontSize: '0.95em' }}>
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-6 w-6" style={{ filter: 'drop-shadow(0 0 8px rgba(139, 92, 246, 0.5))' }} />
          <span>
            pteroops<span className="brand-dot">.</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                'rounded-[7px] px-2.5 py-[5px] text-[0.84em] font-medium transition ' +
                (isActive ? 'text-white' : 'text-muted hover:bg-white/5 hover:text-white')
              }
              style={({ isActive }) =>
                isActive
                  ? { background: 'rgba(139, 92, 246, 0.18)', boxShadow: 'inset 0 0 0 1px rgba(139, 92, 246, 0.45)' }
                  : undefined
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-4 md:flex">
          {RIGHT_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted transition hover:text-link"
              aria-label={`${l.label} (opens in a new tab)`}
            >
              {l.label}
            </a>
          ))}
        </div>

        <button
          className="ml-auto rounded-lg border border-white/10 p-2 md:hidden"
          onClick={() => setOpen(!open)}
          aria-label="Toggle navigation menu"
          aria-expanded={open}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {open ? <path d="M6 6l12 12M6 18L18 6" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </header>

      {open && (
        <div
          className="fixed inset-x-0 top-14 z-40 border-b border-white/10 px-6 py-4 md:hidden"
          style={{ background: 'rgba(11, 13, 20, 0.98)' }}
        >
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className="block rounded-lg px-3 py-2.5 text-ink2 hover:bg-white/5">
              {n.label}
            </Link>
          ))}
          <div className="mt-2 flex gap-4 border-t border-white/10 pt-3">
            {RIGHT_LINKS.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="text-xs text-muted">
                {l.label}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="relative z-[1]">
        <Outlet />
      </div>

      {/* full-bleed 3-zone footer (SPEC 5.2) */}
      <footer className="relative z-[1] border-t border-white/[0.08]" style={{ background: 'rgba(14, 17, 29, 0.6)' }}>
        <div className="mx-auto max-w-[1280px] px-6 py-10">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-start">
            <div>
              <Link to="/" className="flex items-center gap-2.5 font-semibold text-white">
                <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-5 w-5" />
                <span>
                  pteroops<span className="brand-dot">.</span>
                </span>
              </Link>
              <p className="mt-3 max-w-[300px] text-[13px] leading-relaxed text-muted">
                AI SRE &amp; self-healing operations for Pterodactyl. Observation before action, evidence before
                restart, diff before write.
              </p>
              <p className="mono-label mt-4">by PotenFYR Studios</p>
            </div>
            <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 md:gap-14">
              {FOOTER_COLS.map((col) => (
                <div key={col.title}>
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-faint">{col.title}</p>
                  <ul className="space-y-1.5">
                    {col.links.map((l) => (
                      <li key={l.label}>
                        {l.external ? (
                          <a
                            href={l.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[13px] text-muted transition hover:text-link"
                          >
                            {l.label}
                          </a>
                        ) : (
                          <Link to={l.href} className="text-[13px] text-muted transition hover:text-link">
                            {l.label}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-10 flex flex-col gap-2 border-t border-white/[0.06] pt-5 text-xs text-faint sm:flex-row sm:items-center sm:justify-between">
            <p>© {new Date().getFullYear()} PotenFYR Studios · MIT licensed</p>
            <p>
              PteroOps is an independent project, not affiliated with or endorsed by Pterodactyl.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
