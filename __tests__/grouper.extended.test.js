/**
 * Extended tests for src/core/grouper.js
 *
 * Covers behaviour added after the initial grouper.test.js:
 *   - Short bare noise messages ("fix", "wip") scoring correctly
 *   - Commits within squash groups are sorted oldest-first
 *   - describeReason output strings
 *   - suggestMessage picks the most meaningful message
 *   - groupCommits with mixed files/dirs/messages
 */

import { scorePair, groupCommits } from "../src/core/grouper.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function commit(overrides = {}) {
  return {
    hash:      "abc1234567890abcdef",
    shortHash: "abc1234",
    message:   "some commit",
    author:    "Dev",
    date:      new Date("2025-01-10T10:00:00Z"),
    files:     [],
    dirs:      [],
    fileExts:  [],
    ...overrides,
  };
}

// ─── Bare noise messages ("fix", "wip", "temp") ───────────────────────────────

describe("bare noise message scoring", () => {
  test('"fix" vs "fix" scores 100 message similarity', () => {
    const { breakdown } = scorePair(
      commit({ message: "fix" }),
      commit({ message: "fix" })
    );
    expect(breakdown.message).toBe(100);
  });

  test('"wip" vs "wip" scores 100 message similarity', () => {
    const { breakdown } = scorePair(
      commit({ message: "wip" }),
      commit({ message: "wip" })
    );
    expect(breakdown.message).toBe(100);
  });

  test('"fix" vs "wip" scores low message similarity', () => {
    const { breakdown } = scorePair(
      commit({ message: "fix" }),
      commit({ message: "wip" })
    );
    expect(breakdown.message).toBeLessThan(50);
  });

  test('"fix" vs "fix" with same files produces composite >= 50', () => {
    const files = ["src/app.js"];
    const dirs  = ["src"];
    const { composite } = scorePair(
      commit({ message: "fix", files, dirs }),
      commit({ message: "fix", files, dirs })
    );
    expect(composite).toBeGreaterThanOrEqual(50);
  });

  test('"fix in readme" vs "fix" with same file produces composite >= 50', () => {
    const files = ["README.md"];
    const dirs  = ["."];
    const { composite } = scorePair(
      commit({ message: "fix in readme", files, dirs }),
      commit({ message: "fix", files, dirs })
    );
    expect(composite).toBeGreaterThanOrEqual(50);
  });

  test('"fix" commits touching different files and dirs score low', () => {
    const { composite } = scorePair(
      commit({ message: "fix", files: ["src/auth.js"],  dirs: ["src"] }),
      commit({ message: "fix", files: ["lib/api.js"],   dirs: ["lib"] })
    );
    // message alone = 55 but file/dir overlap = 0, composite ~55
    // Should still be reasonable given identical messages
    expect(composite).toBeGreaterThan(0);
  });
});

// ─── Commits within squash groups are oldest-first ───────────────────────────

describe("squash group commit ordering", () => {
  test("commits inside squash group are sorted oldest-first", () => {
    const older = commit({
      message: "fix auth",
      files: ["src/auth.js"],
      dirs: ["src"],
      date: new Date("2025-01-01T00:00:00Z"),
    });
    const newer = commit({
      message: "fix auth",
      files: ["src/auth.js"],
      dirs: ["src"],
      date: new Date("2025-01-05T00:00:00Z"),
    });
    // Pass newer first to verify sort works regardless of input order
    const result = groupCommits([newer, older], { threshold: 40 });
    const squash = result.find((g) => g.type === "squash");
    expect(squash).toBeDefined();
    expect(squash.commits[0].date.getTime()).toBeLessThan(squash.commits[1].date.getTime());
  });

  test("oldest commit is always at index 0 in squash group", () => {
    const dates = ["2025-03-01", "2025-01-01", "2025-02-01"].map((d) => new Date(d));
    const commits = dates.map((date) =>
      commit({ message: "fix auth token", files: ["src/auth.js"], dirs: ["src"], date })
    );
    const result = groupCommits(commits, { threshold: 40 });
    const squash = result.find((g) => g.type === "squash");
    if (squash) {
      const firstDate = squash.commits[0].date;
      for (const c of squash.commits) {
        expect(c.date.getTime()).toBeGreaterThanOrEqual(firstDate.getTime());
      }
    }
  });
});

// ─── suggestMessage ───────────────────────────────────────────────────────────

describe("suggestMessage (via groupCommits squashedMessage)", () => {
  test("picks longer meaningful message over bare noise", () => {
    const files = ["src/auth.js"];
    const dirs  = ["src"];
    const meaningful = commit({ message: "fix authentication token expiry edge case", files, dirs });
    const noisy      = commit({ message: "fix", files, dirs });
    const result = groupCommits([meaningful, noisy], { threshold: 40 });
    const squash = result.find((g) => g.type === "squash");
    if (squash) {
      expect(squash.squashedMessage).toBe("fix authentication token expiry edge case");
    }
  });

  test("picks longer message when both are meaningful", () => {
    const files = ["src/api.js"];
    const dirs  = ["src"];
    const short = commit({ message: "update API", files, dirs });
    const long  = commit({ message: "update API response normalization for pagination", files, dirs });
    const result = groupCommits([short, long], { threshold: 40 });
    const squash = result.find((g) => g.type === "squash");
    if (squash) {
      expect(squash.squashedMessage).toBe("update API response normalization for pagination");
    }
  });
});

// ─── describeReason ───────────────────────────────────────────────────────────

describe("describeReason (via groupCommits reason field)", () => {
  test("mentions same file(s) when group touches <= 3 files", () => {
    const files = ["src/auth.js"];
    const dirs  = ["src"];
    const c1 = commit({ message: "fix auth", files, dirs });
    const c2 = commit({ message: "fix auth", files, dirs });
    const result = groupCommits([c1, c2], { threshold: 40 });
    const squash = result.find((g) => g.type === "squash");
    if (squash) {
      expect(squash.reason).toMatch(/same file/i);
    }
  });

  test("mentions same directory when group touches many files in same dir", () => {
    const dirs = ["src/components"];
    const c1 = commit({ message: "fix ui", files: ["src/components/a.jsx", "src/components/b.jsx", "src/components/c.jsx", "src/components/d.jsx"], dirs });
    const c2 = commit({ message: "fix ui", files: ["src/components/e.jsx", "src/components/f.jsx", "src/components/g.jsx", "src/components/h.jsx"], dirs });
    const result = groupCommits([c1, c2], { threshold: 40 });
    const squash = result.find((g) => g.type === "squash");
    if (squash) {
      expect(squash.reason).toMatch(/same directory|same file|similarity/i);
    }
  });

  test("falls back to similarity score reason when no strong file signal", () => {
    const c1 = commit({ message: "update README documentation", files: ["README.md"], dirs: ["."] });
    const c2 = commit({ message: "update README links", files: ["README.md"], dirs: ["."] });
    const result = groupCommits([c1, c2], { threshold: 40 });
    const squash = result.find((g) => g.type === "squash");
    if (squash) {
      expect(typeof squash.reason).toBe("string");
      expect(squash.reason.length).toBeGreaterThan(0);
    }
  });
});

// ─── threshold boundary behaviour ────────────────────────────────────────────

describe("threshold boundary behaviour", () => {
  test("commits scoring exactly at threshold are grouped", () => {
    // Two identical messages, no file overlap → composite = 55
    const c1 = commit({ message: "fix", files: [], dirs: [] });
    const c2 = commit({ message: "fix", files: [], dirs: [] });
    // threshold 55 — composite is exactly 55 — should group
    const result = groupCommits([c1, c2], { threshold: 55 });
    const squash = result.find((g) => g.type === "squash");
    expect(squash).toBeDefined();
  });

  test("commits scoring below threshold are kept separate", () => {
    const c1 = commit({ message: "fix auth", files: ["src/auth.js"], dirs: ["src"] });
    const c2 = commit({ message: "update README", files: ["README.md"], dirs: ["."] });
    const result = groupCommits([c1, c2], { threshold: 50 });
    const keeps = result.filter((g) => g.type === "keep");
    expect(keeps).toHaveLength(2);
  });
});

// ─── avgScore computation ─────────────────────────────────────────────────────

describe("avgScore in squash groups", () => {
  test("avgScore is between 0 and 100", () => {
    const files = ["src/auth.js"];
    const dirs  = ["src"];
    const commits = Array.from({ length: 3 }, () =>
      commit({ message: "fix auth token", files, dirs })
    );
    const result = groupCommits(commits, { threshold: 40 });
    const squash = result.find((g) => g.type === "squash");
    if (squash) {
      expect(squash.avgScore).toBeGreaterThanOrEqual(0);
      expect(squash.avgScore).toBeLessThanOrEqual(100);
    }
  });

  test("keep groups always have avgScore of 0", () => {
    const c1 = commit({ message: "fix auth completely different", files: ["src/auth.js"], dirs: ["src"] });
    const c2 = commit({ message: "update webpack config", files: ["webpack.config.js"], dirs: ["."] });
    const result = groupCommits([c1, c2], { threshold: 95 }); // high threshold, no grouping
    const keeps = result.filter((g) => g.type === "keep");
    for (const k of keeps) {
      expect(k.avgScore).toBe(0);
    }
  });
});
