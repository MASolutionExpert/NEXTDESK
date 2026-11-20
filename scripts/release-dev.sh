#!/usr/bin/env bash
# Automates bumping a new dev version on the dev branch of NextDesk.
# Usage: bash scripts/release-dev.sh <new_version> "<summary>"
set -euo pipefail

NEW_VERSION="${1:-}"
if [[ -z "$NEW_VERSION" ]] || ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-dev\.[0-9]+$ ]]; then
  echo "Usage: bash scripts/release-dev.sh X.Y.Z-dev.N" >&2
  exit 1
fi

printf "%s\n" "$NEW_VERSION" > VERSION
sed -i "s|^# chatdesk-deploy-version:.*$|# chatdesk-deploy-version: ${NEW_VERSION}|" scripts/install.sh
echo "Updated VERSION and scripts/install.sh header to ${NEW_VERSION}."
echo "Add a '## ${NEW_VERSION}' section to CHANGELOG.md, then run: bash scripts/verify-release-sync.sh --channel dev"
