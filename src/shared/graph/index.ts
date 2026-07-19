/**
 * The entity map's pure layer.
 *
 * Builders only. Nothing here imports React, d3, or canvas: the rendering layer
 * is feel-tested live, but "which events carry which entities" is a set problem
 * with a right answer, so it is tested.
 */

export * from './types'
export * from './entities'
export * from './lensIndex'
export * from './bipartite'
