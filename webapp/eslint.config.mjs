import reactPlugin from "eslint-plugin-react";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
  {
    files: ["front-end/react/**/*.{ts,tsx,jsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2021,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      react: reactPlugin,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "react/jsx-no-duplicate-props": "error",
      "react/react-in-jsx-scope": "off",
    },
  },
];
