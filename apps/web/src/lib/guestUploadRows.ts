// A guest's finished upload should appear in the grid the moment that file is done, not once after the whole batch.
// The page also refreshes the share in the background (that is how server-made thumbnails arrive), so a refresh that
// started before the newest file finished must not wipe its tile.

type WithId = { id: string };

/** The finished upload goes to the top (newest first, like the server's own order); adding it twice never duplicates it. */
export function prependUploadedRow<T extends WithId>(assets: T[], row: T): T[] {
  return [row, ...assets.filter((asset) => asset.id !== row.id)];
}

const KEEP_LOCAL_ROW_MS = 60_000;

/**
 * The server's list, plus any tile added locally in the last minute that the server's answer does not have yet (the answer was
 * fetched before that file finished). Older local tiles are not kept: a file that is really gone should go.
 */
export function keepRecentLocalRows<T extends WithId>(fresh: T[], current: T[], addedAt: ReadonlyMap<string, number>, now: number, ttlMs = KEEP_LOCAL_ROW_MS): T[] {
  if (addedAt.size === 0) return fresh;
  const known = new Set(fresh.map((asset) => asset.id));
  const missing = current.filter((asset) => !known.has(asset.id) && now - (addedAt.get(asset.id) ?? -Infinity) < ttlMs);
  return missing.length ? [...missing, ...fresh] : fresh;
}
