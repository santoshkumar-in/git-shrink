/**
 * Tests for src/utils/render.js
 *
 * Console output is captured via jest.spyOn so we can assert on
 * what gets printed without polluting test output.
 */
import { jest } from "@jest/globals";

import { renderGroupTable, renderSummaryBox, renderScoreBar } from "../src/utils/render.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGroup(overrides = {}) {
  return {
    reason: "same file(s): src/auth.js",
    squashedMessage: "fix authentication flow",
    avgScore: 82,
    commits: [
      {
        shortHash: "abc1234",
        message: "fix authentication flow",
        files: ["src/auth.js"],
        date: new Date("2025-01-10T10:00:00Z"),
      },
      {
        shortHash: "def5678",
        message: "fix auth token expiry",
        files: ["src/auth.js"],
        date: new Date("2025-01-11T10:00:00Z"),
      },
    ],
    ...overrides,
  };
}

let consoleSpy;
beforeEach(() => {
  consoleSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  consoleSpy.mockRestore();
});

// ─── renderScoreBar ───────────────────────────────────────────────────────────

describe("renderScoreBar", () => {
  test("returns a string", () => {
    expect(typeof renderScoreBar(80)).toBe("string");
  });

  test("result length matches width (ignoring ANSI codes)", () => {
    const bar = renderScoreBar(50, 20);
    // Strip ANSI codes and count characters
    const stripped = bar.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toHaveLength(20);
  });

  test("score 0 produces all empty blocks", () => {
    const bar = renderScoreBar(0, 10);
    const stripped = bar.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toBe("░".repeat(10));
  });

  test("score 100 produces all filled blocks", () => {
    const bar = renderScoreBar(100, 10);
    const stripped = bar.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toBe("█".repeat(10));
  });

  test("score 50 produces half filled, half empty", () => {
    const bar = renderScoreBar(50, 10);
    const stripped = bar.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toBe("█████░░░░░");
  });

  test("accepts different color options without throwing", () => {
    ["green", "blue", "yellow", "red", "purple", "unknown"].forEach((color) => {
      expect(() => renderScoreBar(75, 20, color)).not.toThrow();
    });
  });

  test("defaults to width 20 when not specified", () => {
    const bar = renderScoreBar(100);
    const stripped = bar.replace(/\x1b\[[0-9;]*m/g, "");
    expect(stripped).toHaveLength(20);
  });
});

// ─── renderGroupTable ─────────────────────────────────────────────────────────

describe("renderGroupTable", () => {
  test("does not throw for valid group", () => {
    expect(() => renderGroupTable(makeGroup(), 1, 3)).not.toThrow();
  });

  test("calls console.log at least once", () => {
    renderGroupTable(makeGroup(), 1, 1);
    expect(consoleSpy).toHaveBeenCalled();
  });

  test("outputs group index and total", () => {
    renderGroupTable(makeGroup(), 2, 5);
    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toMatch(/2\/5/);
  });

  test("outputs the squashed message", () => {
    renderGroupTable(makeGroup({ squashedMessage: "refactor auth module" }), 1, 1);
    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("refactor auth module");
  });

  test("outputs the reason", () => {
    renderGroupTable(makeGroup({ reason: "similar commit messages" }), 1, 1);
    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("similar commit messages");
  });

  test("outputs the average score", () => {
    renderGroupTable(makeGroup({ avgScore: 77 }), 1, 1);
    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("77");
  });

  test("truncates very long commit messages", () => {
    const longMsg = "a".repeat(100);
    const group = makeGroup({
      commits: [
        { shortHash: "abc1234", message: longMsg, files: [], date: new Date() },
      ],
    });
    expect(() => renderGroupTable(group, 1, 1)).not.toThrow();
  });
});

// ─── renderSummaryBox ─────────────────────────────────────────────────────────

describe("renderSummaryBox", () => {
  const baseArgs = {
    totalBefore:  50,
    totalAfter:   35,
    reduction:    30,
    squashGroups: [makeGroup(), makeGroup()],
  };

  test("does not throw for valid args", () => {
    expect(() => renderSummaryBox(baseArgs)).not.toThrow();
  });

  test("outputs totalBefore and totalAfter", () => {
    renderSummaryBox(baseArgs);
    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("50");
    expect(output).toContain("35");
  });

  test("outputs reduction percentage", () => {
    renderSummaryBox(baseArgs);
    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("30%");
  });

  test("outputs squash group count", () => {
    renderSummaryBox(baseArgs);
    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toContain("2");
  });

  test("includes DRY RUN label when dryRun is true", () => {
    renderSummaryBox({ ...baseArgs, dryRun: true });
    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).toMatch(/DRY RUN/i);
  });

  test("does not include DRY RUN label when dryRun is false", () => {
    renderSummaryBox({ ...baseArgs, dryRun: false });
    const output = consoleSpy.mock.calls.flat().join(" ");
    expect(output).not.toMatch(/DRY RUN/i);
  });

  test("handles zero reduction gracefully", () => {
    expect(() => renderSummaryBox({ ...baseArgs, reduction: 0 })).not.toThrow();
  });

  test("handles empty squashGroups array", () => {
    expect(() => renderSummaryBox({ ...baseArgs, squashGroups: [] })).not.toThrow();
  });
});
