export default function License() {
  return (
    <main className="mx-auto max-w-[860px] px-5 pb-20 pt-9 sm:px-7">
      <p className="mono-label mb-3">License</p>
      <h1 className="text-[clamp(1.9em,3.6vw,2.6em)] font-extrabold leading-tight tracking-[-0.02em]">
        <span className="grad-text">MIT</span>
      </h1>
      <p className="mt-3 max-w-[700px] text-[1.04em] leading-[1.75] text-muted">
        PteroOps is released under the MIT License. Use it, fork it, embed it, ship it commercially, keep the
        copyright notice and the permission notice with substantial portions of the software.
      </p>

      <section className="glass-card mt-10">
        <h2 className="text-[1.05em] font-bold text-white">In short</h2>
        <ul className="mt-2 space-y-1.5 text-[0.92em] text-ink2">
          <li>Commercial use, modification and distribution are allowed.</li>
          <li>Liability and warranty are disclaimed, operations tooling runs at your own risk, under your policy.</li>
          <li>The full, controlling text is in the repository LICENSE file.</li>
        </ul>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href="https://github.com/PotenFYR-Studios/PteroOps-MCP/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            Read LICENSE
          </a>
          <a
            href="https://github.com/PotenFYR-Studios/PteroOps-MCP"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost"
          >
            Source
          </a>
        </div>
      </section>

      <p className="mt-10 text-[13px] text-faint">
        Pterodactyl® is a trademark of its owners; this project only interoperates with its API. Access to a
        Pterodactyl panel means infrastructure-admin access, read{' '}
        <a
          href="https://github.com/PotenFYR-Studios/PteroOps-MCP/blob/main/SECURITY.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-link hover:text-linkh"
        >
          SECURITY.md
        </a>{' '}
        before deploying.
      </p>
    </main>
  );
}
