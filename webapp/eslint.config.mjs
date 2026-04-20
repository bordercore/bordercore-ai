import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    files: ["front-end/react/**/*.{ts,tsx,jsx}"],
    languageOptions: {
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
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "react/jsx-no-duplicate-props": "error",
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Underscore-prefixed identifiers are the convention for intentionally
      // unused values (callback args, destructures, caught errors).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // Allow `declare namespace` for JSX intrinsic-element augmentation
      // (the canonical pattern for typing web components).
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
      // Not a bug; type-laziness debt. Keep visible as a warning so it's
      // fixable incrementally without blocking CI.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  }
);
