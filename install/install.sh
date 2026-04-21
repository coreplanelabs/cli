#!/usr/bin/env bash
# nominal CLI installer for macOS / Linux.
#
#   curl -fsSL https://nominal.dev/install.sh | bash
#
# Installs the bundled CLI to ~/.nominal/bin/nominal and (if needed) prints the
# line to add to your shell RC to put it on $PATH. Node 18+ must be installed.
# Override the version or install prefix with env vars:
#
#   NOMINAL_VERSION=v0.1.0  curl -fsSL https://nominal.dev/install.sh | bash
#   NOMINAL_PREFIX=/usr/local/bin curl -fsSL https://nominal.dev/install.sh | sudo bash

set -euo pipefail

# --- config -----------------------------------------------------------------

REPO="coreplanelabs/cli"                         # GitHub owner/repo
BIN_NAME="nominal"
VERSION="${NOMINAL_VERSION:-latest}"
PREFIX_DIR="${NOMINAL_PREFIX:-$HOME/.nominal/bin}"
BUNDLE_ASSET="nominal.mjs"

# --- helpers ----------------------------------------------------------------

die() { printf '\033[31merror\033[0m: %s\n' "$*" >&2; exit 1; }
info() { printf '\033[2m%s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

# --- preflight --------------------------------------------------------------

require_cmd curl
require_cmd uname

if ! command -v node >/dev/null 2>&1; then
  die "Node.js 18+ is required but 'node' was not found.
  Install from https://nodejs.org or with your package manager, then re-run."
fi

NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js 18+ is required (found $(node -v))."
fi

# --- resolve download URL ---------------------------------------------------

if [ "$VERSION" = "latest" ]; then
  # Use the "latest" redirect GitHub serves for releases
  DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$BUNDLE_ASSET"
else
  DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/$BUNDLE_ASSET"
fi

# --- download --------------------------------------------------------------

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
TMP_FILE="$TMP_DIR/$BUNDLE_ASSET"

info "Downloading $DOWNLOAD_URL"
if ! curl -fsSL --retry 3 --connect-timeout 10 "$DOWNLOAD_URL" -o "$TMP_FILE"; then
  die "download failed — check your network and that the release exists"
fi

if ! head -1 "$TMP_FILE" | grep -q '^#!'; then
  die "downloaded file does not look like a nominal CLI bundle"
fi

# --- install ---------------------------------------------------------------

mkdir -p "$PREFIX_DIR"
TARGET="$PREFIX_DIR/$BIN_NAME"
install -m 0755 "$TMP_FILE" "$TARGET"
ok "installed $TARGET"

INSTALLED_VERSION="$("$TARGET" --version 2>/dev/null || echo unknown)"
ok "nominal $INSTALLED_VERSION"

# --- PATH hint -------------------------------------------------------------

case ":$PATH:" in
  *":$PREFIX_DIR:"*) ;;
  *)
    RC_HINT=""
    case "${SHELL:-}" in
      *zsh)  RC_HINT="$HOME/.zshrc" ;;
      *bash) RC_HINT="$HOME/.bashrc" ;;
      *fish) RC_HINT="$HOME/.config/fish/config.fish" ;;
    esac
    printf '\n'
    info "Add %s to your PATH:" "$PREFIX_DIR"
    printf '    export PATH="%s:$PATH"\n' "$PREFIX_DIR"
    if [ -n "$RC_HINT" ]; then
      info "For example:"
      printf '    echo '\''export PATH="%s:$PATH"'\'' >> %s\n' "$PREFIX_DIR" "$RC_HINT"
    fi
    ;;
esac

printf '\nRun \033[1mnominal --help\033[0m to get started.\n'
