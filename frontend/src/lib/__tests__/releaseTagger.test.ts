import { describe, it, expect } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  parseSemVer,
  selectHighestSemver,
  getLatestSemverTag,
  resolveNextVersion,
  determineBump,
  bumpVersion,
  parseConventionalCommit,
  generateChangelog,
} = require("../../../../desktop/scripts/release-tagger.js");

describe("release-tagger semantic versioning and changelog generator", () => {
  describe("parseSemVer", () => {
    it("parses valid semver strings with or without v prefix", () => {
      expect(parseSemVer("v1.4.12")).toEqual({ major: 1, minor: 4, patch: 12 });
      expect(parseSemVer("2.0.0")).toEqual({ major: 2, minor: 0, patch: 0 });
      expect(parseSemVer("v0.1.5")).toEqual({ major: 0, minor: 1, patch: 5 });
    });

    it("returns null for invalid inputs", () => {
      expect(parseSemVer("")).toBeNull();
      expect(parseSemVer("invalid-tag")).toBeNull();
      expect(parseSemVer(null)).toBeNull();
    });
  });

  describe("parseConventionalCommit", () => {
    it("parses standard feat and fix commits", () => {
      const featCommit = { subject: "feat: add new POS barcode scanner", body: "" };
      expect(parseConventionalCommit(featCommit)).toEqual({
        type: "feat",
        scope: null,
        description: "add new POS barcode scanner",
        isBreaking: false,
        rawSubject: "feat: add new POS barcode scanner",
      });

      const fixWithScope = { subject: "fix(auth): correct PIN validation", body: "" };
      expect(parseConventionalCommit(fixWithScope)).toEqual({
        type: "fix",
        scope: "auth",
        description: "correct PIN validation",
        isBreaking: false,
        rawSubject: "fix(auth): correct PIN validation",
      });
    });

    it("detects breaking changes via exclamation mark in type", () => {
      const breakingCommit = { subject: "feat!: redesign database schema for multi-store", body: "" };
      expect(parseConventionalCommit(breakingCommit).isBreaking).toBe(true);
    });

    it("detects breaking changes via BREAKING CHANGE in body or subject", () => {
      const bodyBreaking = {
        subject: "refactor: overhaul sales serializer",
        body: "BREAKING CHANGE: changes return shape of /api/sales/",
      };
      expect(parseConventionalCommit(bodyBreaking).isBreaking).toBe(true);

      const subjectBreaking = {
        subject: "chore: BREAKING CHANGE: dropped legacy node 16",
        body: "",
      };
      expect(parseConventionalCommit(subjectBreaking).isBreaking).toBe(true);
    });
  });

  describe("determineBump", () => {
    it("returns major when any commit is breaking", () => {
      const commits = [
        { subject: "fix: small bug", body: "" },
        { subject: "feat!: breaking API overhaul", body: "" },
        { subject: "feat: another feature", body: "" },
      ];
      expect(determineBump(commits)).toBe("major");
    });

    it("returns minor when there are features and no breaking changes", () => {
      const commits = [
        { subject: "fix: button alignment", body: "" },
        { subject: "feat: add daily report export", body: "" },
        { subject: "docs: update README", body: "" },
      ];
      expect(determineBump(commits)).toBe("minor");
    });

    it("returns patch when there are only fixes, refactors, docs, or chores", () => {
      const commits = [
        { subject: "fix: prevent division by zero", body: "" },
        { subject: "refactor: simplify hook", body: "" },
        { subject: "perf: cache user permissions", body: "" },
      ];
      expect(determineBump(commits)).toBe("patch");
    });

    it("returns null when commit list is empty", () => {
      expect(determineBump([])).toBeNull();
    });
  });

  describe("selectHighestSemver", () => {
    it("ignores pre-releases and a closer but older stable tag", () => {
      expect(selectHighestSemver([
        "v1.8.4",
        "v1.9.0-beta.9",
        "v1.8.5",
        "not-a-version",
      ])).toBe("v1.8.5");
    });
  });

  describe("getLatestSemverTag", () => {
    it("uses the highest ancestor tag rather than the closest one", () => {
      const exec = (cmd: string) => {
        if (cmd.includes("git tag")) return "v1.8.4\nv1.8.5\nv1.9.0-beta.9\n";
        if (cmd.includes("v1.8.4") || cmd.includes("v1.8.5")) return "ancestor";
        return "";
      };
      expect(getLatestSemverTag(exec)).toBe("v1.8.5");
    });
  });

  describe("resolveNextVersion", () => {
    it("skips a stable tag that already exists", () => {
      expect(resolveNextVersion("v1.8.4", "patch", ["v1.8.5", "v1.9.0-beta.1"])).toEqual({
        major: 1,
        minor: 8,
        patch: 6,
        version: "1.8.6",
        tag: "v1.8.6",
      });
    });
  });

  describe("bumpVersion", () => {
    it("increments major and resets minor and patch to 0", () => {
      expect(bumpVersion("v1.4.12", "major")).toEqual({
        major: 2,
        minor: 0,
        patch: 0,
        version: "2.0.0",
        tag: "v2.0.0",
      });
    });

    it("increments minor and resets patch to 0", () => {
      expect(bumpVersion("v1.4.12", "minor")).toEqual({
        major: 1,
        minor: 5,
        patch: 0,
        version: "1.5.0",
        tag: "v1.5.0",
      });
    });

    it("increments patch without touching major or minor", () => {
      expect(bumpVersion("v1.4.12", "patch")).toEqual({
        major: 1,
        minor: 4,
        patch: 13,
        version: "1.4.13",
        tag: "v1.4.13",
      });
    });
  });

  describe("generateChangelog", () => {
    it("generates markdown with categorized sections and links", () => {
      const commits = [
        {
          hash: "abcdef1234567890",
          shortHash: "abcdef1",
          subject: "feat(pos): fast cash shortcuts",
          author: "Dev",
          date: "2026-11-05T12:00:00Z",
          body: "",
        },
        {
          hash: "1234567890abcdef",
          shortHash: "1234567",
          subject: "fix: resolve receipt alignment",
          author: "Dev",
          date: "2026-11-05T12:01:00Z",
          body: "",
        },
      ];

      const changelog = generateChangelog({
        version: "1.5.0",
        previousTag: "v1.4.12",
        bump: "minor",
        commits,
        repoUrl: "https://github.com/averroes96/pointure",
      });

      expect(changelog).toContain("## ShoeDZ Desktop v1.5.0");
      expect(changelog).toContain("*Release Type:* **MINOR**");
      expect(changelog).toContain("### 🚀 Features & Enhancements");
      expect(changelog).toContain("- **pos:** fast cash shortcuts ([`abcdef1`](https://github.com/averroes96/pointure/commit/abcdef1234567890))");
      expect(changelog).toContain("### 🐛 Bug Fixes");
      expect(changelog).toContain("- resolve receipt alignment ([`1234567`](https://github.com/averroes96/pointure/commit/1234567890abcdef))");
      expect(changelog).toContain("**Full Changelog:** https://github.com/averroes96/pointure/compare/v1.4.12...v1.5.0");
    });
  });
});

