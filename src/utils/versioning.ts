export function normalizeVersion(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/^v/i, "");
}

interface ParsedVersion {
  normalized: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

function parseVersion(value: unknown): ParsedVersion | null {
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

function comparePrereleaseIdentifiers(left: string, right: string): number {
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

export function compareVersions(left: unknown, right: unknown): number {
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

const GITHUB_TAGS_PER_PAGE = 100;
const GITHUB_TAGS_MAX_PAGES = 3;

export async function fetchLatestGitHubTag({
  owner,
  repo,
  channel,
}: {
  owner?: string;
  repo?: string;
  channel?: string;
} = {}): Promise<{ rawTag: string; normalizedTag: string }> {
  if (!owner || !repo) {
    throw new Error("GitHub repository information is not configured.");
  }

  const seenRawTags = new Set<string>();
  const allTags: Array<{ name?: string }> = [];

  for (let page = 1; page <= GITHUB_TAGS_MAX_PAGES; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?per_page=${GITHUB_TAGS_PER_PAGE}&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) {
      if (page === 1) {
        throw new Error(`GitHub responded with ${response.status}.`);
      }
      break;
    }

    const tags = await response.json();
    const pageList = Array.isArray(tags) ? tags : [];
    for (const tag of pageList) {
      const name = String(tag?.name || "").trim();
      if (!name || seenRawTags.has(name)) continue;
      seenRawTags.add(name);
      allTags.push({ name });
    }

    if (pageList.length < GITHUB_TAGS_PER_PAGE) {
      break;
    }
  }

  const isDevChannel = String(channel || "").trim().toLowerCase() === "dev";
  const semverTags = allTags
    .map((tag) => {
      const rawTag = String(tag?.name || "").trim();
      const normalizedTag = normalizeVersion(rawTag);
      return rawTag && parseVersion(normalizedTag)
        ? { rawTag, normalizedTag }
        : null;
    })
    .filter((entry): entry is { rawTag: string; normalizedTag: string } =>
      Boolean(entry),
    )
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
