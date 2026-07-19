/**
 * U4 — the enrichment layer.
 *
 * `schema` describes the compiled LLM index; everything else is deterministic
 * and needs no compile step, which is why the app has working classes, offering
 * clusters, and facets before any batch has ever run.
 */

export * from './schema'
export * from './classes'
export * from './offerings'
export * from './facets'
export * from './join'
