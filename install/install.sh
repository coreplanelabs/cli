#!/bin/sh
# polylane CLI installer shim for macOS / Linux.
#
# The authoritative installer is maintained on the website and served at
# https://polylane.com/install — this file only delegates to it so old links
# and raw fetches of this path keep working.
#
# Env vars (POLYLANE_VERSION, POLYLANE_PREFIX, POLYLANE_REF,
# POLYLANE_SKIP_SETUP) and flags (--no-setup) pass straight through:
#
#   POLYLANE_VERSION=v0.2.1 curl -fsSL https://polylane.com/install | bash

set -eu

command -v curl >/dev/null 2>&1 || { printf 'error: curl is required\n' >&2; exit 1; }
command -v bash >/dev/null 2>&1 || { printf 'error: bash is required\n' >&2; exit 1; }

script="$(curl -fsSL https://polylane.com/install)" \
  || { printf 'error: failed to fetch https://polylane.com/install\n' >&2; exit 1; }

printf '%s\n' "$script" | bash -s -- "$@"
