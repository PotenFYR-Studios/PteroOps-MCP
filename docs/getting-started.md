# Getting Started with PteroOps (Complete Beginner's Guide)

**Never used an MCP server? Never touched a terminal? This page is for you.** Follow it top to
bottom and you will have PteroOps answering questions about your Pterodactyl servers in about
15 minutes. Every command is copy-paste ready.

> Short version for experienced users: [`README.md`](../README.md) → Quick start.

---

## Table of contents

1. [What is PteroOps? (in plain English)](#1-what-is-pteroops-in-plain-english)
2. [What you need before you start](#2-what-you-need-before-you-start)
3. [Step 1. Get your Pterodactyl API key](#step-1--get-your-pterodactyl-api-key)
4. [Step 2. Install Node.js](#step-2--install-nodejs)
5. [Step 3. Install PteroOps](#step-3--install-pteroops)
6. [Step 4. Test that it works](#step-4--test-that-it-works)
7. [Step 5. Connect it to your AI app](#step-5--connect-it-to-your-ai-app)
8. [Step 6. Your first conversations](#step-6--your-first-conversations)
9. [Understanding what PteroOps tells you](#understanding-what-pteroops-tells-you)
10. [Safety: what can it actually change?](#safety-what-can-it-actually-change)
11. [Docker (optional)](#docker-optional)
12. [Troubleshooting](#troubleshooting)
13. [FAQ](#faq)

---

## 1. What is PteroOps? (in plain English)

Pterodactyl is a game-server control panel: it starts and stops servers and shows you "running".
**PteroOps is a helper that lets an AI assistant (Claude, Cursor, …) actually understand those
servers.**

Without PteroOps, an AI sees: *"server is running"*. With PteroOps, the AI sees:

> "Paper 1.21.4, 41 plugins, memory at 93% of its limit, an `OutOfMemoryError` crashed the
> server 4 times in the last 15 minutes, and `EssentialsX.jar` was replaced 4 minutes before the
> first crash. Here is the evidence, my confidence is 0.84, and here is a fix with a rollback
> plan."

You ask questions in normal language ("why does the survival server keep restarting?") and
PteroOps gives the AI the facts it needs to answer properly, logs, resources, changes, crash
history, instead of the AI guessing.

**Three things PteroOps will do for you:**

| You say | PteroOps does |
| --- | --- |
| "Something is wrong, figure it out" | Investigates (read-only): logs, health, crash history, recent changes |
| "What changed before it broke?" | Searches the change ledger for the minutes before the first error |
| "Fix it" | Proposes a fix with risk + rollback, asks for your approval, applies it, verifies health, rolls back automatically if it gets worse |

---

## 2. What you need before you start

| Requirement | Why | Where to get it |
| --- | --- | --- |
| A **Pterodactyl panel** (v1.x, e.g. `panel.yourhost.com`) | That's what PteroOps manages | You already have this |
| Either **panel-admin access** or a normal **panel account** | To create an API key | Next step |
| **Node.js 22 or newer** | PteroOps runs on it | [nodejs.org](https://nodejs.org), download the LTS installer |
| An **AI app** that supports MCP | It talks to PteroOps | Claude Desktop, Claude Code, Cursor, VS Code Copilot, or any MCP client |
| 5–10 minutes | — | ☕ |

You do **not** need: SSH access, database access, a domain, Docker, or any programming
knowledge.

---

## Step 1. Get your Pterodactyl API key

PteroOps talks to Pterodactyl through an **API key**. There are two kinds and you can use either
or both. Here is how to pick:

| Key | Looks like | Who can create it | What it can see/do |
| --- | --- | --- | --- |
| **Client key** | `ptlc_...` | Anyone with a panel account | Only the servers that account can access. Can read logs/files, start/stop, send commands. |
| **Application key** | `ptla_...` | Panel **administrators** only | All servers, nodes, users, eggs. |

**Recommendation:** start with a **client key** (it is safe and enough for 90% of features).
Add an application key later if you want the admin tools (nodes, all servers, users).

### If you are creating a Client key (most people)

1. Log in to your panel, e.g. `https://panel.yourhost.com`.
2. Click your **username/avatar**, top-right → **Account**.
3. Open the **API Credentials** tab.
4. Click **Create API Key**.
5. **Description:** `PteroOps` (so you remember what it's for later).
6. **Allowed IPs:** leave **empty** (or add your computer's IP if your host requires it).
7. Click **Create**. **Copy the key right now**, the panel only shows it once. It starts with
   `ptlc_`.
8. If you have multiple servers on one account, that's fine, the key can see all of them.

### If you are creating an Application key (panel admins)

1. Open the **Admin** area of the panel (often `https://panel.yourhost.com/admin`).
2. Go to **Application API** in the sidebar.
3. Click **Create New Key**.
4. Description: `PteroOps`. Permissions: tick the **read** boxes and the specific write boxes
   you want PteroOps to be allowed to use. If unsure, start with **read-only**. PteroOps will
   automatically hide every tool it cannot use.
5. Click **Create**. **Copy the key now** (starts with `ptla_`).

> **Keep these keys private.** They are as powerful as a login. If you ever paste one somewhere
> public, delete it in the same panel page and create a new one.

---

## Step 2. Install PteroOps (one command)

You do **not** need to install Node.js by hand, the installer checks it for you and tells you
exactly what to do if it is missing (or installs it for you when asked).

**macOS / Linux**, open a terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.sh | bash
```

**Windows**, open PowerShell (press `Win`, type `PowerShell`, press Enter) and paste:

```powershell
irm https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.ps1 | iex
```

The installer downloads PteroOps, builds it, puts a `pteroops` command on your PATH and prints
the exact config block for Step 5. It takes about a minute. If Node.js is missing it points you
at [nodejs.org](https://nodejs.org); advanced users can pass `PTEROOPS_INSTALL_NODE=1`
(`-InstallNode` on Windows) to install it automatically.

Where things live after installing:

| Platform | Command | App path (for Step 5) | Data (history, incidents) |
| --- | --- | --- | --- |
| macOS / Linux | `pteroops` | `~/.pteroops/app/dist/index.js` | `~/.pteroops/data` |
| Windows | `pteroops` | `%LOCALAPPDATA%\PteroOps\app\dist\index.js` | `%LOCALAPPDATA%\PteroOps\data` |

<details>
<summary><strong>Prefer to install manually or read the script first?</strong> (click to expand)</summary>

Read the installer before running it:

```bash
curl -fsSL https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.sh | less
```

Or do it by hand, install [Node.js 22+](https://nodejs.org) first (`node --version` should say
`v22.x` or higher), then:

```bash
git clone https://github.com/PotenFYR-Studios/PteroOps-MCP.git
cd PteroOps-MCP
npm install
npm run build
```

No `git`? Download the ZIP from the repository page, unzip it, then run `npm install` and
`npm run build` in that folder. Remember the full path. Step 5 needs it.

Full options (flags, offline installs, Docker, uninstall): [installation.md](installation.md).

</details>

### Optional: keep your keys in a config file

PteroOps can read settings from a file instead of the environment. If you like that:

```bash
# Linux/macOS  (Windows: use the config example inside %LOCALAPPDATA%\PteroOps\app)
cp ~/.pteroops/app/pteroops.config.example.yaml ~/.pteroops/pteroops.config.yaml
```

Open it in any text editor, put your panel URL + key in, and point PteroOps at it with
`PTEROOPS_CONFIG=~/.pteroops/pteroops.config.yaml`. The environment variables in Step 5 work just
as well, pick whichever you prefer.

---

## Step 4. Test that it works

Before wiring up an AI, make sure PteroOps itself is happy. Replace the values below with your
own panel URL and key, then run the whole block:

**Linux / macOS:**
```bash
PTERO_PANEL_MY_URL=https://panel.yourhost.com \
PTERO_PANEL_MY_CLIENT_KEY=ptlc_your_key_here \
PTERO_DEFAULT_PANEL=my \
pteroops --transport stdio
```

**Windows PowerShell:**
```powershell
$env:PTERO_PANEL_MY_URL = "https://panel.yourhost.com"
$env:PTERO_PANEL_MY_CLIENT_KEY = "ptlc_your_key_here"
$env:PTERO_DEFAULT_PANEL = "my"
pteroops --transport stdio
```

(`pteroops` is the launcher the installer added. If your shell doesn't know it yet, open a new
terminal, or run `node ~/.pteroops/app/dist/index.js --transport stdio` directly.)

**What should happen:** the terminal looks "stuck", that's correct! PteroOps is now waiting for
an AI client to talk to it over stdin/stdout. Press `Ctrl+C` to stop it. No error messages = it
works.

Two common problems to check now:

| Symptom right after starting | Cause | Fix |
| --- | --- | --- |
| Nothing at all, cursor just sits there | **Success**, it is waiting for an MCP client | Continue to Step 5 |
| `ConfigError: No panels configured` | The env vars aren't set in the same terminal/session | Set them again, then re-run |
| `Cannot find module '.../dist/index.js'` | Manual install without a build (or wrong folder) | Run `npm run build` in the PteroOps folder, or re-run the installer |

---

## Step 5. Connect it to your AI app

Pick your app below. This is the last setup step.

### Claude Desktop

1. Open **Claude Desktop** → menu → **Settings…** → **Developer** → **Edit Config**.
   (That opens a file called `claude_desktop_config.json`.)
2. Replace its contents with this (fill in your URL and key):

```json
{
  "mcpServers": {
    "pteroops": {
      "command": "node",
      "args": ["C:\\Users\\YOU\\AppData\\Local\\PteroOps\\app\\dist\\index.js"],
      "env": {
        "PTERO_PANEL_MY_URL": "https://panel.yourhost.com",
        "PTERO_PANEL_MY_CLIENT_KEY": "ptlc_your_key_here",
        "PTERO_DEFAULT_PANEL": "my"
      }
    }
  }
}
```

3. Save the file and **fully quit Claude** (right-click the tray icon → Quit), then reopen it.
4. You should see a small plug/🔧 icon in Claude's input box showing **pteroops** with 60+ tools.

**Windows path tip:** use double backslashes and the installed location the installer printed,
e.g. `C:\\Users\\you\\AppData\\Local\\PteroOps\\app\\dist\\index.js`.
**macOS/Linux path:** `~/.pteroops/app/dist/index.js`, expand `~` to your home directory, e.g.
`/home/you/.pteroops/app/dist/index.js`.

### Claude Code (terminal)

```bash
claude mcp add pteroops \
  --env PTERO_PANEL_MY_URL=https://panel.yourhost.com \
  --env PTERO_PANEL_MY_CLIENT_KEY=ptlc_your_key_here \
  -- node ~/.pteroops/app/dist/index.js
```

Then run `claude` and type `/mcp`, you should see `pteroops` connected.

### Cursor

Create (or edit) the file `.cursor/mcp.json` in your project **or** use
Settings → MCP → Add new MCP server:

```json
{
  "mcpServers": {
    "pteroops": {
      "command": "node",
      "args": ["/home/you/.pteroops/app/dist/index.js"],
      "env": {
        "PTERO_PANEL_MY_URL": "https://panel.yourhost.com",
        "PTERO_PANEL_MY_CLIENT_KEY": "ptlc_your_key_here",
        "PTERO_DEFAULT_PANEL": "my"
      }
    }
  }
}
```

### VS Code (GitHub Copilot Chat)

Create `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "pteroops": {
      "type": "stdio",
      "command": "node",
      "args": ["/home/you/.pteroops/app/dist/index.js"],
      "env": {
        "PTERO_PANEL_MY_URL": "https://panel.yourhost.com",
        "PTERO_PANEL_MY_CLIENT_KEY": "ptlc_your_key_here",
        "PTERO_DEFAULT_PANEL": "my"
      }
    }
  }
}
```

### Anything else (n8n, custom agents, your own code)

PteroOps also speaks **Streamable HTTP** for remote/automation use, see
[`docs/integrations.md`](integrations.md) for HTTP and Docker setups and per-language snippets.

---

## Step 6. Your first conversations

Open your AI app and paste these one at a time. They are ordered from "definitely safe" to
"starts doing things", so you can build confidence.

**1. See what it can do (always safe):**
> Use pteroops to call ptero_get_capabilities and tell me what it can do with my panel.

**2. List your servers:**
> List my Pterodactyl servers and tell me each one's current state and what kind of application
> is running on it.

**3. Health check everything:**
> Check the health of all my servers. For anything that is not healthy, explain why with the
> evidence, and do NOT restart anything.

**4. Investigate the classic crash loop:**
> My survival server keeps restarting. Find out why without restarting it. Show me the errors,
> when they started, and whether anything changed right before they began.

**5. Ask the "what changed" question:**
> Use the change history to tell me everything that was changed on the survival server in the
> last 24 hours, and whether any of those changes happened right before an error.

Once you are comfortable, you can try a fix, read
[Safety](#safety-what-can-it-actually-change) first:

> You found that the EssentialsX update caused the crashes. Propose a fix with a rollback plan
> and show me the exact steps before changing anything.

The AI will call `ptero_propose_remediation`, show you a plan with risk and rollback, and ask
for your approval before anything happens.

---

## Understanding what PteroOps tells you

### Health statuses (from `ptero_get_health`)

| Status | Meaning |
| --- | --- |
| `healthy` | Running and everything checks out |
| `degraded` | Running, but something is off (high errors, memory pressure, restarts) |
| `unhealthy` | Offline, or failing checks (disk/memory near limits, no readiness) |
| `crash_loop` | Restarting over and over, the #1 reason people install PteroOps |
| `starting` | Starting up; not a problem unless it stays here |
| `unknown` | Not enough data yet (e.g. monitoring just started) |

### Words the AI will use

| Word | What it means for you |
| --- | --- |
| **Observed fact** | Directly measured, it really happened |
| **Inferred cause** | A conclusion computed from facts (e.g. OOM + memory at 97% ⇒ out of memory) |
| **Hypothesis** | A plausible explanation that still needs evidence, the AI should say so |
| **Confidence 0–1** | How strongly the evidence supports it. Below ~0.5, treat it as a question, not a fact |
| **Fingerprint** | A unique ID for an error pattern; identical errors count as one issue with a counter |
| **Missing evidence** | What could not be seen, this is a feature, not a bug (no guessing allowed) |
| **Change ledger** | The list of every change PteroOps made or observed, with before/after hashes |

If the AI ever states a fix worked because "the API said 200", push back. PteroOps treats
success as *the application becoming healthy and staying healthy*.

---

## Safety: what can it actually change?

Out of the box:

- **Reading is always allowed** (status, logs, files, health, dependencies, databases…).
- **Changing requires care.** Every mutating action is risk-classified:
  - `LOW` (e.g. start server, create backup), can be allowed automatically per your config.
  - `MEDIUM` (restart, config edit, command), proposal + your approval by default.
  - `HIGH` (kill, restore backup, git rollback), your explicit approval **and** a confirmation
    argument from the AI.
  - `CRITICAL` (delete server, destructive operations), cannot be automated at all.
- **File edits are protected**: the AI must read the file first, get its hash, and PteroOps
  refuses to write if the file changed in between. Every edit is diffed, snapshotted and
  re-verified by reading the file back.
- **Restarts are guarded**: if a crash loop is detected, a bare restart is refused, the AI must
  diagnose first (or you explicitly force it with a reason).
- **Fixes are transactional**: apply → wait for healthy → watch it stay healthy → only then
  "done". If it gets worse, PteroOps rolls the change back automatically.
- **Secrets never leak**: API keys, tokens and passwords are stripped from everything PteroOps
  outputs, everywhere.

You can tighten everything in the config file (`policy`, `approval`, `maintenanceWindows`), see
[`docs/configuration.md`](configuration.md). For paranoid setups, start with a **read-only
application key**: PteroOps then only registers read tools.

---

## Docker (optional)

Only needed if you want PteroOps running on a server instead of your laptop. **Everyone else can
skip this section.**

```bash
docker build -t pteroops .
docker run -d --name pteroops \
  -v pteroops-data:/app/data \
  -e PTERO_PANEL_MY_URL=https://panel.yourhost.com \
  -e PTERO_PANEL_MY_CLIENT_KEY=ptlc_your_key_here \
  -e PTERO_DEFAULT_PANEL=my \
  -e PTERO_HTTP_TOKEN=some-long-random-token \
  -p 127.0.0.1:8080:8080 \
  pteroops --transport http
```

Then point your MCP client at `http://127.0.0.1:8080/mcp` with header
`Authorization: Bearer some-long-random-token`. Data persists in the `pteroops-data` volume. The
container never contains your keys, they are passed at run time.

---

## Troubleshooting

| Problem | Likely cause | Fix |
| --- | --- | --- |
| AI says "no pteroops tools" | Config file JSON is invalid, or the app wasn't fully restarted | Validate the JSON (paste into jsonlint.com), fully quit & reopen the app |
| `spawn node ENOENT` | `node` is not on PATH for the AI app | Use the full path to `node` in `command`, or reinstall Node with "Add to PATH" |
| `pteroops: command not found` (right after installing) | The installer added the bin directory to PATH, but this shell started before that | Open a new terminal, or run `export PATH="$HOME/.local/bin:$PATH"` (`$env:Path += ";$env:LOCALAPPDATA\PteroOps\bin"` on Windows) |
| Installer says "Node.js is not installed" | Node isn't on PATH in that shell | Install from [nodejs.org](https://nodejs.org) (or `PTEROOPS_INSTALL_NODE=1` / `-InstallNode`), then open a new terminal |
| Installer download fails behind a proxy/firewall | codeload.github.com is blocked | Use `PTEROOPS_SOURCE_DIR` / `-SourceZip` with a local copy, see [installation.md](installation.md#offline--air-gapped-install) |
| Tools appear but everything errors `AUTH` | Wrong/expired key, or key has no access to that server | Re-copy `ptlc_...` key; verify server access in panel |
| `CAPABILITY_MISSING` | You used a client-only key with an admin tool (or vice versa) | Run `ptero_get_capabilities`; add the other key type if needed |
| "Connect ENOTFOUND/ECONNREFUSED panel" | URL typo, panel offline, or firewall | Test the URL in a browser; remember `https://` |
| `ConfigError: Environment variable X is not set` | Config file references `${VAR}` that isn't set | Set the variable or hardcode the value in the config file |
| Crash loop detected and restart refused | Working as designed | Ask the AI to diagnose (`ptero_diagnose`); it will propose a real fix |
| `STALE_WRITE` on a file edit | The file changed after the AI read it | Let the AI re-read and regenerate the patch, this protects your files |
| Port 8080 in use (Docker/HTTP) | Something else uses 8080 | Change `-p 127.0.0.1:8081:8080` (and `PTERO_HTTP_PORT=8081`) |
| PteroOps uses lots of memory | Long console retention on big servers | Lower `console.retentionHours` / `maxEventsPerServer` in the config |

Still stuck? Open an issue with: what you ran, what happened, the error text, and the output of
`ptero_get_capabilities`. **Never paste your API key into an issue.**

---

## FAQ

**Does PteroOps change my servers on its own?**
No. By default it is read-only until *you* ask for a fix, and every changing action goes through
risk classification, your approval (for MEDIUM and above), and a recorded rollback plan.

**Does the AI see my data?**
Whatever the AI app sees, the AI provider's privacy terms apply. PteroOps only fetches what the
AI asks for. Secrets that look like passwords/tokens are redacted before leaving PteroOps.

**Do I need SSH or RCON?**
No. PteroOps talks to the panel API and the panel's own WebSocket console.

**Does it work with multiple panels?**
Yes, add `staging`, `panel2`, … sections with different keys and address servers as
`panel/server-id`.

**Which Pterodactyl versions are supported?**
The v1.x API (`ptlc_`/`ptla_` keys). If your panel issues those keys, you're good.

**What is MCP?**
The "Model Context Protocol", a standard that lets AI apps plug into tools. PteroOps is an MCP
server; the AI app is the MCP client. You don't need to understand it beyond the config snippet.

**Do I need both keys?**
No. Client only = the full SRE workflow minus panel-admin tools. Application only = inventory and
admin views but no console/files. Both = everything.

**Will it fix my crash loop automatically while I sleep?**
Only if you configure it to. Out of the box, PteroOps *proposes* fixes; LOW-risk auto-approval
your config lists. You stay in control.

**How do I update PteroOps?**
Re-run the installer, that's it:

```bash
curl -fsSL https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.sh | bash
```

```powershell
irm https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.ps1 | iex
```

It rebuilds and swaps the new version in; your data is untouched. Then restart your AI app.
(Manual installs: `git pull && npm install && npm run build`.)

**How do I uninstall it?**
Run the installer with `--uninstall` (`-Uninstall` on Windows), it removes the app and the
`pteroops` command while keeping your data unless you add `--purge`/`-Purge`. Then remove the
`pteroops` entry from your AI app's MCP config and delete the API key in your panel. Full
details: [installation.md](installation.md#uninstalling).

**Where is my data stored?**
In `~/.pteroops/data/pteroops.sqlite` on macOS/Linux
(`%LOCALAPPDATA%\PteroOps\data` on Windows): console history, incidents, change ledger,
snapshots. Delete that folder (or `--purge` the installer) to start fresh. In Docker it's the
`pteroops-data` volume.

**Is there a hosted version?**
Not yet, the architecture is multi-tenant-ready, but today you run it yourself. See the planned
items in [`docs/status.md`](status.md).

---

## Next steps

| I want to… | Read |
| --- | --- |
| Use every tool well | [`docs/mcp-reference.md`](mcp-reference.md) + [`docs/agent-guide.md`](agent-guide.md) |
| Tune policy, approvals, monitoring | [`docs/configuration.md`](configuration.md) |
| Deploy on a server / automation | [`docs/integrations.md`](integrations.md) |
| Understand the design | [`ARCHITECTURE.md`](../ARCHITECTURE.md), [`docs/README.md`](README.md) |
| Know what's finished | [`docs/status.md`](status.md) |
| Contribute | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
