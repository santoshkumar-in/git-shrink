/**
 * Tests for src/utils/config.js
 *
 * cosmiconfig is mocked to test config merging, defaults, and error handling
 * without needing real config files on disk.
 */

import { jest } from "@jest/globals";

// ─── Mock cosmiconfig ─────────────────────────────────────────────────────────

const mockSearch = jest.fn();

jest.unstable_mockModule("cosmiconfig", () => ({
  cosmiconfig: () => ({ search: mockSearch }),
}));

const { readConfig } = await import("../src/utils/config.js");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("readConfig", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("defaults", () => {
    test("returns all default values when no config file found", async () => {
      mockSearch.mockResolvedValue(null);
      const config = await readConfig();
      expect(config).toEqual({
        threshold:   50,
        minGroup:    2,
        count:       50,
        cleanupPlan: true,
      });
    });

    test("returns defaults when cosmiconfig throws", async () => {
      mockSearch.mockRejectedValue(new Error("parse error"));
      const config = await readConfig();
      expect(config.threshold).toBe(50);
      expect(config.minGroup).toBe(2);
      expect(config.count).toBe(50);
      expect(config.cleanupPlan).toBe(true);
    });

    test("returns defaults when config file has empty config object", async () => {
      mockSearch.mockResolvedValue({ config: {} });
      const config = await readConfig();
      expect(config.threshold).toBe(50);
      expect(config.cleanupPlan).toBe(true);
    });
  });

  describe("config file merging", () => {
    test("user config overrides defaults", async () => {
      mockSearch.mockResolvedValue({
        config: { threshold: 70, minGroup: 3 },
      });
      const config = await readConfig();
      expect(config.threshold).toBe(70);
      expect(config.minGroup).toBe(3);
    });

    test("unspecified fields retain defaults", async () => {
      mockSearch.mockResolvedValue({
        config: { threshold: 80 },
      });
      const config = await readConfig();
      expect(config.threshold).toBe(80);
      expect(config.minGroup).toBe(2);    // default retained
      expect(config.count).toBe(50);     // default retained
      expect(config.cleanupPlan).toBe(true); // default retained
    });

    test("cleanupPlan can be overridden to false", async () => {
      mockSearch.mockResolvedValue({
        config: { cleanupPlan: false },
      });
      const config = await readConfig();
      expect(config.cleanupPlan).toBe(false);
    });

    test("all fields can be overridden simultaneously", async () => {
      mockSearch.mockResolvedValue({
        config: { threshold: 65, minGroup: 4, count: 100, cleanupPlan: false },
      });
      const config = await readConfig();
      expect(config).toEqual({
        threshold:   65,
        minGroup:    4,
        count:       100,
        cleanupPlan: false,
      });
    });

    test("extra config keys are passed through", async () => {
      mockSearch.mockResolvedValue({
        config: { threshold: 60, customKey: "value" },
      });
      const config = await readConfig();
      expect(config.customKey).toBe("value");
    });
  });
});
