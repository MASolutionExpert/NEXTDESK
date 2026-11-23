#!/usr/bin/env bash
# Release-sync gate (mandatory DevOps law for NextDesk).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CHANNEL=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

fail=0
fail_reason() { printf "FAIL: %s\n" "$1"; fail=1; }

version=""
if [[ -f "$ROOT_DIR/VERSION" ]]; then
  version="$(head -n 1 "$ROOT_DIR/VERSION" | tr -d '\r\n' | xargs)"
fi
if [[ -z "$version" ]]; then
  fail_reason "VERSION file is missing or empty."
fi

if [[ -n "$CHANNEL" && -n "$version" ]]; then
  case "$CHANNEL" in
    dev)
      if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-dev\.[0-9]{10}$ ]]; then
        fail_reason "Dev channel version ($version) must match X.Y.Z-dev.YYYYMMDDNN (e.g. 2.0.0-dev.2026112101)."
      fi
      ;;
    stable|main)
      if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        fail_reason "Stable channel version ($version) must match X.Y.Z (must not contain -dev)."
      fi
      ;;
    *) fail_reason "Unknown --channel '$CHANNEL' (expected dev or stable)." ;;
  esac
fi

header_version=""
if [[ -f "$ROOT_DIR/scripts/install.sh" ]]; then
  header_version="$(grep -E '^# nextdesk-deploy-version:' "$ROOT_DIR/scripts/install.sh" | head -n 1 | cut -d ':' -f 2- | xargs)"
fi
if [[ -z "$header_version" ]]; then
  fail_reason "scripts/install.sh has no '# nextdesk-deploy-version:' header."
elif [[ -n "$version" && "$header_version" != "$version" ]]; then
  fail_reason "Installer header version ($header_version) does not match VERSION ($version). The CLI would never self-update."
fi

if [[ -n "$version" && -f "$ROOT_DIR/CHANGELOG.md" ]]; then
  if ! grep -Eq "^## ${version//./\\.}\s*$" "$ROOT_DIR/CHANGELOG.md"; then
    fail_reason "CHANGELOG.md has no '## $version' section."
  fi
  dup_headings="$(grep -E '^## ' "$ROOT_DIR/CHANGELOG.md" | sed 's/[[:space:]]*$//' | sort | uniq -d)"
  if [[ -n "$dup_headings" ]]; then
    fail_reason "CHANGELOG.md has duplicate version headings: $(printf '%s' "$dup_headings" | tr '\n' ', ')"
  fi
fi

if [[ -f "$ROOT_DIR/scripts/install.sh" ]]; then
  for fn in semver_compare_versions channel_label_for_branch detect_install_branch finalize_nextdesk_source_change run_updated_finalize_pipeline switch_release_channel update_nextdesk; do
    if ! grep -Eq "^${fn}\(\) \{" "$ROOT_DIR/scripts/install.sh"; then
      fail_reason "scripts/install.sh is missing required function: ${fn}()"
    fi
  done
fi

if [[ -f "$ROOT_DIR/scripts/install.sh" ]]; then
  while IFS= read -r fn; do
    if ! grep -Eq "^${fn}\(\) \{" "$ROOT_DIR/scripts/install.sh"; then
      fail_reason "Menu dispatch calls undefined function: ${fn}()"
    fi
  done < <(grep -oE "run_menu_action [a-z_]+" "$ROOT_DIR/scripts/install.sh" | awk '{print $2}' | sort -u)
fi

if [[ "$fail" -eq 0 ]]; then
  printf "release-sync OK: %s (VERSION, installer/CLI header and CHANGELOG are in sync)\n" "$version"
  exit 0
fi
printf "release-sync FAILED: fix the issues above before registering a release.\n"
exit 1
