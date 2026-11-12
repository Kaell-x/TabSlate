interface SortableCollection {
  id?: string;
  isDefault?: boolean;
  position: number;
}

export function compareActiveCollections(
  left: SortableCollection,
  right: SortableCollection,
): number {
  const leftIsDefault = left.isDefault === true;
  const rightIsDefault = right.isDefault === true;

  if (leftIsDefault !== rightIsDefault) {
    return leftIsDefault ? -1 : 1;
  }
  return right.position - left.position;
}

/**
 * Resolve the single global default collection from the visible (active)
 * collection set. The server flags one default per workspace, so multiple
 * collections may carry isDefault; pick the flagged one with the smallest
 * position (tie-break by id) — mirroring the server CTE rule. Falls back to
 * the lowest-position collection when none is flagged (offline hydrate).
 */
export function resolveGlobalDefaultCollection<T extends SortableCollection>(
  collections: readonly T[],
): T | undefined {
  if (collections.length === 0) { return undefined; }
  const flagged = collections.filter((c) => c.isDefault === true);
  const pool = flagged.length > 0 ? flagged : collections;
  return pool.reduce((best, c) => {
    if (c.position !== best.position) {
      return c.position < best.position ? c : best;
    }
    return String(c.id).localeCompare(String(best.id)) < 0 ? c : best;
  });
}
