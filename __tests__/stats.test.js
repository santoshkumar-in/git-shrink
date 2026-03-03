/**
 * Tests for src/commands/stats.js
 *
 * getCommits (git.js) and ora are mocked so stats logic can be tested
 * in isolation without a real repo.
 */

import { jest } from "@jest/globals";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockGetCommits = jest.fn();
jest.unstable_mockModule("../src/core/git.js", () => ({
  getCommits: mockGetCommits,
}));

const mockSpinner = {
  start: jest.fn().mockReturnThis(),
  stop:  jest.fn().mockReturnThis(),
  fail:  jest.fn().mockReturnThis(),
};
jest.unstable_mockModule("ora", () => ({
  default: () => mockSpinner,
}));

const { statsCommand } = await import("../src/commands/stats.js");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCommit(overrides = {}) {
  return {
    hash:      "abc1234567890",
    shortHash: "abc1234",
    message:   "implement feature",
    author:    "Dev One",
    date:      new Date("2025-01-10"),
    files:     ["src/auth.js", "src/utils.js"],
    dirs:      ["src"],
    fileExts:  [".js"],
    ...overrides,
  };
}

let consoleSpy, exitSpy;
beforeEach(() => {
  jest.clearAllMocks();
  consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  exitSpy    = jest.spyOn(process, "exit").mockImplementation(() => { throw new Error("process.exit"); });
});
afterEach(() => {
  consoleSpy.mockRestore();
  exitSpy.mockRestore();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("statsCommand", () => {
  describe("error handling", () => {
    test("calls process.exit(1) when getCommits throws", async () => {
      mockGetCommits.mockRejectedValue(new Error("not a git repo"));
      await expect(statsCommand({ count: "10" })).rejects.toThrow("process.exit");
      expect(mockSpinner.fail).toHaveBeenCalled();
    });
  });

  describe("output", () => {
    test("does not throw for a clean commit set", async () => {
      mockGetCommits.mockResolvedValue([
        makeCommit({ message: "implement OAuth2 authentication" }),
        makeCommit({ message: "add user profile page", author: "Dev Two" }),
        makeCommit({ message: "refactor database layer" }),
      ]);
      await expect(statsCommand({ count: "10" })).resolves.not.toThrow();
    });

    test("calls getCommits with the specified count", async () => {
      mockGetCommits.mockResolvedValue([makeCommit()]);
      await statsCommand({ count: "25" });
      expect(mockGetCommits).toHaveBeenCalledWith({ count: 25 });
    });

    test("defaults to count 100 when not specified", async () => {
      mockGetCommits.mockResolvedValue([makeCommit()]);
      await statsCommand({});
      expect(mockGetCommits).toHaveBeenCalledWith({ count: 100 });
    });
  });

  describe("noisy commit detection", () => {
    test("identifies noisy commit messages", async () => {
      mockGetCommits.mockResolvedValue([
        makeCommit({ message: "fix" }),
        makeCommit({ message: "wip" }),
        makeCommit({ message: "temp" }),
        makeCommit({ message: "implement real feature" }),
      ]);
      await statsCommand({ count: "10" });
      const output = consoleSpy.mock.calls.flat().join("\n");
      // noisy commits should be reported (3 out of 4)
      expect(output).toContain("fix");
    });

    test("prints recommendation when noise ratio > 25%", async () => {
      const commits = [
        makeCommit({ message: "wip" }),
        makeCommit({ message: "fix" }),
        makeCommit({ message: "test" }),
        makeCommit({ message: "implement feature" }),
      ];
      mockGetCommits.mockResolvedValue(commits);
      await statsCommand({ count: "10" });
      const output = consoleSpy.mock.calls.flat().join("\n");
      expect(output).toContain("git-shrink analyze");
    });

    test("prints clean message when noise ratio <= 25%", async () => {
      mockGetCommits.mockResolvedValue([
        makeCommit({ message: "implement OAuth2 authentication" }),
        makeCommit({ message: "add user profile settings page" }),
        makeCommit({ message: "refactor API response normalization" }),
        makeCommit({ message: "fix" }), // 1 noisy out of 4 = 25%
      ]);
      await statsCommand({ count: "10" });
      const output = consoleSpy.mock.calls.flat().join("\n");
      expect(output).toMatch(/clean/i);
    });
  });

  describe("author breakdown", () => {
    test("groups commits by author correctly", async () => {
      mockGetCommits.mockResolvedValue([
        makeCommit({ author: "Alice" }),
        makeCommit({ author: "Alice" }),
        makeCommit({ author: "Bob" }),
      ]);
      await statsCommand({ count: "10" });
      const output = consoleSpy.mock.calls.flat().join("\n");
      expect(output).toContain("Alice");
      expect(output).toContain("Bob");
    });
  });

  describe("hot directories", () => {
    test("surfaces frequently touched directories", async () => {
      mockGetCommits.mockResolvedValue([
        makeCommit({ dirs: ["src/auth"] }),
        makeCommit({ dirs: ["src/auth"] }),
        makeCommit({ dirs: ["src/api"] }),
      ]);
      await statsCommand({ count: "10" });
      const output = consoleSpy.mock.calls.flat().join("\n");
      expect(output).toContain("src/auth");
    });

    test("excludes root dir (.) from hot directories", async () => {
      mockGetCommits.mockResolvedValue([
        makeCommit({ dirs: ["."] }),
        makeCommit({ dirs: ["."] }),
        makeCommit({ dirs: ["src"] }),
      ]);
      await statsCommand({ count: "10" });
      const output = consoleSpy.mock.calls.flat().join("\n");
      // Root "." should not show as a hot directory
      const dirSection = output.split("Hot Directories")[1] || "";
      expect(dirSection).not.toMatch(/^\s*\.\s/m);
    });
  });

  describe("health score", () => {
    test("does not throw for all-noisy commits", async () => {
      const noisyCommits = Array.from({ length: 10 }, () =>
        makeCommit({ message: "wip" })
      );
      mockGetCommits.mockResolvedValue(noisyCommits);
      await expect(statsCommand({ count: "10" })).resolves.not.toThrow();
    });

    test("does not throw for all-clean commits", async () => {
      const cleanCommits = Array.from({ length: 10 }, (_, i) =>
        makeCommit({ message: `implement feature number ${i} properly` })
      );
      mockGetCommits.mockResolvedValue(cleanCommits);
      await expect(statsCommand({ count: "10" })).resolves.not.toThrow();
    });

    test("does not throw for large commits (>15 files)", async () => {
      mockGetCommits.mockResolvedValue([
        makeCommit({
          message: "massive refactor",
          files: Array.from({ length: 20 }, (_, i) => `src/file${i}.js`),
        }),
      ]);
      await expect(statsCommand({ count: "10" })).resolves.not.toThrow();
    });
  });
});
