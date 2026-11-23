import { describe, test, expect, afterEach } from "vitest";
import {
  normalizeVersion,
  compareVersions,
  fetchLatestGitHubTag,
} from "../../src/utils/versioning.ts";

describe("normalizeVersion", () => {
  test("strips a leading v", () => {
    expect(normalizeVersion("v1.2.3")).toBe("1.2.3");
  });

  test("strips a leading V (case-insensitive)", () => {
    expect(normalizeVersion("V2.0.0")).toBe("2.0.0");
  });

  test("returns the string unchanged when there is no v prefix", () => {
    expect(normalizeVersion("1.0.0")).toBe("1.0.0");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeVersion("  v3.1.4  ")).toBe("3.1.4");
  });

  test("returns empty string for falsy inputs", () => {
    expect(normalizeVersion(null)).toBe("");
    expect(normalizeVersion(undefined)).toBe("");
    expect(normalizeVersion("")).toBe("");
  });
});

describe("compareVersions", () => {
  describe("equal versions", () => {
    test("returns 0 for identical strings", () => {
      expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    });

    test("returns 0 when both have v prefix and are equal", () => {
      expect(compareVersions("v1.0.0", "v1.0.0")).toBe(0);
    });

    test("returns 0 for two invalid version strings", () => {
      expect(compareVersions("bad", "also-bad")).toBe(0);
    });
  });

  describe("major version differences", () => {
    test("returns 1 when left major is higher", () => {
      expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    });

    test("returns -1 when left major is lower", () => {
      expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    });
  });

  describe("minor version differences", () => {
    test("returns 1 when left minor is higher", () => {
      expect(compareVersions("1.3.0", "1.2.0")).toBe(1);
    });

    test("returns -1 when left minor is lower", () => {
      expect(compareVersions("1.1.0", "1.2.0")).toBe(-1);
    });
  });

  describe("patch version differences", () => {
    test("returns 1 when left patch is higher", () => {
      expect(compareVersions("1.0.2", "1.0.1")).toBe(1);
    });

    test("returns -1 when left patch is lower", () => {
      expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    });
  });

  describe("prerelease handling", () => {
    test("stable beats prerelease of same base version", () => {
      expect(compareVersions("1.0.0", "1.0.0-beta")).toBe(1);
    });

    test("prerelease loses to stable", () => {
      expect(compareVersions("1.0.0-rc1", "1.0.0")).toBe(-1);
    });

    test("compares prereleases lexicographically", () => {
      expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBe(1);
      expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
    });

    test("returns 0 for equal prereleases", () => {
      expect(compareVersions("1.0.0-alpha", "1.0.0-alpha")).toBe(0);
    });
  });

  describe("invalid input handling", () => {
    test("returns -1 when only the left version is invalid", () => {
      expect(compareVersions("not-a-version", "1.0.0")).toBe(-1);
    });

    test("returns 1 when only the right version is invalid", () => {
      expect(compareVersions("1.0.0", "garbage")).toBe(1);
    });
  });

  describe("v-prefix normalization", () => {
    test("correctly compares v-prefixed versions", () => {
      expect(compareVersions("v2.0.0", "v1.0.0")).toBe(1);
    });

    test("compares mixed v-prefix and plain versions", () => {
      expect(compareVersions("v1.0.1", "1.0.0")).toBe(1);
    });
  });
  test("compares numeric prerelease identifiers numerically (dev.10 > dev.9)", () => {
    expect(compareVersions("1.1.0-dev.10", "1.1.0-dev.9")).toBe(1);
    expect(compareVersions("1.1.0-dev.9", "1.1.0-dev.10")).toBe(-1);
    expect(compareVersions("1.1.0", "1.1.0-dev.10")).toBe(1);
    expect(compareVersions("1.1.0-dev.10", "1.1.0")).toBe(-1);
  });
});

describe("fetchLatestGitHubTag release channels", () => {
  const mockTagsResponse = (tags) => {
    (global as any).fetch = async () => ({
      ok: true,
      json: async () => tags.map((name) => ({ name })),
    });
  };

  afterEach(() => {
    delete global.fetch;
  });

  const MIXED_TAGS = ["v1.1.0-dev.7", "v1.1.0-dev.6", "v1.0.0"];

  test("stable channel ignores prerelease tags", async () => {
    mockTagsResponse(MIXED_TAGS);
    const latest = await fetchLatestGitHubTag({
      owner: "MASolutionExpert",
      repo: "nextdesk",
      channel: "stable",
    });
    expect(latest.rawTag).toBe("v1.0.0");
  });

  test("dev channel follows prerelease tags", async () => {
    mockTagsResponse(MIXED_TAGS);
    const latest = await fetchLatestGitHubTag({
      owner: "MASolutionExpert",
      repo: "nextdesk",
      channel: "dev",
    });
    expect(latest.rawTag).toBe("v1.1.0-dev.7");
  });

  test("defaults to the stable channel when channel is missing", async () => {
    mockTagsResponse(MIXED_TAGS);
    const latest = await fetchLatestGitHubTag({
      owner: "MASolutionExpert",
      repo: "nextdesk",
    });
    expect(latest.rawTag).toBe("v1.0.0");
  });

  test("compares 10-digit sortable dev prereleases numerically", () => {
    expect(compareVersions("2.0.0-dev.2026112302", "2.0.0-dev.2026112301")).toBe(1);
    expect(compareVersions("2.0.0-dev.2026112301", "2.0.0-dev.2026112302")).toBe(-1);
    expect(compareVersions("2.0.0", "2.0.0-dev.2026112302")).toBe(1);
  });

  test("paginates up to 3x100 GitHub tags so newer releases on later pages are not missed", async () => {
    const requestedPages: string[] = [];
    (global as any).fetch = async (url: string) => {
      requestedPages.push(url);
      if (new URL(url).searchParams.get("page") === "1") {
        return {
          ok: true,
          json: async () =>
            Array.from({ length: 100 }, (_, i) => ({ name: `v0.1.${i}` })),
        };
      }
      if (new URL(url).searchParams.get("page") === "2") {
        return {
          ok: true,
          json: async () =>
            Array.from({ length: 100 }, (_, i) => ({ name: `v0.2.${i}` })),
        };
      }
      if (new URL(url).searchParams.get("page") === "3") {
        return {
          ok: true,
          json: async () => [
            ...Array.from({ length: 99 }, (_, i) => ({ name: `v0.3.${i}` })),
            { name: "v2.0.0-dev.2026112302" },
          ],
        };
      }
      throw new Error(`Unexpected page requested: ${url}`);
    };

    const latest = await fetchLatestGitHubTag({
      owner: "MASolutionExpert",
      repo: "NEXTDESK",
      channel: "dev",
    });
    expect(latest.rawTag).toBe("v2.0.0-dev.2026112302");
    expect(requestedPages).toHaveLength(3);
  });

  test("stops paginating early when a page returns fewer than 100 tags", async () => {
    let calls = 0;
    (global as any).fetch = async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => [{ name: "v1.1.0-dev.10" }, { name: "v1.1.0-dev.9" }],
      };
    };

    const latest = await fetchLatestGitHubTag({
      owner: "MASolutionExpert",
      repo: "NEXTDESK",
      channel: "dev",
    });
    expect(latest.rawTag).toBe("v1.1.0-dev.10");
    expect(calls).toBe(1);
  });
});
