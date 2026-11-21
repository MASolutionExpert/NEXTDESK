export function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "");
}

function parseVersion(value) {
  const normalized = normalizeVersion(value);
  const match = normalized.match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/,
  );
  if (!match) return null;
  return {
    normalized,
    major: Number(match[1] || 0),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0),
    prerelease: String(match[4] || ""),
  };
}

function comparePrereleaseIdentifiers(left, right) {
  const leftParts = String(left || "").split(".").filter(Boolean);
  const rightParts = String(right || "").split(".").filter(Boolean);
  const maxLen = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < maxLen; i += 1) {
    if (i >= leftParts.length) return -1;
    if (i >= rightParts.length) return 1;
    const l = leftParts[i];
    const r = rightParts[i];
    if (l === r) continue;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) {
      const diff = Number(l) - Number(r);
      if (diff !== 0) return diff > 0 ? 1 : -1;
      continue;
    }
    if (lNum && !rNum) return -1;
    if (!lNum && rNum) return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (a.prerelease === b.prerelease) return 0;
  return comparePrereleaseIdentifiers(a.prerelease, b.prerelease);
}

export async function fetchLatestGitHubTag({ owner, repo, channel }: any = {}) {
  if (!owner || !repo) {
    throw new Error("GitHub repository information is not configured.");
  }

  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub responded with ${response.status}.`);
  }

  const tags = await response.json();
  const tagList = Array.isArray(tags) ? tags : [];
  const isDevChannel = String(channel || "").trim().toLowerCase() === "dev";
  const semverTags = tagList
    .map((tag) => {
      const rawTag = String(tag?.name || "").trim();
      const normalizedTag = normalizeVersion(rawTag);
      return rawTag && parseVersion(normalizedTag)
        ? { rawTag, normalizedTag }
        : null;
    })
    .filter(Boolean)
    // Release channels must stay separate: a Stable-channel install is only
    // offered stable tags (no -dev prereleases), while a Test-channel install
    // may follow prereleases.
    .filter(
      (entry) => isDevChannel || !parseVersion(entry.normalizedTag)?.prerelease,
    );

  if (!semverTags.length) {
    throw new Error("No version tags were found on GitHub.");
  }

  return semverTags.sort((left, right) =>
    compareVersions(right.normalizedTag, left.normalizedTag),
  )[0];
}
