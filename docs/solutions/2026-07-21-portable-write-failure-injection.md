---
title: "Chmod-based fault injection isn't portable—Windows CI caught it"
type: bug
date: 2026-07-21
unit: U10
requirements: [R11]
---

# Chmod-based fault injection isn't portable—Windows CI caught it

## Problem

The write-failure test for `StarStore.write` (`src/main/__tests__/starStore.test.ts`)
injected a failed atomic write by chmod-ing the store's parent directory
read-only. That injection is POSIX-only: it reliably failed the write on macOS
and Linux for the test's entire life, and never failed it on Windows.

## Symptoms

The test "echoes back the previous list when the write fails, so the loss is
visible now" writes `[star('a')]`, chmods `schedule/` to `0o500`, writes
`[star('a'), star('b')]`, and asserts the echo-back contract (R11): a failed
write must return the previously persisted list, so a lost write shows up
immediately rather than after a restart.

On the repo's first-ever `windows-latest` job—a `workflow_dispatch` dry run of
the new release workflow (Actions run 29849895088)—the "failing" write
succeeded: `expect(echoed).toEqual([star('a')])` received both stars. Every
prior run of this test had been on macOS or Linux, so the gap was invisible
until the release workflow added Windows.

## What didn't work

```ts
chmodSync(join(base, 'schedule'), 0o500) // read-only directory: rename cannot land
```

On POSIX, removing a directory's write bit blocks creating, renaming, or
unlinking entries inside it—exactly what `writeJson`'s temp-file-plus-rename
needs to fail. Windows has no equivalent: Node maps directory mode onto the
read-only file attribute, and read-only on a Windows *directory* is cosmetic—it
does not block creating, writing, or renaming files inside it (only the
attribute on a file itself blocks writes to that file). So `writeFileSync` and
`renameSync` both succeeded, `writeJson` never threw, and `write()` returned
the new list instead of echoing the old one.

The same injection has a second, quieter failure mode even on POSIX: a test
process running as root ignores the write bit entirely.

## Solution

Occupy the store's own deterministic temp path with a directory, so the temp
write fails as a *type conflict* instead of a *permission denial*:

```ts
// Occupy the store's deterministic temp path with a directory, so the temp
// write fails on every platform while stars.json stays intact for the echo.
mkdirSync(`${file()}.${process.pid}.tmp`)

const echoed = store.write([star('a'), star('b')])

expect(echoed).toEqual([star('a')])
```

`StarStore.writeJson` always computes its temp path as
`` `${target}.${process.pid}.tmp` `` before writing. Pre-creating a directory
at that exact path makes `writeFileSync` fail with an `EISDIR`-class error on
every platform—writing file contents to a directory is a conflict the
filesystem itself rejects, not a permission question any OS answers
differently. The failure happens entirely at the temp-file stage, before
`renameSync` could touch the real file, so `stars.json` still holds
`[star('a')]` and the echo-back assertion checks genuine on-disk state. The
chmod-restoring `afterEach` cleanup went away with the chmod.

Fixed in 73b022f.

## Why this works

The root cause was not a Windows bug in `StarStore`—it was a
platform-portability assumption baked into the failure-injection strategy.
"Chmod a directory to make writes into it fail" is true on POSIX and false on
Windows, and no test run exercised that difference until the release pipeline
added a Windows job. The fix stops depending on permission semantics entirely
and keys off an invariant of the code under test instead: the deterministic
temp-path naming. A type conflict fails identically everywhere, regardless of
OS or which user runs the suite.

## Prevention

- When a failure-injection test needs a write to fail, exploit an invariant of
  the code under test (a deterministic path, an error the code already
  handles, a boundary in its own logic) rather than filesystem permission
  tricks. `chmod`-based injections are POSIX-only and also silently no-op
  under root.
- Before tag day on a workflow that builds for a newly added OS, run the full
  suite there once. `.github/workflows/release-windows.yml` has a
  `workflow_dispatch` path for exactly this—the dry run is what caught this
  bug in a rehearsal instead of the release build.

## See also

- `.github/workflows/release-windows.yml`—the windows-latest job that caught this.
- `docs/plans/2026-07-17-001-feat-relatedness-graph-app-plan.md` (U10)—release-readiness unit this hardens.
- `src/main/starStore.ts`, `src/main/__tests__/starStore.test.ts`
- 73b022f—the fix.
