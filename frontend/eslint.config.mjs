import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * `next lint` and `eslint-config-next` were both installed, but no config file
 * existed — so linting silently did nothing. (`next lint` was also removed in
 * Next 16; `npm run lint` now calls eslint directly.)
 *
 * eslint-config-next v16 ships native flat configs, so these are spread in
 * directly rather than going through FlatCompat.
 *
 * The one custom rule is the hardcoded-colour ban. `styles/tokens.css` defines
 * `--text-inverse`, `--brand-on` and `--surface-canvas` precisely so light and
 * dark stay in step; ~17 call sites had drifted to `text-white` / `bg-white` /
 * raw hex, which look right in light mode and wrong in dark. Fixing those
 * without a rule just means fixing them again in six months.
 */
export default [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [".next/**", "node_modules/**", "out/**", "public/**"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/\\b(?:text|bg|border)-white\\b/]",
          message:
            "Use the theme tokens (--text-inverse, --brand-on, --surface-*) instead of a hardcoded white — a literal white does not flip in dark mode.",
        },
      ],
    },
  },
  {
    // Node-side tooling: console output is the product, not a smell.
    files: ["scripts/**/*.{ts,mjs,js}"],
    rules: { "no-console": "off" },
  },
];
