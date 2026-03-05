import js from "@eslint/js";
import globals from "globals";  

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