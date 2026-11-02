import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";
import reactHooks from "eslint-plugin-react-hooks";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";

export default tseslint.config(
  {
    ignores: [
      // `**/` needed: bare `dist/**` misses packages/*/dist, linting emitted .d.ts as source.
      "**/dist/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "apps/worker/src/worker-env.d.ts",
      "worker-configuration.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    plugins: { "import-x": importX, "react-hooks": reactHooks },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({ project: "./tsconfig.json" }),
      ],
    },
    rules: {
      // TS resolves identifiers correctly (incl. types, `declare`, lib globals); this is redundant and worse.
      "no-undef": "off",

      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          caughtErrors: "none",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],

      // Not core `no-duplicate-imports`: it's type-blind, flags `import {X}` + `import type {Y}` split as dupe.
      "import-x/no-duplicates": "error",
      "import-x/no-self-import": "error",
      "import-x/no-cycle": "error",

      "max-lines": [
        "error",
        { max: 400, skipBlankLines: true, skipComments: true },
      ],

      "react-hooks/exhaustive-deps": "error",

      // Fires on emoji/variation-selector stripping in finding-title normalizer; that's intentional, test-pinned.
      "no-misleading-character-class": "off",

      // Deliberate at provider/DB boundaries with unknown shape until parsed; ~100 suppressions otherwise.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  {
    files: ["apps/dashboard/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "error",

      // Zone block at file bottom only covers packages/**+apps/**, so it can't catch this direction.
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "apps/dashboard/**/*",
              from: ["packages/core/**/*", "apps/worker/**/*"],
              message:
                "The review engine and the Worker tree are server-only. Importing either pulls zod/jsonrepair/picomatch into the browser bundle -- exactly what the `vite build` CI step exists to catch. (@codraoss/schema/review-limits is the sanctioned client-side import.)",
            },
          ],
        },
      ],
    },
  },

  {
    // vi.mock() intercepts these specifiers by string; list both `@alias/...` and `**/dir/...` forms since sibling imports and tsconfig-alias imports otherwise bypass it.
    files: ["apps/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/db/jobs-*", "@codraoss/db/jobs-*"],
              message:
                "Import from @codraoss/db/jobs, not a sibling. Eight specs vi.mock that specifier; a direct sibling import silently bypasses the mock.",
            },
            {
              group: ["**/db/file-reviews-*", "@codraoss/db/file-reviews-*"],
              message:
                "Import from @codraoss/db/file-reviews, not a sibling. (No spec mocks this one today; the rule keeps the barrel the single entry point.)",
            },
            {
              group: [
                "**/services/model-review-*",
                "**/services/model-rate-limits",
                "**/services/model-chain-runner",
                "**/services/model-support",
                "@codraoss/models-*",
              ],
              message:
                "Import from @codraoss/models, not a sibling. Four specs vi.mock that specifier.",
            },
            {
              group: [
                "**/provider-github/src/http",
                "**/provider-github/src/app-auth",
                "**/provider-github/src/types",
                "**/provider-github/src/diff-fetch",
                "**/provider-github/src/review-post",
                "**/provider-github/src/labels",
              ],
              message:
                "Import from @codraoss/provider-github, not a sibling module. One spec vi.mocks that specifier. (oauth is deliberately NOT listed: it is the dashboard OAuth flow, not part of the GitHubClient barrel.)",
            },
            {
              group: [
                "**/core/review/*",
                "@server/core/review/*",
                "@codraoss/core/review/*",
              ],
              message:
                "Import from @server/core/review, not a sibling. One spec vi.mocks that specifier and workflows/review.ts imports only runReviewJob from it.",
            },
            {
              group: [
                "**/core/model-output/*",
                "@server/core/model-output/*",
                "@codraoss/core/model-output/*",
              ],
              message:
                "Import from @codraoss/core/model-output, not a sibling. (The package exports map already refuses to resolve these; the lint rule gives the error at edit time.)",
            },
            {
              group: [
                "**/core/diff/position",
                "@server/core/diff/position",
                "@codraoss/core/diff/position",
              ],
              message: "Import from @codraoss/core/diff, not a sibling.",
            },
            {
              group: [
                "**/schema-claims",
                "**/schema-repo-config",
                "**/schema-enums",
                "@codraoss/schema/schema-claims",
                "@codraoss/schema/schema-repo-config",
                "@codraoss/schema/schema-enums",
              ],
              message:
                "Import from @codraoss/schema, not a sibling. (@codraoss/schema/review-limits is exempt: the client imports it directly to keep zod out of the browser bundle.)",
            },
          ],
        },
      ],
    },
  },
  {
    // auth.spec.ts (422 lines): suites read-modify-write singleton global_settings, racing under fileParallelism (see DO-NOT-SPLIT header there). Delete entry, don't raise max, once split.
    files: ["test/api/auth.spec.ts"],
    rules: {
      "max-lines": "off",
    },
  },

  {
    files: ["packages/schema/src/schema.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },

  {
    files: ["scripts/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        __dirname: "readonly",
      },
    },
  },

  {
    files: ["packages/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}"],
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              // `src/**` in `from` catches a moved file that kept its old `@server/*` import (re-coupling).
              target: "packages/schema/**/*",
              from: [
                "test/**/*",
                "scripts/**/*",
                "packages/core/**/*",
                "packages/provider-github/**/*",
                "packages/db/**/*",
                "packages/models/**/*",
                "packages/api/**/*",
                "packages/ui/**/*",
                "apps/worker/**/*",
                "apps/dashboard/**/*",
              ],
            },
            {
              target: "packages/core/**/*",
              from: [
                "test/**/*",
                "scripts/**/*",
                "packages/provider-github/**/*",
                "packages/db/**/*",
                "packages/models/**/*",
                "packages/api/**/*",
                "packages/ui/**/*",
                "apps/worker/**/*",
                "apps/dashboard/**/*",
              ],
            },
            {
              target: "packages/db/**/*",
              from: [
                "packages/provider-github/**/*",
                "packages/models/**/*",
                "packages/api/**/*",
                "packages/ui/**/*",
                "apps/worker/**/*",
                "apps/dashboard/**/*",
              ],
            },
            {
              target: "packages/provider-github/**/*",
              from: [
                "packages/db/**/*",
                "packages/models/**/*",
                "packages/api/**/*",
                "packages/ui/**/*",
                "apps/worker/**/*",
                "apps/dashboard/**/*",
              ],
            },
            {
              target: "packages/models/**/*",
              from: [
                "packages/db/**/*",
                "packages/provider-github/**/*",
                "packages/api/**/*",
                "packages/ui/**/*",
                "apps/worker/**/*",
                "apps/dashboard/**/*",
              ],
            },
            {
              target: "packages/api/**/*",
              from: [
                "packages/ui/**/*",
                "apps/worker/**/*",
                "apps/dashboard/**/*",
              ],
            },
            {
              target: "packages/ui/**/*",
              from: [
                "packages/core/**/*",
                "packages/provider-github/**/*",
                "packages/db/**/*",
                "packages/models/**/*",
                "packages/api/**/*",
                "apps/worker/**/*",
                "apps/dashboard/**/*",
              ],
            },
            {
              target: "apps/dashboard/**/*",
              from: [
                "packages/core/**/*",
                "packages/provider-github/**/*",
                "packages/db/**/*",
                "packages/models/**/*",
                "packages/api/**/*",
                "apps/worker/**/*",
              ],
            },
            {
              target: "apps/worker/**/*",
              from: ["packages/ui/**/*", "apps/dashboard/**/*"],
            },
          ],
        },
      ],
    },
  },
);
