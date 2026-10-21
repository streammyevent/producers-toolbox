import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import tseslint from "typescript-eslint";

const SMOELENBOEK = "tools/smoelenboek/web/js";

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/out/**",
    "**/node_modules/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/vendor/**",
    ".turbo/**",
  ]),
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js },
    extends: ["js/recommended"],
    rules: {
      // An empty catch is how this code says "best effort, ignore failure"
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["error", { caughtErrors: "none" }],
    },
  },

  // ---- TypeScript: the shell (compiled to out/ by tsc, which also type-checks it) ----
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // api.js modules are loaded at runtime from the tool folders
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // The contract file declares globals for tool pages (Window, Toolbox, ...)
    files: ["**/*.d.ts"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },

  // ---- Node: the shell's scripts and tests, tool main-process code, repo scripts ----
  {
    files: [
      "apps/desktop/{build,scripts,tests}/**/*.js",
      "tools/*/api.js",
      "tools/*/lib/**/*.js",
      "tools/*/tests/**/*.js",
      "scripts/**/*.js",
    ],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
  },
  {
    // Callbacks passed to page.evaluate run in the browser
    files: ["apps/desktop/tests/e2e/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },

  // ---- Browser: launcher and tool pages are classic <script> tags that share globals ----
  {
    files: ["apps/desktop/src/renderer/**/*.js", "tools/*/web/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser } },
    // Top-level classes/consts are consumed by other scripts, so they look unused here
    rules: { "no-unused-vars": ["error", { vars: "local", caughtErrors: "none" }] },
  },
  {
    // Loaded by the page and by the Node tests
    files: ["tools/quote-pricer/web/calc.js", "tools/content-card-studio/web/js/name-match.js"],
    languageOptions: { globals: { module: "writable" } },
  },
  {
    files: ["tools/content-card-studio/web/app.js"],
    languageOptions: {
      globals: {
        QRCode: "readonly",
        html2canvas: "readonly",
        // Defined in web/js/name-match.js
        NameMatch: "readonly",
      },
    },
    // ponytail: warnings until this file is split up and cleaned during the move to the tool contract
    rules: {
      "no-unused-vars": ["warn", { vars: "local", caughtErrors: "none" }],
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
    },
  },

  // ---- Smoelenboek: a shared global is declared only in files that consume it, never where it is defined ----
  {
    files: [`${SMOELENBOEK}/sync-folder.js`],
    languageOptions: {
      globals: {
        // Defined in util.js
        isSyncFileName: "readonly",
        normalizeSyncConfig: "readonly",
        SYNC_MAX_BYTES: "readonly",
        SYNC_SUBFOLDER: "readonly",
      },
    },
  },
  {
    files: [`${SMOELENBOEK}/sync-controller.js`],
    languageOptions: {
      globals: {
        // Defined in util.js
        csvQuote: "readonly",
        escapeHtml: "readonly",
        normalizeProject: "readonly",
        stripSecretFields: "readonly",
        syncFileName: "readonly",
        // Defined in sync-folder.js
        syncErrorMessage: "readonly",
      },
    },
  },
  {
    // SpeakerDirectoryApp mixins: each adds methods to the class defined in app-core.js
    files: [`${SMOELENBOEK}/app-*.js`],
    ignores: [`${SMOELENBOEK}/app-core.js`],
    languageOptions: { globals: { SpeakerDirectoryApp: "readonly" } },
  },
  {
    files: [`${SMOELENBOEK}/app-projects.js`],
    languageOptions: {
      globals: {
        INITIAL_SPEAKERS: "readonly",
        // Defined in util.js
        escapeHtml: "readonly",
        cleanText: "readonly",
        FIELD_LIMITS: "readonly",
        DEFAULT_PROJECT_TITLE: "readonly",
        normalizeSpeakers: "readonly",
        normalizeMicInventory: "readonly",
        normalizeProjects: "readonly",
      },
    },
  },
  {
    files: [`${SMOELENBOEK}/app-speakers.js`],
    languageOptions: {
      globals: {
        // Defined in util.js
        escapeHtml: "readonly",
        safeUrl: "readonly",
        safeMicType: "readonly",
        defaultAvatarUrl: "readonly",
        normalizeSpeaker: "readonly",
      },
    },
  },
  {
    files: [`${SMOELENBOEK}/app-mics.js`],
    languageOptions: {
      globals: {
        // Defined in util.js
        escapeHtml: "readonly",
        safeMicType: "readonly",
        cleanText: "readonly",
        FIELD_LIMITS: "readonly",
      },
    },
  },
  {
    files: [`${SMOELENBOEK}/app-photos.js`],
    languageOptions: {
      globals: {
        // Defined in util.js
        escapeHtml: "readonly",
        safeUrl: "readonly",
        defaultAvatarUrl: "readonly",
        // Defined in secrets.js
        SecretStore: "readonly",
        SECRET_NAMES: "readonly",
        // Defined in app-core.js
        GSEARCH_CX_KEY: "readonly",
      },
    },
  },
  {
    files: [`${SMOELENBOEK}/app-print.js`],
    languageOptions: {
      globals: {
        // Defined in util.js
        escapeHtml: "readonly",
        safeUrl: "readonly",
        defaultAvatarUrl: "readonly",
      },
    },
  },
  {
    files: [`${SMOELENBOEK}/app-io.js`],
    languageOptions: {
      globals: {
        // Defined in util.js
        cleanText: "readonly",
        FIELD_LIMITS: "readonly",
        normalizeSpeakers: "readonly",
        normalizeMicInventory: "readonly",
        parseCsv: "readonly",
        csvQuote: "readonly",
        csvUnescapeFormula: "readonly",
        stripSecretFields: "readonly",
      },
    },
  },
  {
    files: [`${SMOELENBOEK}/app-ui.js`],
    languageOptions: {
      globals: {
        // Defined in util.js
        defaultAvatarUrl: "readonly",
      },
    },
  },
  {
    files: [`${SMOELENBOEK}/main.js`],
    languageOptions: {
      globals: {
        // Defined in secrets.js
        SecretStore: "readonly",
        // Defined in sync-controller.js
        SyncFolderController: "readonly",
        SyncFolderService: "readonly",
        // Defined in app-core.js
        SpeakerDirectoryApp: "readonly",
        // Defined in app-ui.js
        initDesktopAppIntegration: "readonly",
      },
    },
  },
  {
    // Playwright tests and config run in Node (CommonJS). Callbacks passed to page.evaluate/addInitScript run in
    // the browser, hence the browser globals and the renderer globals they use (`app`, the seed, util.js helpers).
    files: ["tools/smoelenboek/tests/**/*.js", "tools/smoelenboek/playwright.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.browser,
        app: "readonly",
        SpeakerDirectoryApp: "readonly",
        SyncFolderController: "readonly",
        SyncFolderService: "readonly",
        INITIAL_SPEAKERS: "readonly",
        escapeHtml: "readonly",
        safeUrl: "readonly",
        safeMicType: "readonly",
        defaultAvatarUrl: "readonly",
        normalizeSpeakers: "readonly",
        parseCsv: "readonly",
        csvQuote: "readonly",
        csvUnescapeFormula: "readonly",
        stripSecretFields: "readonly",
        isSyncFileName: "readonly",
        syncFileName: "readonly",
        normalizeSyncConfig: "readonly",
        SecretStore: "readonly",
        SECRET_NAMES: "readonly",
      },
    },
  },
  { files: ["eslint.config.mjs"], languageOptions: { sourceType: "module", globals: { ...globals.node } } },
  eslintConfigPrettier,
]);
