/**
 * U6 — the relatedness graph's pure layer.
 *
 * Edge builders only. Nothing here imports React, d3, or canvas: the rendering
 * layer is feel-tested live, but "which events are related, and why" is a set
 * problem with a right answer, so it is tested.
 */

export * from './types'
export * from './entities'
export * from './lensIndex'
export * from './ego'
export * from './bipartite'
