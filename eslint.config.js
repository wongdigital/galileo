import jsxA11y from 'eslint-plugin-jsx-a11y'
import babelParser from '@babel/eslint-parser'
import globals from 'globals'

/**
 * A11y-only lint gate.
 *
 * This config exists for one job: keep the Standard (AA) accessibility work
 * (see docs/A11Y-DECISIONS.md, docs/EXCEPTIONS.md) from silently regressing as
 * the renderer changes. It is deliberately NOT a general-purpose lint setup —
 * correctness and style are the compiler's and the tests' job. Only
 * eslint-plugin-jsx-a11y rules run here.
 *
 * Parser note: the renderer is TSX, but this uses @babel/eslint-parser rather
 * than typescript-eslint. The repo pins typescript@7 (the native compiler),
 * which typescript-eslint's peer range excludes and whose JS-API compatibility
 * with typescript-estree is unproven. Babel parses TSX (types + JSX) from its
 * own grammar with no dependency on the `typescript` package, so the lint gate
 * stays decoupled from the TS7 pin (see CLAUDE.md "Gotchas"). jsx-a11y only
 * needs the JSX AST — no type information — so nothing is lost.
 */
export default [
  // strict, not recommended: the renderer already passes strict with zero
  // changes, and the AA target (CLAUDE.md) is the reason this gate exists — no
  // reason to hold it to the lower bar.
  jsxA11y.flatConfigs.strict,
  {
    // JSX lives only in .tsx. Type-only .ts files carry no a11y surface.
    files: ['src/renderer/**/*.tsx'],
    // Test files render components but assert behavior, not markup a11y; the
    // real components they mount are already covered by the glob above.
    ignores: ['src/renderer/**/__tests__/**'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        // No babel.config — presets are inline so the lint gate needs no build
        // config of its own.
        requireConfigFile: false,
        babelOptions: {
          presets: [
            '@babel/preset-react',
            ['@babel/preset-typescript', { isTSX: true, allExtensions: true }],
          ],
        },
      },
      globals: globals.browser,
    },
  },
]
