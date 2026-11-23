#!/usr/bin/env bash
# Automates bumping a sortable dev version on the dev branch of NextDesk.
# Format: X.Y.Z-dev.YYYYMMDDNN (10-digit date + daily sequence: 01..99).
# Usage: bash scripts/release-dev.sh 2.0.0-dev.2026112101
set -euo pipefail

NEW_VERSION="${1:-}"
if [[ -z "$NEW_VERSION" ]] || ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+-dev\.[0-9]{10}$ ]]; then
  echo "Usage: bash scripts/release-dev.sh X.Y.Z-dev.YYYYMMDDNN (e.g. 2.0.0-dev.2026112101)" >&2
  exit 1
fi

printf "%s\n" "$NEW_VERSION" > VERSION
sed -i "s|^# nextdesk-deploy-version:.*$|# nextdesk-deploy-version: ${NEW_VERSION}|" scripts/install.sh

echo "Updated VERSION and scripts/install.sh header to ${NEW_VERSION}."
echo "Add a '## ${NEW_VERSION}' section to CHANGELOG.md, then run: bash scripts/verify-release-sync.sh --channel dev"
