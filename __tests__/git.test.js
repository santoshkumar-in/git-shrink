/**
 * Tests for src/core/git.js
 *
 * All simple-git calls are mocked — tests never touch a real git repo.
 * We test: getCommits, getCurrentBranch, getUpstreamRef,
 *          getUnpushedRange, hasNetChanges, generateRebaseScript.
 */

import { jest } from "@jest/globals";
import path from "path";
import os from "os";
import fs from "fs";

// ─── Mock simple-git ──────────────────────────────────────────────────────────

const mockGit = {
  checkIsRepo:  jest.fn(),
  log:          jest.fn(),
  raw:          jest.fn(),
  diffSummary:  jest.fn(),
  branchLocal:  jest.fn(),
};

jest.unstable_mockModule("simple-git", () => ({
  default: () => mockGit,
}));

const {
  getCommits,
  getCurrentBranch,
  getUpstreamRef,
  getUnpushedRange,
  hasNetChanges,
  generateRebaseScript,
} = await import("../src/core/git.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRawCommit(overrides = {}) {
  return {
    hash:         "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    author_name:  "Dev",
    author_email: "dev@example.com",
    date:         "2025-01-10 10:00:00 +0000",
    message:      "fix something",
    ...overrides,
  };
}

function makeGroup(overrides = {}) {
  return {
    type: "squash",
    squashedMessage: "fix something",
    commits: [
      { shortHash: "abc1234", message: "fix something" },
      { shortHash: "def5678", message: "fix something else" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGit.checkIsRepo.mockResolvedValue(true);
  mockGit.diffSummary.mockResolvedValue({ files: [] });
});

// ─── getCommits ───────────────────────────────────────────────────────────────

describe("getCommits", () => {
  test("throws if not a git repo", async () => {
    mockGit.checkIsRepo.mockResolvedValue(false);
    await expect(getCommits()).rejects.toThrow("Not a git repository");
  });

  test("default path: calls git.log with --max-count", async () => {
    mockGit.log.mockResolvedValue({ all: [makeRawCommit()] });
    await getCommits({ count: 10 });
    expect(mockGit.log).toHaveBeenCalledWith(
      expect.objectContaining({ "--max-count": "10" })
    );
  });

  test("default path: uses count 50 when not specified", async () => {
    mockGit.log.mockResolvedValue({ all: [makeRawCommit()] });
    await getCommits();
    expect(mockGit.log).toHaveBeenCalledWith(
      expect.objectContaining({ "--max-count": "50" })
    );
  });

  test("from/to path: calls git.log with from and to", async () => {
    mockGit.log.mockResolvedValue({ all: [makeRawCommit()] });
    await getCommits({ from: "abc123", to: "HEAD" });
    expect(mockGit.log).toHaveBeenCalledWith(
      expect.objectContaining({ from: "abc123", to: "HEAD" })
    );
  });

  test("from path: defaults to to HEAD when to is not specified", async () => {
    mockGit.log.mockResolvedValue({ all: [makeRawCommit()] });
    await getCommits({ from: "abc123" });
    expect(mockGit.log).toHaveBeenCalledWith(
      expect.objectContaining({ to: "HEAD" })
    );
  });

  test("branch path: uses git.raw with branch name", async () => {
    mockGit.raw.mockResolvedValue(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\x1fDev\x1fdev@x.com\x1f2025-01-10 10:00:00 +0000\x1ffix something"
    );
    await getCommits({ branch: "feature-x" });
    expect(mockGit.raw).toHaveBeenCalledWith(
      expect.arrayContaining(["log", "feature-x"])
    );
  });

  test("branch path: does not use branch path when branch is HEAD", async () => {
    mockGit.log.mockResolvedValue({ all: [makeRawCommit()] });
    await getCommits({ branch: "HEAD" });
    expect(mockGit.log).toHaveBeenCalled();
    expect(mockGit.raw).not.toHaveBeenCalled();
  });

  test("throws when no commits found", async () => {
    mockGit.log.mockResolvedValue({ all: [] });
    await expect(getCommits()).rejects.toThrow("No commits found");
  });

  test("returns correctly shaped commit objects", async () => {
    mockGit.log.mockResolvedValue({
      all: [makeRawCommit({ hash: "abcdef1234567890abcdef1234567890abcdef12", message: "  fix auth  " })],
    });
    mockGit.diffSummary.mockResolvedValue({
      files: [{ file: "src/auth.js" }, { file: "src/utils/token.js" }],
    });
    const commits = await getCommits();
    expect(commits).toHaveLength(1);
    const c = commits[0];
    expect(c.hash).toBe("abcdef1234567890abcdef1234567890abcdef12");
    expect(c.shortHash).toBe("abcdef1");
    expect(c.message).toBe("fix auth"); // trimmed
    expect(c.files).toEqual(["src/auth.js", "src/utils/token.js"]);
    expect(c.dirs).toEqual(["src", path.join("src", "utils")]);
    expect(c.fileExts).toEqual([".js"]);
    expect(c.date).toBeInstanceOf(Date);
  });

  test("handles first commit with no parent (diffSummary throws)", async () => {
    mockGit.log.mockResolvedValue({ all: [makeRawCommit()] });
    mockGit.diffSummary.mockRejectedValue(new Error("unknown revision"));
    const commits = await getCommits();
    expect(commits[0].files).toEqual([]);
  });

  test("deduplicates dirs from multiple files in same directory", async () => {
    mockGit.log.mockResolvedValue({ all: [makeRawCommit()] });
    mockGit.diffSummary.mockResolvedValue({
      files: [{ file: "src/a.js" }, { file: "src/b.js" }, { file: "src/c.js" }],
    });
    const commits = await getCommits();
    expect(commits[0].dirs).toEqual(["src"]);
  });

  test("deduplicates fileExts", async () => {
    mockGit.log.mockResolvedValue({ all: [makeRawCommit()] });
    mockGit.diffSummary.mockResolvedValue({
      files: [{ file: "a.js" }, { file: "b.js" }, { file: "c.ts" }],
    });
    const commits = await getCommits();
    expect(commits[0].fileExts).toEqual([".js", ".ts"]);
  });

  test("excludes files with no extension from fileExts", async () => {
    mockGit.log.mockResolvedValue({ all: [makeRawCommit()] });
    mockGit.diffSummary.mockResolvedValue({
      files: [{ file: "Makefile" }, { file: "src/a.js" }],
    });
    const commits = await getCommits();
    expect(commits[0].fileExts).toEqual([".js"]);
  });
});

// ─── getCurrentBranch ─────────────────────────────────────────────────────────

describe("getCurrentBranch", () => {
  test("returns the current branch name", async () => {
    mockGit.branchLocal.mockResolvedValue({ current: "main" });
    const branch = await getCurrentBranch();
    expect(branch).toBe("main");
  });

  test("returns feature branch names", async () => {
    mockGit.branchLocal.mockResolvedValue({ current: "feature/auth-redesign" });
    const branch = await getCurrentBranch();
    expect(branch).toBe("feature/auth-redesign");
  });
});

// ─── getUpstreamRef ───────────────────────────────────────────────────────────

describe("getUpstreamRef", () => {
  test("returns upstream ref when tracking branch is set", async () => {
    mockGit.raw.mockResolvedValue("origin/main\n");
    const ref = await getUpstreamRef();
    expect(ref).toBe("origin/main");
  });

  test("returns null when no tracking branch is configured", async () => {
    mockGit.raw.mockRejectedValue(new Error("no upstream"));
    const ref = await getUpstreamRef();
    expect(ref).toBeNull();
  });

  test("returns null when raw returns empty string", async () => {
    mockGit.raw.mockResolvedValue("   ");
    const ref = await getUpstreamRef();
    expect(ref).toBeNull();
  });
});

// ─── getUnpushedRange ─────────────────────────────────────────────────────────

describe("getUnpushedRange", () => {
  test("returns range when unpushed commits exist", async () => {
    // First raw call: getUpstreamRef, second: rev-list --count
    mockGit.raw
      .mockResolvedValueOnce("origin/main\n")
      .mockResolvedValueOnce("4\n");

    const range = await getUnpushedRange();
    expect(range).toEqual({ from: "origin/main", to: "HEAD", count: 4 });
  });

  test("returns null when no upstream is configured", async () => {
    mockGit.raw.mockRejectedValue(new Error("no upstream"));
    const range = await getUnpushedRange();
    expect(range).toBeNull();
  });

  test("returns null when all commits are pushed (count = 0)", async () => {
    mockGit.raw
      .mockResolvedValueOnce("origin/main\n")
      .mockResolvedValueOnce("0\n");
    const range = await getUnpushedRange();
    expect(range).toBeNull();
  });

  test("returns null when rev-list throws", async () => {
    mockGit.raw
      .mockResolvedValueOnce("origin/main\n")
      .mockRejectedValueOnce(new Error("rev-list failed"));
    const range = await getUnpushedRange();
    expect(range).toBeNull();
  });
});

// ─── hasNetChanges ────────────────────────────────────────────────────────────

describe("hasNetChanges", () => {
  test("returns true when files changed between oldest and newest", async () => {
    mockGit.raw.mockResolvedValue("parenthash\n");
    mockGit.diffSummary.mockResolvedValue({ files: [{ file: "src/a.js" }] });
    const result = await hasNetChanges(["oldhash", "newhash"]);
    expect(result).toBe(true);
  });

  test("returns false when net diff is empty (commits cancel out)", async () => {
    mockGit.raw.mockResolvedValue("parenthash\n");
    mockGit.diffSummary.mockResolvedValue({ files: [] });
    const result = await hasNetChanges(["oldhash", "newhash"]);
    expect(result).toBe(false);
  });

  test("returns true when oldest is root commit (raw throws)", async () => {
    // When oldest^ fails, falls back to comparing oldest itself
    mockGit.raw.mockRejectedValue(new Error("no parent"));
    mockGit.diffSummary.mockResolvedValue({ files: [{ file: "src/a.js" }] });
    const result = await hasNetChanges(["roothash", "newhash"]);
    expect(result).toBe(true);
  });

  test("returns true (safe default) when diffSummary throws", async () => {
    mockGit.raw.mockResolvedValue("parenthash\n");
    mockGit.diffSummary.mockRejectedValue(new Error("diff failed"));
    const result = await hasNetChanges(["oldhash", "newhash"]);
    expect(result).toBe(true);
  });

  test("works with single-element hash array", async () => {
    mockGit.raw.mockResolvedValue("parenthash\n");
    mockGit.diffSummary.mockResolvedValue({ files: [] });
    const result = await hasNetChanges(["onlyhash"]);
    expect(result).toBe(false);
  });
});

// ─── generateRebaseScript ─────────────────────────────────────────────────────

describe("generateRebaseScript", () => {
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `git-shrink-test-${Date.now()}.txt`);
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpFile); } catch {}
  });

  test("writes pick for solo keep group", async () => {
    const groups = [makeGroup({
      type: "keep",
      commits: [{ shortHash: "abc1234", message: "fix auth" }],
    })];
    await generateRebaseScript(groups, tmpFile);
    const content = fs.readFileSync(tmpFile, "utf8");
    expect(content).toContain("pick abc1234 fix auth");
  });

  test("writes pick + squash for squash group", async () => {
    const groups = [makeGroup({
      type: "squash",
      squashedMessage: "fix something",
      commits: [
        { shortHash: "aaa1111", message: "fix something" },
        { shortHash: "bbb2222", message: "fix something else" },
      ],
    })];
    await generateRebaseScript(groups, tmpFile);
    const content = fs.readFileSync(tmpFile, "utf8");
    expect(content).toContain("pick aaa1111 fix something");
    expect(content).toContain("squash bbb2222 fix something else");
  });

  test("uses squashedMessage as pick message for squash group", async () => {
    const groups = [makeGroup({
      type: "squash",
      squashedMessage: "Integrate OAuth2 authentication",
      commits: [
        { shortHash: "aaa1111", message: "wip" },
        { shortHash: "bbb2222", message: "fix auth" },
      ],
    })];
    await generateRebaseScript(groups, tmpFile);
    const content = fs.readFileSync(tmpFile, "utf8");
    expect(content).toContain("pick aaa1111 Integrate OAuth2 authentication");
  });

  test("writes drop for all commits in drop group", async () => {
    const groups = [makeGroup({
      type: "drop",
      commits: [
        { shortHash: "aaa1111", message: "add debug logs" },
        { shortHash: "bbb2222", message: "remove debug logs" },
      ],
    })];
    await generateRebaseScript(groups, tmpFile);
    const content = fs.readFileSync(tmpFile, "utf8");
    expect(content).toContain("drop aaa1111 add debug logs");
    expect(content).toContain("drop bbb2222 remove debug logs");
    expect(content).not.toContain("pick");
    expect(content).not.toContain("squash");
  });

  test("inserts blank line between groups for readability", async () => {
    const groups = [
      makeGroup({ type: "keep", commits: [{ shortHash: "aaa1111", message: "fix auth" }] }),
      makeGroup({ type: "keep", commits: [{ shortHash: "bbb2222", message: "fix nav" }] }),
    ];
    await generateRebaseScript(groups, tmpFile);
    const content = fs.readFileSync(tmpFile, "utf8");
    expect(content).toContain("pick aaa1111 fix auth\n\npick bbb2222 fix nav");
  });

  test("handles multiple groups with mixed types", async () => {
    const groups = [
      makeGroup({ type: "keep",   commits: [{ shortHash: "aaa1111", message: "setup" }] }),
      makeGroup({ type: "squash", squashedMessage: "fix auth", commits: [
        { shortHash: "bbb2222", message: "fix auth" },
        { shortHash: "ccc3333", message: "fix auth typo" },
      ]}),
      makeGroup({ type: "drop",   commits: [{ shortHash: "ddd4444", message: "add logs" }] }),
    ];
    await generateRebaseScript(groups, tmpFile);
    const content = fs.readFileSync(tmpFile, "utf8");
    expect(content).toContain("pick aaa1111");
    expect(content).toContain("pick bbb2222");
    expect(content).toContain("squash ccc3333");
    expect(content).toContain("drop ddd4444");
  });

  test("returns the output path", async () => {
    const groups = [makeGroup({ type: "keep", commits: [{ shortHash: "aaa1111", message: "x" }] })];
    const result = await generateRebaseScript(groups, tmpFile);
    expect(result).toBe(tmpFile);
  });
});
