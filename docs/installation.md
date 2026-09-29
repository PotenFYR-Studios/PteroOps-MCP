# Installation

Every supported way to install and run PteroOps, with verification, updating, uninstalling and
deployment recipes. If you are new here, start with
[getting-started.md](getting-started.md) instead — this page is the reference.

## Choose your method

| Method | Best for | Needs | Jump to |
| --- | --- | --- | --- |
| Installer script (macOS/Linux) | normal use, always current | bash + curl/wget | [A](#a-installer-macos--linux) |
| Installer script (Windows) | normal use, always current | PowerShell | [A](#b-installer-windows) |
| npm / npx | Node users, CI, version pinning | Node 22+ | [B](#b-npm--npx) |
| Prebuilt release tarball | no build toolchain on the host | Node 22+ + npm | [C](#c-prebuilt-release-tarball) |
| Build from source | contributing, auditing | git + Node 22+ | [D](#d-build-from-source) |
| Docker | servers, homelabs, isolation | Docker | [E](#e-docker) |
| Docker Compose | compose-managed stacks | Docker + Compose | [E](#e-docker) |
| Kubernetes | clusters | kubectl | [F](#f-kubernetes) |
| systemd | bare-metal servers | root on that host | [G](#g-systemd) |
| Offline / air-gapped | no internet on the target | local copy | [H](#h-offline--air-gapped) |

All methods end in the same two modes — **stdio** (your AI app starts the process) or **HTTP**
(`/mcp`, `/ui`, `/health`, `/ready`, `/metrics`). Usage per client:
[integrations.md](integrations.md).

---

## A. Installer

The installer checks Node.js, installs the chosen build, puts a `pteroops` launcher on your PATH,
creates the data directory and prints the exact MCP config block for your AI app. Re-running it
is also the update command.

### a. macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.sh | bash
```

`wget` works too:

```bash
wget -qO- https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.sh | bash
```

**Install methods**

```bash
# build from git (default, always works)
curl -fsSL …/scripts/install.sh | bash

# prebuilt release tarball (no build step; pin a version)
curl -fsSL …/scripts/install.sh | PTEROOPS_METHOD=release PTEROOPS_VERSION=0.1.0 bash

# published npm package (fastest; pin a version)
curl -fsSL …/scripts/install.sh | PTEROOPS_METHOD=npm PTEROOPS_VERSION=0.1.0 bash
```

If you prefer flags over piping to bash, download first — the script also supports
`--method <source|release|npm>`:

```bash
curl -fsSLO https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.sh
less install.sh                 # saved as install.sh; read it first if you like
bash install.sh --method release
```

| Env var / flag | Default | Meaning |
| --- | --- | --- |
| `PTEROOPS_METHOD` / `--method` | `source` | `source` \| `release` \| `npm` |
| `PTEROOPS_PREFIX` | `$HOME/.pteroops` | Install root (`app` or `runtime`, plus `data`) |
| `PTEROOPS_BIN_DIR` | `$HOME/.local/bin` | Where the `pteroops` launcher goes |
| `PTEROOPS_VERSION` | latest | Version for `release`/`npm` methods |
| `PTEROOPS_REF` | `main` | Branch/tag for the `source` method |
| `PTEROOPS_SOURCE_DIR` | — | Install from a local checkout (offline) |
| `PTEROOPS_ARCHIVE_URL` | GitHub codeload | Override the source download URL |
| `PTEROOPS_RELEASE_TARBALL` | GitHub Releases | Override the release tarball URL/path |
| `PTEROOPS_NPM_REGISTRY` | npmjs.org | Alternate registry for `--method npm` |
| `PTEROOPS_INSTALL_NODE` | `0` | `1` installs Node via apt/dnf/brew when missing |
| `--no-path` | off | Don't touch shell rc files |

**Result:** app in `~/.pteroops/app` (source) or `~/.pteroops/runtime` (release/npm), data in
`~/.pteroops/data`, launcher `~/.local/bin/pteroops`.

### b. Installer (Windows)

```powershell
irm https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.ps1 | iex
```

With parameters (the two-step form avoids `iex` limitations):

```powershell
$installer = [scriptblock]::Create((irm https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.ps1))
& $installer                                        # build from source
& $installer -Method release -Version 0.1.0         # prebuilt release
& $installer -Method npm -Version 0.1.0             # npm registry
& $installer -InstallNode                           # install Node.js via winget if missing
& $installer -Ref v1.0.0 -Prefix D:\PteroOps        # pinned build, custom location
```

| Parameter | Default | Meaning |
| --- | --- | --- |
| `-Method` | `source` | `source` \| `release` \| `npm` |
| `-Version` | latest | Version for `release`/`npm` |
| `-Prefix` | `%LOCALAPPDATA%\PteroOps` | Install root |
| `-BinDir` | `<Prefix>\bin` | Launcher directory |
| `-Ref` | `main` | Branch/tag for `source` |
| `-SourceDir` / `-SourceZip` | — | Local checkout / zip (offline) |
| `-ReleaseTarball` | GitHub Releases | Override tarball URL/path |
| `-NpmRegistry` | npmjs.org | Alternate registry |
| `-InstallNode` | off | Install Node.js LTS via winget |
| `-NoPathUpdate` | off | Don't modify the user PATH |

**Result:** app in `%LOCALAPPDATA%\PteroOps\app` (source) or `…\runtime` (release/npm), data in
`%LOCALAPPDATA%\PteroOps\data`, launcher `…\bin\pteroops.cmd`. Open a **new terminal** after
installing so the PATH change applies.

---

## B. npm / npx

The package ships compiled `dist/` only — no build step, no native dependencies.

**Zero-install (npx)** — your MCP client runs it on demand:

```json
{
  "mcpServers": {
    "pteroops": {
      "command": "npx",
      "args": ["-y", "pteroops-mcp@latest"],
      "env": {
        "PTERO_PANEL_PROD_URL": "https://panel.example.com",
        "PTERO_PANEL_PROD_CLIENT_KEY": "ptlc_...",
        "PTERO_DEFAULT_PANEL": "prod",
        "PTERO_DATA_DIR": "~/.pteroops/data"
      }
    }
  }
}
```

`PTERO_DATA_DIR` keeps persistent state outside npx's cache (worth setting — otherwise each
npx version directory gets its own database).

**Global install** — a real `pteroops` command everywhere:

```bash
npm install -g pteroops-mcp
pteroops --version
pteroops --transport http          # then http://127.0.0.1:8080/ui
```

**Pinned / CI usage:**

```bash
npx -y pteroops-mcp@0.1.0 --version
npm install -g pteroops-mcp@0.1.0
```

**Direct from a GitHub release tarball** (also the basis of `--method release`):

```bash
npm install -g https://github.com/PotenFYR-Studios/PteroOps-MCP/releases/download/v0.1.0/pteroops-mcp-0.1.0.tgz
```

---

## C. Prebuilt release tarball

For hosts without a build toolchain, install the tarball attached to a GitHub release. The
installers wrap this:

```bash
# from a checkout (or downloaded script):
PTEROOPS_METHOD=release PTEROOPS_VERSION=0.1.0 bash scripts/install.sh
```

```powershell
& $installer -Method release -Version 0.1.0
```

Or do it manually into any prefix:

```bash
npm install --omit=dev --prefix /opt/pteroops \
  https://github.com/PotenFYR-Studios/PteroOps-MCP/releases/download/v0.1.0/pteroops-mcp-0.1.0.tgz
node /opt/pteroops/node_modules/pteroops-mcp/dist/index.js --version
```

Release tarballs are produced by [`.github/workflows/release.yml`](../.github/workflows/release.yml),
which runs every quality gate before attaching the tarball and (when an `NPM_TOKEN` secret is
configured) publishing to npm.

---

## D. Build from source

```bash
git clone https://github.com/PotenFYR-Studios/PteroOps-MCP.git
cd PteroOps-MCP
npm install
npm run build
node dist/index.js --help
```

Requirements: Node.js 22.13+ (24+ recommended). Plain `tsc` — no native toolchain, no
postinstall script. Running the quality gates locally:

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

---

## E. Docker

```bash
docker build -t pteroops .
docker run -d --name pteroops \
  -v pteroops-data:/app/data \
  -e PTERO_PANEL_PROD_URL=https://panel.example.com \
  -e PTERO_PANEL_PROD_CLIENT_KEY=ptlc_... \
  -e PTERO_PANEL_PROD_APPLICATION_KEY=ptla_... \
  -e PTERO_HTTP_TOKEN=$(openssl rand -hex 32) \
  -p 127.0.0.1:8080:8080 \
  pteroops --transport http
```

- Multi-stage build, runs as non-root, healthcheck on `/health`, secrets never baked in.
- Persistent state lives in the `pteroops-data` volume (`/app/data`).
- Endpoints: `/mcp` (bearer token), `/ui`, `/health`, `/ready`, `/metrics`.
- stdio mode in Docker: `docker run -i --rm -v pteroops-data:/app/data -e … pteroops --transport stdio`.

**Compose:**

```bash
# edit docker-compose.yml defaults (panel URL/keys/token) first
docker compose up -d
docker compose logs -f pteroops
```

---

## F. Kubernetes

```bash
kubectl create secret generic pteroops-secrets \
  --from-literal=PTERO_PANEL_PROD_URL=https://panel.example.com \
  --from-literal=PTERO_PANEL_PROD_CLIENT_KEY=ptlc_... \
  --from-literal=PTERO_HTTP_TOKEN="$(openssl rand -hex 32)"
kubectl apply -f deploy/k8s.yaml
kubectl rollout status deploy/pteroops
```

The manifest includes a PVC, readiness/liveness probes against `/ready` and `/health`, and
resource limits. **Multi-replica:** switch to PostgreSQL
(`PTERO_DATABASE_DRIVER=postgres`, `PTERO_DATABASE_URL=…`) and set `PTERO_REDIS_URL` so the
monitor loop and scheduler take distributed locks instead of running on every replica.

---

## G. systemd

```bash
sudo useradd --system --home /opt/pteroops --shell /usr/sbin/nologin pteroops
sudo install -d -o pteroops -g pteroops /opt/pteroops /var/lib/pteroops /etc/pteroops
sudo cp -r dist node_modules package.json /opt/pteroops/
sudo cp deploy/pteroops.service /etc/systemd/system/

sudo tee /etc/pteroops/pteroops.env >/dev/null <<'EOF'
PTERO_PANEL_PROD_URL=https://panel.example.com
PTERO_PANEL_PROD_CLIENT_KEY=ptlc_...
PTERO_HTTP_TOKEN=change-me
PTERO_DATA_DIR=/var/lib/pteroops
EOF
sudo chmod 600 /etc/pteroops/pteroops.env

sudo systemctl daemon-reload && sudo systemctl enable --now pteroops
systemctl status pteroops
curl -H "Authorization: Bearer change-me" http://127.0.0.1:8080/ready
```

---

## H. Offline / air-gapped

```bash
# on a machine with internet + a checkout:
git clone --depth 1 https://github.com/PotenFYR-Studios/PteroOps-MCP.git
tar -czf pteroops-src.tar.gz --exclude=.git --exclude=node_modules PteroOps-MCP

# on the target (no internet):
tar -xzf pteroops-src.tar.gz
PTEROOPS_SOURCE_DIR="$PWD/PteroOps-MCP" bash scripts/install.sh --no-path
```

```powershell
# Windows: zip the checkout first, then
& $installer -SourceZip C:\media\PteroOps-MCP.zip
& $installer -SourceDir D:\src\PteroOps-MCP
```

`npm install` still needs packages unless you vendor them: run `npm ci` once on a connected
machine, archive `node_modules` together with the source, or use
`PTEROOPS_METHOD=release` with `PTEROOPS_RELEASE_TARBALL=/media/pteroops-mcp-0.1.0.tgz` (the
tarball installs its dependencies from the npm cache/registry, so a prebuilt tarball plus
`npm install --offline` with a warm cache is the fully offline path).

---

## Verify the install

```bash
pteroops --version                      # prints the installed version
pteroops --help                         # CLI reference
PTERO_PANEL_PROD_URL=… PTERO_PANEL_PROD_CLIENT_KEY=… pteroops --transport stdio
```

The stdio start looks "stuck" — that is success: it is waiting for an MCP client. In your AI app,
`ptero_get_capabilities` shows the live panels, capabilities and registered tools.

HTTP mode verification:

```bash
pteroops --transport http &
curl http://127.0.0.1:8080/health
curl -H "Authorization: Bearer $PTERO_HTTP_TOKEN" http://127.0.0.1:8080/ready
curl -H "Authorization: Bearer $PTERO_HTTP_TOKEN" http://127.0.0.1:8080/metrics | head
```

## Updating

| Method | Update with |
| --- | --- |
| Installer | re-run the same one-liner (or `--method release PTEROOPS_VERSION=<new>`) |
| npm / npx | `npm install -g pteroops-mcp@latest` / `npx -y pteroops-mcp@latest` (or your pinned version) |
| Release tarball | install the newer tarball the same way |
| Source | `git pull && npm install && npm run build` |
| Docker | `docker pull …` + recreate, or rebuild and `docker compose up -d` |
| Kubernetes | update the image tag and `kubectl rollout restart deploy/pteroops` |

Updates never touch `data/` (SQLite, snapshots). Restart your MCP client / the process to pick up
the new build.

## Uninstalling

```bash
bash scripts/install.sh --uninstall            # removes app/runtime + launcher, keeps data
bash scripts/install.sh --uninstall --purge    # removes data too
```

```powershell
& $installer -Uninstall
& $installer -Uninstall -Purge
```

If you do not have a checkout, re-run the installer with the flag:
`curl -fsSL …/scripts/install.sh | bash -s -- --uninstall [--purge]` (macOS/Linux) or the
`$installer` snippet above (Windows).

| Method | Uninstall with |
| --- | --- |
| npm / npx | `npm uninstall -g pteroops-mcp` (npx leaves only its cache) |
| Docker | `docker rm -f pteroops && docker volume rm pteroops-data` |
| Kubernetes | `kubectl delete -f deploy/k8s.yaml && kubectl delete secret pteroops-secrets` |
| systemd | `systemctl disable --now pteroops`, remove `/opt/pteroops`, `/var/lib/pteroops`, `/etc/pteroops` |

Finish by removing the `pteroops` entry from your AI app's MCP config and deleting the API key in
your panel (Account → API Credentials).

## Remote access (TLS reverse proxy)

`--transport http` enforces `Authorization: Bearer <PTERO_HTTP_TOKEN>` on non-loopback binds, but
it speaks plain HTTP — put TLS in front:

- nginx: [`deploy/nginx.conf.example`](../deploy/nginx.conf.example) (SSE-safe buffering off for `/mcp`)
- Caddy: [`deploy/Caddyfile.example`](../deploy/Caddyfile.example) (automatic certificates)

Then point clients at `https://your-host/mcp` with the bearer token; the console is at `/ui`
(append `?token=…` once). See [integrations.md](integrations.md) for each client's syntax.

## Security notes

- Piping a remote script into a shell deserves suspicion — read it first:
  `curl -fsSL …/scripts/install.sh | less`. Both scripts are short, use no `sudo` unless you opt in with
  `PTEROOPS_INSTALL_NODE=1`/`-InstallNode`, and only write inside your prefix/bin directories plus
  a clearly marked PATH line they remove on uninstall.
- API keys are never written by any installer; supply them via your MCP client's `env` block or a
  config file. PteroOps redacts them from everything it emits.
- Prefer the manual/source method if your policy forbids remote scripts; prefer loopback +
  reverse proxy over exposing the port directly.
