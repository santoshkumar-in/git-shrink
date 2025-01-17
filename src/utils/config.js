import { cosmiconfig } from "cosmiconfig";

const explorer = cosmiconfig("gitshrink");

/**
 * Reads .gitshrinkrc / gitshrink key in package.json / gitshrink.config.js
 * Returns merged defaults + user config.
 */
export async function readConfig() {
  const defaults = {
    threshold: 60,
    minGroup:  2,
    count:     50,
  };

  try {
    const result = await explorer.search();
    if (result && result.config) {
      return { ...defaults, ...result.config };
    }
  } catch {
    // No config found — use defaults silently
  }

  return defaults;
}
