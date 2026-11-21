import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

export default [
  { ignores: [".next", "dist", "coverage", "worker", "docs", ".railway"] },
  {
    files: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
    ignores: ["src/server/**", "test/server/**"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parser: tseslint.parser,
      globals: { ...globals.browser, process: "readonly" },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      react,
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_" },
      ],
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "error",
      "@next/next/no-img-element": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["src/server/**/*.ts", "test/server/**/*.ts", "server.ts", "next.config.ts", "vitest.config.ts", "eslint.config.ts", "release.config.ts"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parser: tseslint.parser,
      globals: globals.node,
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      ...js.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_", caughtErrors: "all", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
