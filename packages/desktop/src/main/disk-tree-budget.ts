/**
 * Maximum number of materialized `DiskNode`s the desktop can safely carry
 * across a native scan response and a persisted snapshot. Keeping one budget
 * for both boundaries prevents a valid, cacheable native result from being
 * rejected and needlessly rescanned by the TypeScript fallback.
 */
export const MAX_MATERIALIZED_DISK_TREE_NODES = 500_000
