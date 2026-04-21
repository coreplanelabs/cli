#!/usr/bin/env bash
# Cut a new release of the nominal CLI.
#
#   ./release.sh 0.1.0
#   ./release.sh               # prompts for version
#
# Steps: bump package.json → typecheck + lint + test + build → commit → tag →
# push. `release.yml` takes over once the v* tag reaches origin.

set -euo pipefail

die() { printf '\033[31merror\033[0m: %s\n' "$*" >&2; exit 1; }
info() { printf '\033[2m→ %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }

cd "$(dirname "$0")"
[ -f package.json ] || die "run from the repo root (package.json not found here)"

# Clean tree — version bump and tag must land on a known state.
if [ -n "$(git status --porcelain)" ]; then
  git status --short >&2
  die "working tree is dirty — commit or stash first"
fi

# Version: arg or prompt.
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  read -rp "Release version (no v prefix, e.g. 0.1.0): " VERSION
fi
VERSION="${VERSION#v}"

# Reject anything that isn't semver x.y.z[-prerelease][+build].
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
  die "invalid semver: '$VERSION' (expected x.y.z)"
fi

TAG="v$VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  die "tag $TAG already exists locally"
fi
if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  die "tag $TAG already exists on origin"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
  read -rp "Current branch is '$BRANCH', not 'main'. Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || die "aborted"
fi

info "bumping package.json to $VERSION"
npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
ok "package.json → $VERSION"

info "typecheck"
npm run typecheck

info "lint"
npm run lint

info "test"
npm run test

info "build"
npm run build
ok "all checks passed"

info "committing version bump"
git add package.json package-lock.json
git commit -m "chore: release $TAG"

info "tagging $TAG"
git tag -a "$TAG" -m "nominal $VERSION"

info "pushing $BRANCH + $TAG to origin"
git push origin "$BRANCH"
git push origin "$TAG"

ok "Released $TAG — watch: https://github.com/coreplanelabs/cli/actions"
