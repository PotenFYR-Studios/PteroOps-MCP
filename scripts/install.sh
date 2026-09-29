#!/usr/bin/env bash
# PteroOps installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/PotenFYR-Studios/PteroOps-MCP/main/scripts/install.sh | bash
#
# Flags:
#   --method <source|release|npm>  how to install (default: source)
#                                  source  = download + build from git (always works)
#                                  release = prebuilt tarball from GitHub Releases (no build)
#                                  npm     = install the published package from the npm registry
#   --uninstall                    remove the app and launcher (keeps data unless --purge)
#   --purge                        with --uninstall: also delete stored data
#   --no-path                      do not touch shell rc files
#   --help                         show this help
#
# Env vars:
#   PTEROOPS_PREFIX            install root        (default: $HOME/.pteroops)
#   PTEROOPS_BIN_DIR           launcher directory   (default: $HOME/.local/bin)
#   PTEROOPS_METHOD            same as --method
#   PTEROOPS_REF               branch/tag for source (default: main)
#   PTEROOPS_VERSION           version for release/npm (default: package.json's version, else latest)
#   PTEROOPS_SOURCE_DIR        install from a local checkout (source method)
#   PTEROOPS_ARCHIVE_URL       override the source download URL
#   PTEROOPS_RELEASE_TARBALL   override the release tarball URL/path (offline installs)
#   PTEROOPS_NPM_REGISTRY      npm registry to use for the npm method
#   PTEROOPS_INSTALL_NODE=1    attempt a Node.js install via the system package manager
set -euo pipefail

REPO="${PTEROOPS_REPO:-PotenFYR-Studios/PteroOps-MCP}"
REF="${PTEROOPS_REF:-main}"
METHOD="${PTEROOPS_METHOD:-source}"
VERSION="${PTEROOPS_VERSION:-}"
PREFIX="${PTEROOPS_PREFIX:-$HOME/.pteroops}"
BIN_DIR="${PTEROOPS_BIN_DIR:-$HOME/.local/bin}"
SOURCE_DIR="${PTEROOPS_SOURCE_DIR:-}"
ARCHIVE_URL="${PTEROOPS_ARCHIVE_URL:-https://codeload.github.com/$REPO/tar.gz/refs/heads/$REF}"
RELEASE_TARBALL="${PTEROOPS_RELEASE_TARBALL:-}"
NPM_REGISTRY="${PTEROOPS_NPM_REGISTRY:-}"
MIN_NODE_MAJOR=22

UNINSTALL=0
PURGE=0
NO_PATH=0

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --method) METHOD="${2:-}"; shift 2 ;;
    --method=*) METHOD="${1#*=}"; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --purge) PURGE=1; shift ;;
    --no-path) NO_PATH=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
done

case "$METHOD" in
  source|release|npm) : ;;
  *) echo "unknown --method '$METHOD' (expected source, release or npm)" >&2; exit 1 ;;
esac

say() { printf '  %s\n' "$*"; }
step() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\n\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

APP_ENTRY=""

# ---------------------------------------------------------------- uninstall
if [ "$UNINSTALL" = "1" ]; then
  step "Uninstalling PteroOps"
  rm -rf "$PREFIX/app" "$PREFIX/runtime"
  rm -f "$BIN_DIR/pteroops"
  for rc in "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.config/fish/config.fish"; do
    [ -f "$rc" ] && sed -i.bak '/# >>> pteroops >>>/,/# <<< pteroops <<</d' "$rc" 2>/dev/null || true
  done
  if [ "$PURGE" = "1" ]; then
    rm -rf "$PREFIX/data"
    say "data removed ($PREFIX/data)"
  else
    say "kept data at $PREFIX/data (use --purge to remove it)"
  fi
  say "done"
  exit 0
fi

# ------------------------------------------------------------------- node
step "Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  if [ "${PTEROOPS_INSTALL_NODE:-0}" = "1" ]; then
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update -qq && sudo apt-get install -y nodejs npm
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y nodejs npm
    elif command -v brew >/dev/null 2>&1; then
      brew install node@22
    else
      fail "no supported package manager found; install Node.js ${MIN_NODE_MAJOR}+ manually from https://nodejs.org"
    fi
  else
    fail "Node.js is not installed. Install Node.js ${MIN_NODE_MAJOR}+ from https://nodejs.org (or re-run with PTEROOPS_INSTALL_NODE=1)"
  fi
fi
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]; then
  fail "Node.js ${MIN_NODE_MAJOR}+ is required (found $(node --version)). Upgrade from https://nodejs.org"
fi
command -v npm >/dev/null 2>&1 || fail "npm is required but was not found next to node"
say "node $(node --version), npm $(npm --version)"

# ---------------------------------------------------------------- version
if [ -z "$VERSION" ]; then
  if [ -n "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/package.json" ]; then
    VERSION="$(node -p "require('$SOURCE_DIR/package.json').version" 2>/dev/null || true)"
  elif command -v node >/dev/null 2>&1; then
    VERSION="$(node -e "fetch('https://raw.githubusercontent.com/$REPO/$REF/package.json').then(r=>r.json()).then(j=>console.log(j.version)).catch(()=>process.exit(0))" 2>/dev/null || true)"
  fi
fi

NPM_FLAGS=(--no-audit --no-fund --loglevel=error --ignore-scripts)

# ------------------------------------------------------------------- npm
if [ "$METHOD" = "npm" ]; then
  step "Installing pteroops-mcp from the npm registry${VERSION:+ (v$VERSION)}"
  rm -rf "$PREFIX/runtime"
  mkdir -p "$PREFIX/runtime"
  REGISTRY_ARGS=()
  [ -n "$NPM_REGISTRY" ] && REGISTRY_ARGS=(--registry "$NPM_REGISTRY")
  npm install --omit=dev --prefix "$PREFIX/runtime" "${REGISTRY_ARGS[@]}" "pteroops-mcp@${VERSION:-latest}" "${NPM_FLAGS[@]}"
  APP_ENTRY="$PREFIX/runtime/node_modules/pteroops-mcp/dist/index.js"
  [ -f "$APP_ENTRY" ] || fail "npm install did not produce $APP_ENTRY"
  say "installed to $PREFIX/runtime"
fi

# --------------------------------------------------------------- release
if [ "$METHOD" = "release" ]; then
  [ -n "$VERSION" ] || fail "the release method needs a version (set PTEROOPS_VERSION, e.g. PTEROOPS_VERSION=0.1.0)"
  TARGET="${RELEASE_TARBALL:-https://github.com/$REPO/releases/download/v$VERSION/pteroops-mcp-$VERSION.tgz}"
  step "Installing prebuilt release v$VERSION"
  rm -rf "$PREFIX/runtime"
  mkdir -p "$PREFIX/runtime"
  npm install --omit=dev --prefix "$PREFIX/runtime" "$TARGET" "${NPM_FLAGS[@]}" || fail "failed to install release tarball: $TARGET"
  APP_ENTRY="$PREFIX/runtime/node_modules/pteroops-mcp/dist/index.js"
  [ -f "$APP_ENTRY" ] || fail "release tarball did not produce $APP_ENTRY"
  say "installed to $PREFIX/runtime"
fi

# ---------------------------------------------------------------- source
if [ "$METHOD" = "source" ]; then
  step "Fetching PteroOps ($REF)"
  TMP_DIR="$(mktemp -d)"
  cleanup() { rm -rf "$TMP_DIR"; }
  trap cleanup EXIT

  if [ -n "$SOURCE_DIR" ]; then
    [ -d "$SOURCE_DIR" ] || fail "PTEROOPS_SOURCE_DIR does not exist: $SOURCE_DIR"
    mkdir -p "$TMP_DIR/src"
    tar -C "$SOURCE_DIR" \
      --exclude=node_modules --exclude=dist --exclude=.git --exclude=data \
      --exclude=.github --exclude=coverage \
      -cf - . | tar -C "$TMP_DIR/src" -xf -
    say "copied from $SOURCE_DIR"
  else
    ARCHIVE="$TMP_DIR/pteroops.tar.gz"
    if command -v curl >/dev/null 2>&1; then
      curl -fsSL "$ARCHIVE_URL" -o "$ARCHIVE" || fail "download failed: $ARCHIVE_URL"
    elif command -v wget >/dev/null 2>&1; then
      wget -qO "$ARCHIVE" "$ARCHIVE_URL" || fail "download failed: $ARCHIVE_URL"
    else
      fail "curl or wget is required"
    fi
    mkdir -p "$TMP_DIR/raw"
    tar -xzf "$ARCHIVE" -C "$TMP_DIR/raw"
    INNER="$(find "$TMP_DIR/raw" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
    [ -n "$INNER" ] || fail "unexpected archive layout"
    mv "$INNER" "$TMP_DIR/src"
    say "downloaded $(du -sh "$TMP_DIR/src" | cut -f1) from GitHub"
  fi

  step "Installing dependencies and building (this takes ~1 minute)"
  mkdir -p "$PREFIX"
  rm -rf "$PREFIX/app.new"
  mv "$TMP_DIR/src" "$PREFIX/app.new"
  (
    cd "$PREFIX/app.new"
    npm install --no-audit --no-fund --loglevel=error
    npm run build --silent
    npm prune --omit=dev --no-audit --no-fund --loglevel=error >/dev/null 2>&1 || true
  )
  rm -rf "$PREFIX/app"
  mv "$PREFIX/app.new" "$PREFIX/app"
  trap - EXIT
  cleanup
  APP_ENTRY="$PREFIX/app/dist/index.js"
  [ -f "$APP_ENTRY" ] || fail "build did not produce dist/index.js"
  say "installed to $PREFIX/app"
fi

# --------------------------------------------------------------- launcher
step "Installing the pteroops launcher"
mkdir -p "$PREFIX/data" "$BIN_DIR"
cat > "$BIN_DIR/pteroops" <<LAUNCHER
#!/usr/bin/env bash
export PTERO_DATA_DIR="\${PTERO_DATA_DIR:-$PREFIX/data}"
exec node "$APP_ENTRY" "\$@"
LAUNCHER
chmod +x "$BIN_DIR/pteroops"
say "$BIN_DIR/pteroops  ->  $APP_ENTRY"

if [ "$NO_PATH" != "1" ]; then
  case "$PATH" in
    *"$BIN_DIR"*) : ;;
    *)
      case "${SHELL:-}" in
        */zsh) RC="$HOME/.zshrc" ;;
        */bash) RC="$HOME/.bashrc" ;;
        *) RC="$HOME/.profile" ;;
      esac
      if [ -f "$RC" ] && grep -q "# >>> pteroops >>>" "$RC" 2>/dev/null; then
        :
      else
        {
          echo ""
          echo "# >>> pteroops >>>"
          echo "export PATH=\"$BIN_DIR:\$PATH\""
          echo "# <<< pteroops <<<"
        } >> "$RC"
        say "added $BIN_DIR to PATH in $RC (open a new shell to use 'pteroops')"
      fi
      ;;
  esac
fi

# ------------------------------------------------------------------- done
step "Done (method: $METHOD)"
cat <<EOF

  Start using PteroOps:

    1. Get an API key: your panel -> Account -> API Credentials -> Create API Key
    2. Configure your MCP client (Claude Desktop example):

       {
         "mcpServers": {
           "pteroops": {
             "command": "node",
             "args": ["$APP_ENTRY"],
             "env": {
               "PTERO_PANEL_MY_URL": "https://panel.example.com",
               "PTERO_PANEL_MY_CLIENT_KEY": "ptlc_...",
               "PTERO_DEFAULT_PANEL": "my"
             }
           }
         }
       }

    3. Or run it yourself:   pteroops --help
       Web console (HTTP):   pteroops --transport http
       Update:               re-run this installer
       Uninstall:            bash scripts/install.sh --uninstall [--purge]

  Docs: https://github.com/$REPO  ·  https://github.com/$REPO/blob/main/docs/installation.md
EOF
