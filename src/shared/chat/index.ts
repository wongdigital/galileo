/**
 * The chat concierge's shared contract. Types only plus the two pure helpers
 * the tool loop leans on — no zod, no Electron, so both the renderer and main
 * import from here freely.
 */

export * from './types'
export { applyFilterIntent, resolveFacetValue } from './intent'
