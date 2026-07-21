/**
 * The filter engine. Pure, and shared on purpose: the sidebar chips and the
 * Phase B chat compiler both go through it, so "interests union, constraints
 * intersect" is one implementation rather than two that agree until they don't.
 */

export * from './types'
export * from './engine'
export * from './candidate'
export * from './labels'
