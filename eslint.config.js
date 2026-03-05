// eslint.config.js
import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node
      },
    },
    rules: {
      // your custom rules here
      "no-unused-vars": "warn",
      "no-console": "off",
    },
  },
];