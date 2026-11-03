#!/bin/sh
# ---------------------------------------------------------------------------
# DiffLens installer for macOS (Apple Silicon).
#
#   curl -fsSL https://raw.githubusercontent.com/sogud/difflens/main/install.sh | sh
#
# Options (environment variables):
#   VERSION=v1.2.3     install a specific release tag instead of the newest one
#   INSTALL_DIR=...    app: default /Applications (falls back to ~/Applications)
#                      cli: default ~/.local/bin
#   GITHUB_TOKEN=...   optional, only to avoid GitHub API rate limits
#   GITHUB_BASE=...    optional download mirror prefix (default https://github.com)
#
# Uninstall:
#   curl -fsSL https://raw.githubusercontent.com/sogud/difflens/main/install.sh | sh -s -- --uninstall
#
# Files downloaded by curl are not tagged with com.apple.quarantine, so
# Gatekeeper does not show the "unidentified developer" prompt. The attribute
# is still removed defensively. The app is ad-hoc signed, not notarized.
#
# Generated from sogud install.sh template v1. Edit only the CONFIG block;
# change the body in the template and regenerate.
# ---------------------------------------------------------------------------
set -eu

# ---- CONFIG (per repository) ----------------------------------------------
REPO="sogud/difflens"                       # owner/name that publishes releases
APP_NAME="DiffLens"               # .app bundle name (kind=app) or binary name (kind=cli)
KIND="app"                       # app | cli
ASSET_GLOB="DiffLens-*-macos-arm64.zip"           # e.g. SkillView-*-macos-arm64.zip
ASSET_TEMPLATE="DiffLens-{version}-macos-arm64.zip"   # e.g. SkillView-{version}-macos-arm64.zip ({tag} keeps the v)
CHECKSUM_TEMPLATE="SHA256SUMS" # e.g. SHA256SUMS or {asset}.sha256; empty = none published
MIN_MACOS="14.0"             # e.g. 13.0
ALLOW_PRERELEASE="1"   # 1 = newest release may be a prerelease
# shellcheck disable=SC2088 # shown to the user as-is, never expanded
DATA_HINT="~/Library/Logs/DiffLens, ~/Library/Caches/com.sogud.difflens"             # shown on uninstall; never deleted by this script
# ---------------------------------------------------------------------------

GITHUB_BASE="${GITHUB_BASE:-https://github.com}"
API="https://api.github.com/repos/$REPO"
TMP=""

say()  { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

cleanup() { if [ -n "$TMP" ] && [ -d "$TMP" ]; then rm -rf "$TMP"; fi; }

fetch() { # fetch URL [OUTFILE]
  if [ $# -ge 2 ]; then
    curl -fsSL --retry 3 --connect-timeout 15 -o "$2" "$1"
  else
    curl -fsSL --retry 3 --connect-timeout 15 "$1"
  fi
}

api_get() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fsL --retry 2 --connect-timeout 15 \
      -H "Accept: application/vnd.github+json" \
      -H "Authorization: Bearer $GITHUB_TOKEN" "$1"
  else
    curl -fsL --retry 2 --connect-timeout 15 \
      -H "Accept: application/vnd.github+json" "$1"
  fi
}

check_platform() {
  [ "$(uname -s)" = "Darwin" ] || die "$APP_NAME is macOS only."
  # uname -m reports x86_64 under Rosetta; ask the hardware instead.
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" != "1" ]; then
    die "$APP_NAME currently ships Apple Silicon (arm64) builds only; Intel Macs are not supported yet."
  fi
  have=$(sw_vers -productVersion)
  if ! awk -v a="$have" -v b="$MIN_MACOS" 'BEGIN {
        split(a, x, "."); split(b, y, ".");
        for (i = 1; i <= 3; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 }
        exit 0 }'; then
    die "$APP_NAME needs macOS $MIN_MACOS or later (this Mac has $have)."
  fi
}

# Print "TAG URL" of the newest non-draft release whose asset matches ASSET_GLOB.
resolve_via_api() {
  json=$(api_get "$API/releases?per_page=20") || return 1
  printf '%s\n' "$json" |
    grep -oE '"(tag_name|draft|prerelease|browser_download_url)": *("[^"]*"|true|false)' |
    sed -E 's/^"([a-z_]+)": *"?([^"]*)"?$/\1 \2/' |
    {
      tag="" draft="" pre=""
      while read -r key val; do
        case "$key" in
          tag_name) tag=$val draft="" pre="" ;;
          draft) draft=$val ;;
          prerelease) pre=$val ;;
          browser_download_url)
            [ "$draft" = "true" ] && continue
            [ "$pre" = "true" ] && [ "$ALLOW_PRERELEASE" != "1" ] && continue
            name=${val##*/}
            # shellcheck disable=SC2254 # ASSET_GLOB is intentionally a pattern
            case "$name" in $ASSET_GLOB) printf '%s %s\n' "$tag" "$val"; exit 0 ;; esac
            ;;
        esac
      done
      exit 1
    }
}

# Fallback when the API is unavailable or rate limited: newest tag from the Atom feed.
resolve_tag_via_atom() {
  fetch "https://github.com/$REPO/releases.atom" |
    grep -oE "/$REPO/releases/tag/[^\"<]+" | head -n 1 | sed 's#.*/releases/tag/##'
}

expand() { # expand TEMPLATE TAG [ASSET]
  version=${2#v}
  printf '%s\n' "$1" | sed -e "s#{tag}#$2#g" -e "s#{version}#$version#g" -e "s#{asset}#${3:-}#g"
}

resolve_release() {
  if [ -n "${VERSION:-}" ]; then
    TAG=$VERSION
    ASSET=$(expand "$ASSET_TEMPLATE" "$TAG")
  elif found=$(resolve_via_api); then
    TAG=${found%% *}
    ASSET=${found##*/}
  else
    warn "GitHub API unavailable; using the release feed."
    TAG=$(resolve_tag_via_atom) || TAG=""
    [ -n "$TAG" ] || die "could not find a release of $REPO."
    ASSET=$(expand "$ASSET_TEMPLATE" "$TAG")
  fi
  URL="$GITHUB_BASE/$REPO/releases/download/$TAG/$ASSET"
}

verify_checksum() { # verify_checksum FILE
  if [ -z "$CHECKSUM_TEMPLATE" ]; then
    warn "this release has no published checksum; skipping verification."
    return 0
  fi
  sums_name=$(expand "$CHECKSUM_TEMPLATE" "$TAG" "$ASSET")
  fetch "$GITHUB_BASE/$REPO/releases/download/$TAG/$sums_name" "$TMP/sums" ||
    die "could not download $sums_name to verify the download."
  expected=$(awk -v n="$ASSET" '$2 == n || $2 == "*" n { print $1; exit }' "$TMP/sums")
  if [ -z "$expected" ] && [ "$(wc -l < "$TMP/sums" | tr -d ' ')" -le 1 ]; then
    expected=$(awk 'NR == 1 { print $1 }' "$TMP/sums")   # single-hash file
  fi
  [ -n "$expected" ] || die "$sums_name does not list $ASSET."
  actual=$(shasum -a 256 "$1" | awk '{ print $1 }')
  [ "$expected" = "$actual" ] || die "checksum mismatch for $ASSET (expected $expected, got $actual)."
  say "Checksum OK."
}

extract() { # extract ARCHIVE DEST
  mkdir -p "$2"
  case "$1" in
    *.zip) ditto -x -k "$1" "$2" ;;          # ditto keeps bundle symlinks and signatures intact
    *.tar.gz | *.tgz) tar -xzf "$1" -C "$2" ;;
    *) cp "$1" "$2/$APP_NAME" ;;           # bare binary asset
  esac
}

app_dest_dir() {
  if [ -n "${INSTALL_DIR:-}" ]; then
    mkdir -p "$INSTALL_DIR"; printf '%s\n' "$INSTALL_DIR"
  elif [ -w /Applications ]; then
    printf '%s\n' /Applications
  else
    mkdir -p "$HOME/Applications"; printf '%s\n' "$HOME/Applications"
  fi
}

install_app() {
  src=$(find "$TMP/x" -maxdepth 3 -type d -name "$APP_NAME.app" -prune | head -n 1)
  [ -n "$src" ] || die "$APP_NAME.app not found in $ASSET."
  dir=$(app_dest_dir)
  dest="$dir/$APP_NAME.app"
  if pgrep -f "$dest/Contents/MacOS/" >/dev/null 2>&1; then
    die "$APP_NAME is running. Quit it (⌘Q) and run the installer again."
  fi
  if [ -e "$dest" ]; then mv "$dest" "$TMP/previous.app"; fi
  if ! ditto "$src" "$dest"; then
    rm -rf "$dest"
    if [ -e "$TMP/previous.app" ]; then mv "$TMP/previous.app" "$dest"; fi
    die "could not copy $APP_NAME.app to $dir."
  fi
  xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true
  codesign --verify "$dest" >/dev/null 2>&1 || warn "code signature check failed for $dest."
  say "Installed $APP_NAME $TAG to $dest"
  say "Open it with: open \"$dest\""
}

install_cli() {
  src=$(find "$TMP/x" -maxdepth 3 -type f -name "$APP_NAME" | head -n 1)
  [ -n "$src" ] || die "$APP_NAME binary not found in $ASSET."
  dir=${INSTALL_DIR:-$HOME/.local/bin}
  mkdir -p "$dir"
  install -m 0755 "$src" "$dir/$APP_NAME"
  xattr -d com.apple.quarantine "$dir/$APP_NAME" 2>/dev/null || true
  say "Installed $APP_NAME $TAG to $dir/$APP_NAME"
  case ":$PATH:" in
    *":$dir:"*) ;;
    *) say "Add it to PATH: echo 'export PATH=\"$dir:\$PATH\"' >> ~/.zprofile" ;;
  esac
}

uninstall() {
  removed=0
  if [ "$KIND" = "app" ]; then
    for d in "${INSTALL_DIR:-/Applications}" "$HOME/Applications"; do
      if [ -d "$d/$APP_NAME.app" ]; then rm -rf "$d/$APP_NAME.app"; say "Removed $d/$APP_NAME.app"; removed=1; fi
    done
  else
    f="${INSTALL_DIR:-$HOME/.local/bin}/$APP_NAME"
    if [ -f "$f" ]; then rm -f "$f"; say "Removed $f"; removed=1; fi
  fi
  [ "$removed" = 1 ] || say "$APP_NAME is not installed in the default location."
  if [ -n "$DATA_HINT" ]; then say "Settings and data were kept: $DATA_HINT"; fi
}

main() {
  case "${1:-}" in
    --uninstall) uninstall; return 0 ;;
    "") ;;
    *) die "unknown option: $1 (only --uninstall is supported)" ;;
  esac
  check_platform
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/install.XXXXXX")
  trap cleanup EXIT
  trap 'exit 130' INT TERM
  resolve_release
  say "Downloading $ASSET ($TAG)…"
  curl -fL --retry 3 --connect-timeout 15 --progress-bar -o "$TMP/$ASSET" "$URL" ||
    die "download failed: $URL"
  verify_checksum "$TMP/$ASSET"
  extract "$TMP/$ASSET" "$TMP/x"
  if [ "$KIND" = "app" ]; then install_app; else install_cli; fi
}

# Everything runs from main so a truncated download never executes half a script.
main "$@"
