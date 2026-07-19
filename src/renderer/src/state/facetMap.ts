/**
 * The facet table, imported at build time.
 *
 * `data/facet-map.json` is a small committed static table, not fetched data —
 * it ships with the app the way the code does. Bundling it keeps the facet
 * dimensions working on a cold first run with no network and no snapshot,
 * which is the state a user is in the first time they open the app.
 *
 * The compiled LLM index is deliberately *not* imported here. It is large, it
 * goes stale against the live feed, and its staleness check needs a hash the
 * renderer cannot compute — so people and franchise dimensions stay empty until
 * main ships them across the bridge. The filter engine already registers those
 * dimensions, so nothing needs to change when they arrive.
 */

import type { FacetMap } from '@shared/enrichment'
import raw from '../../../../data/facet-map.json'

/**
 * The JSON's inferred type widens `kind` to `string`, which is exactly the
 * field `applyFacets` branches on. The assertion is the one place that trusts
 * the committed file's shape; `facet-map.test.ts` in the enrichment suite is
 * what makes that trust earned.
 */
export const FACET_MAP = raw as unknown as FacetMap
