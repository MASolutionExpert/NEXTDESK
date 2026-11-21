import conventionalCommits from "conventional-changelog-conventionalcommits";

interface CommitRecord { subject?: string; header?: string; pr?: string; [key: string]: unknown; }

const presetConfig = {
  types: [
    { type: "feat", section: "Features" }, { type: "fix", section: "Bug Fixes" },
    { type: "perf", section: "Improvements" }, { type: "refactor", section: "Improvements" },
    { type: "style", section: "Improvements" }, { type: "build", section: "Build" },
    { type: "docs", section: "Documentation" }, { type: "chore", hidden: true },
    { type: "ci", hidden: true }, { type: "test", hidden: true },
  ],
};

const preset = await conventionalCommits(presetConfig);
const baseTransform = preset.writer.transform;

const transform = (commit: CommitRecord, context: unknown) => {
  const transformed = baseTransform(commit, context) as CommitRecord | false;
  if (!transformed) return false;
  if (transformed.subject) {
    const prMatch = transformed.subject.match(/\s*\((#\d+|\[#\d+\]\([^)]+\))\)$/);
    if (prMatch) {
      transformed.pr = prMatch[1];
      transformed.subject = transformed.subject.slice(0, prMatch.index);
    }
    transformed.subject = transformed.subject.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  }
  if (transformed.header) {
    transformed.header = transformed.header.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  }
  return transformed;
};

const SECTION_ORDER: Record<string, number> = { Features: 1, Improvements: 2, "Bug Fixes": 3, Build: 4, Documentation: 5 };
const commitGroupsSort = (a: { title: string }, b: { title: string }) =>
  (SECTION_ORDER[a.title] ?? Number.MAX_SAFE_INTEGER) - (SECTION_ORDER[b.title] ?? Number.MAX_SAFE_INTEGER) || String(a.title).localeCompare(String(b.title));

const commitPartial = `* [{{#if scope}}**{{scope}}:** {{/if}}{{#if subject}}{{subject}}{{else}}{{header}}{{/if}}]({{#if @root.repository}}{{#if @root.host}}{{@root.host}}/{{/if}}{{#if @root.owner}}{{@root.owner}}/{{/if}}{{@root.repository}}{{else}}{{@root.repoUrl}}{{/if}}/{{@root.commit}}/{{hash}}){{#if pr}} ({{pr}}){{/if}}{{#if references}}, closes{{#each references}} {{#if @root.linkReferences}}[{{#if this.owner}}{{this.owner}}/{{/if}}{{this.repository}}#{{this.issue}}]({{#if @root.repository}}{{#if @root.host}}{{@root.host}}/{{/if}}{{#if this.repository}}{{#if this.owner}}{{this.owner}}/{{/if}}{{this.repository}}{{else}}{{#if @root.owner}}{{@root.owner}}/{{/if}}{{@root.repository}}{{/if}}{{else}}{{@root.repoUrl}}{{/if}}/{{@root.issue}}/{{this.issue}}){{else}}{{#if this.owner}}{{this.owner}}/{{/if}}{{this.repository}}#{{this.issue}}{{/if}}{{/each}}{{/if}}`;

export default {
  branches: ["main"],
  plugins: [
    ["@semantic-release/commit-analyzer", {
      releaseRules: [
        { breaking: true, release: false }, { revert: true, release: false },
        { type: "feat", release: false }, { type: "fix", release: false },
        { type: "perf", release: false }, { type: "hotfix", release: false },
        { type: "refactor", release: false }, { type: "docs", release: false },
        { type: "style", release: false }, { type: "test", release: false },
        { type: "chore", release: false }, { type: "build", release: false },
        { type: "ci", release: false },
        { header: "{*,**/**}\\[patch release\\]*", release: "patch" },
        { header: "{*,**/**}\\[minor release\\]*", release: "minor" },
        { header: "{*,**/**}\\[major release\\]*", release: "major" },
      ],
    }],
    ["@semantic-release/release-notes-generator", { preset: "conventionalcommits", presetConfig, writerOpts: { commitGroupsSort, commitPartial, transform } }],
    ["@semantic-release/github", { assets: [{ path: "dist/*.zip", label: "Distribution" }], failOnIssueNotFound: false }],
  ],
};
