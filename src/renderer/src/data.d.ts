/**
 * The compiled enrichment index, declared rather than resolved.
 *
 * `data/enrichment.json` is 1.2 MB, and `resolveJsonModule` would infer a
 * literal type for every one of its 3,472 entries — a typecheck cost paid for a
 * type nothing reads, since every consumer runs the file through
 * `validateEnrichmentIndex` first anyway. Declaring the module leaves Vite to
 * resolve it through the `@data` alias at build time while TypeScript never
 * opens it.
 *
 * This file has no imports on purpose: a `.d.ts` with a top-level import becomes
 * a module, and `declare module` inside a module is an *augmentation* of an
 * existing module rather than a declaration of a new one.
 */

declare module '@data/enrichment.json' {
  const index: unknown
  export default index
}
