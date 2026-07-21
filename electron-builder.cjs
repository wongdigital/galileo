/**
 * electron-builder packaging — macOS arm64 (dmg + zip) and Windows x64 (NSIS).
 *
 * Signing + notarization are OPT-IN via environment. `npm run dist` on a machine
 * without the Apple App Store Connect API-key vars produces exactly the
 * known-good UNSIGNED build (ad-hoc signature, which arm64 needs to launch).
 * When those vars are present, the same command signs with the Developer ID
 * cert (auto-discovered from the keychain) and notarizes.
 *
 * The app name stays "galileo" (package.json name); Electron's userData path
 * follows it, so the star store and encrypted key file survive across versions
 * (CLAUDE.md gotcha). productName is the display name only.
 */

// notarytool credentials (App Store Connect API key). All three present → we do
// the full signed+notarized release; otherwise we fall back to unsigned so a
// build never hard-fails for lack of secrets. notarytool reads these three env
// vars directly and infers the team from the issuer, so no teamId is needed in
// config (APPLE_TEAM_ID, if set, only disambiguates the signing identity).
const canNotarize = Boolean(
  process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER,
)

const macSigning = canNotarize
  ? {
      // Release path: the "Developer ID Application" cert is auto-discovered
      // from the login keychain and signs the app. Hardened runtime — with
      // entitlements that re-permit V8's JIT — is required for notarization,
      // which runs via notarytool with the API-key env vars above.
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.plist',
      // electron-builder 26: notarize is a boolean; credentials come from env.
      notarize: true,
    }
  : {
      // No credentials → the known-good unsigned build. Gatekeeper still wants a
      // first-run right-click → Open. A real identity + notarization is the
      // release path above, reached by exporting the Apple env vars.
      identity: null,
    }

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'digital.wong.galileo',
  productName: 'Galileo',
  copyright: '© 2026 Roger Wong',
  directories: { buildResources: 'build', output: 'dist' },

  // Where `electron-builder --publish always` uploads. Owner/repo are explicit
  // rather than inferred: package.json has no `repository` field, so without
  // this the GitHub provider has nothing to resolve. This only names the
  // destination; nothing publishes unless `--publish` is passed (the Windows CI
  // job does; local `npm run dist` / `dist:win` do not).
  publish: { provider: 'github', owner: 'wongdigital', repo: 'galileo' },

  // The default matcher already includes out/, package.json, and the PRODUCTION
  // node_modules — which must ship, because main externalizes its dependencies
  // (electron.vite.config.ts: externalizeDepsPlugin) rather than bundling them.
  // These negatives keep everything else out of the .app.
  //
  // Excluding data/ is load-bearing, not tidiness: the two committed tables the
  // app reads at runtime (facet-map.json, enrichment.json) are bundled into
  // out/renderer at build time, so nothing fs-reads data/ from a package. The
  // raw Sched fetch (data/events.json / meta.json) is gitignored and
  // Sched-authored prose — it must never enter a distributable.
  files: [
    '!src',
    '!scripts',
    '!docs',
    '!tests',
    '!data',
    '!electron.vite.config.ts',
    '!eslint.config.{js,cjs,mjs}',
    '!tsconfig*.json',
    '!{.env,.env.*,.npmrc}',
    '!**/*.map',
  ],

  asar: true,

  mac: {
    category: 'public.app-category.reference',
    icon: 'build/icon.icns',
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
    ...macSigning,
  },

  dmg: { title: '${productName} ${version}' },

  // Windows x64 NSIS installer. Unsigned for now — no Authenticode cert is
  // wired up, so SmartScreen will warn on first run until one is (a code-signing
  // cert now has to live in a cloud HSM / signing service, not a local .pfx).
  // The build itself succeeds unsigned; adding a signing hook later is additive.
  win: {
    icon: 'build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
  },

  // Assisted installer (not one-click): the user sees a wizard and can pick the
  // install directory. perMachine:false keeps it a per-user install so no admin
  // elevation is needed — which also means an unsigned build never triggers a
  // UAC prompt on top of the SmartScreen warning.
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    artifactName: '${productName}-${version}-setup.${ext}',
  },
}
