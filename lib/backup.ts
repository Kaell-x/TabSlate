// Snapshot build/apply shared by direct sync (lib/direct-sync.ts), export,
// and import. The snapshot is a versioned JSON envelope covering every synced
// entity store plus user-level settings that live outside IndexedDB.
//
// Merge semantics: union by entity id. Entities that exist only on the remote
// are added; entities that exist on both sides but differ are taken from the
// remote (last pull wins). Local-only entities are kept and converge on the
// next push. Known limitation: permanently deleted entities leave no
// tombstone in the snapshot, so a device that deleted an entity before others
// pulled cannot propagate that deletion to devices holding a stale copy.

import { idbGetAll, idbPut, idbBulkWrite, type BulkWriteOp } from "@/lib/idb";
import type { Bookmark, Collection, Tag, Workspace } from "@/lib/types";
import { useBookmarksStore } from "@/store/bookmarks-store";
import { useGroupsStore, type GroupTab, type SavedGroup } from "@/store/groups-store";
import { useWorkspaceStore } from "@/store/workspace-store";
import { useI18nStore, type SupportedLanguage } from "@/store/i18n-store";

export const SNAPSHOT_FORMAT = "tabslate-snapshot";
export const SNAPSHOT_FORMAT_VERSION = 1;

interface KvEntry {
  key: string;
  value: unknown;
}

export interface TabSlateSnapshotData {
  workspaces: Workspace[];
  collections: Collection[];
  tags: Tag[];
  bookmarks: Bookmark[];
  archivedBookmarks: Bookmark[];
  trashedBookmarks: Bookmark[];
  groups: SavedGroup[];
  groupTabs: GroupTab[];
  kv: KvEntry[];
  /** UI language ("auto" | "en" | "zh_CN"); lives in extension-page localStorage. */
  language: string;
}

export interface TabSlateSnapshot {
  format: string;
  formatVersion: number;
  deviceId: string;
  exportedAt: number;
  data: TabSlateSnapshotData;
}

export interface ApplyResult {
  changed: boolean;
}

// kv keys replicated by snapshot sync. Everything sync-engine related
// (localSeq, sync-leader, sync-conflicts, workspace lifecycle intents,
// guest provenance) is per-device or account-sync state and stays local.
// "tab-group-titles" / compactGroupTitles are keyed by ephemeral Chrome
// group ids and are meaningless on another device, so they are excluded.
const SYNCED_KV_KEYS = new Set(["activeWorkspaceId", "searchEngines"]);
const SYNCED_KV_PREFIXES = ["compact-group-title:"];

function isSyncedKvKey(key: string): boolean {
  return SYNCED_KV_KEYS.has(key) || SYNCED_KV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export async function buildSnapshot(deviceId: string): Promise<TabSlateSnapshot> {
  const [
    workspaces,
    collections,
    tags,
    bookmarks,
    archivedBookmarks,
    trashedBookmarks,
    groups,
    groupTabs,
    kvEntries,
  ] = await Promise.all([
    idbGetAll<Workspace>("workspaces"),
    idbGetAll<Collection>("collections"),
    idbGetAll<Tag>("tags"),
    idbGetAll<Bookmark>("bookmarks"),
    idbGetAll<Bookmark>("archived-bookmarks"),
    idbGetAll<Bookmark>("trashed-bookmarks"),
    idbGetAll<SavedGroup>("groups"),
    idbGetAll<GroupTab>("group-tabs"),
    idbGetAll<KvEntry>("kv"),
  ]);

  return {
    format: SNAPSHOT_FORMAT,
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    deviceId,
    exportedAt: Date.now(),
    data: {
      workspaces,
      collections,
      tags,
      bookmarks,
      archivedBookmarks,
      trashedBookmarks,
      groups,
      groupTabs,
      kv: kvEntries.filter((entry) => isSyncedKvKey(entry.key)),
      language: useI18nStore.getState().language,
    },
  };
}

export function isTabSlateSnapshot(value: unknown): value is TabSlateSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.format === SNAPSHOT_FORMAT &&
    candidate.formatVersion === SNAPSHOT_FORMAT_VERSION &&
    typeof candidate.data === "object" &&
    candidate.data !== null
  );
}

function mergeEntities<T extends { id: string }>(
  local: readonly T[],
  remote: readonly T[],
): { merged: T[]; changed: boolean } {
  const localMap = new Map(local.map((entry) => [entry.id, entry] as const));
  const merged: T[] = [...local];
  let changed = false;
  for (const remoteEntry of remote) {
    const localEntry = localMap.get(remoteEntry.id);
    if (localEntry === undefined) {
      merged.push(remoteEntry);
      changed = true;
      continue;
    }
    if (JSON.stringify(localEntry) !== JSON.stringify(remoteEntry)) {
      const index = merged.findIndex((entry) => entry.id === remoteEntry.id);
      if (index >= 0) {
        merged[index] = remoteEntry;
      }
      changed = true;
    }
  }
  return { merged, changed };
}

function computeCountsByCollection(bookmarks: readonly Bookmark[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const bookmark of bookmarks) {
    counts[bookmark.collectionId] = (counts[bookmark.collectionId] ?? 0) + 1;
  }
  return counts;
}

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return value === "auto" || value === "en" || value === "zh_CN";
}

export async function applySnapshot(snapshot: TabSlateSnapshot): Promise<ApplyResult> {
  const data = snapshot.data;

  const workspaceState = useWorkspaceStore.getState();
  const bookmarksState = useBookmarksStore.getState();
  const groupsState = useGroupsStore.getState();

  const mergedWorkspaces = mergeEntities(workspaceState.workspaces, data.workspaces ?? []);
  const mergedCollections = mergeEntities(workspaceState.collections, data.collections ?? []);
  const mergedTags = mergeEntities(workspaceState.tags, data.tags ?? []);
  const mergedBookmarks = mergeEntities(
    Array.from(bookmarksState.bookmarks.values()),
    data.bookmarks ?? [],
  );
  const mergedArchived = mergeEntities(bookmarksState.archivedBookmarks, data.archivedBookmarks ?? []);
  const mergedTrashed = mergeEntities(bookmarksState.trashedBookmarks, data.trashedBookmarks ?? []);
  const mergedGroups = mergeEntities(groupsState.groups, data.groups ?? []);
  const mergedGroupTabs = mergeEntities(groupsState.groupTabs, data.groupTabs ?? []);

  const entitiesChanged =
    mergedWorkspaces.changed ||
    mergedCollections.changed ||
    mergedTags.changed ||
    mergedBookmarks.changed ||
    mergedArchived.changed ||
    mergedTrashed.changed ||
    mergedGroups.changed ||
    mergedGroupTabs.changed;

  // Persist the merged result. Data volume is small, so a full overwrite of
  // every store keeps the apply logic simple and idempotent.
  const ops: BulkWriteOp[] = [];
  for (const workspace of mergedWorkspaces.merged) {
    ops.push({ type: "put", store: "workspaces", value: workspace });
  }
  for (const collection of mergedCollections.merged) {
    ops.push({ type: "put", store: "collections", value: collection });
  }
  for (const tag of mergedTags.merged) {
    ops.push({ type: "put", store: "tags", value: tag });
  }
  for (const bookmark of mergedBookmarks.merged) {
    ops.push({ type: "put", store: "bookmarks", value: bookmark });
  }
  for (const bookmark of mergedArchived.merged) {
    ops.push({ type: "put", store: "archived-bookmarks", value: bookmark });
  }
  for (const bookmark of mergedTrashed.merged) {
    ops.push({ type: "put", store: "trashed-bookmarks", value: bookmark });
  }
  for (const group of mergedGroups.merged) {
    ops.push({ type: "put", store: "groups", value: group });
  }
  for (const tab of mergedGroupTabs.merged) {
    ops.push({ type: "put", store: "group-tabs", value: tab });
  }
  await idbBulkWrite(ops);

  // kv: upsert whitelisted remote entries, report whether anything differed.
  let kvChanged = false;
  const localKv = await idbGetAll<KvEntry>("kv");
  const localKvMap = new Map(localKv.map((entry) => [entry.key, entry.value]));
  for (const entry of data.kv ?? []) {
    if (!isSyncedKvKey(entry.key)) {
      continue;
    }
    if (JSON.stringify(localKvMap.get(entry.key)) !== JSON.stringify(entry.value)) {
      kvChanged = true;
    }
    await idbPut("kv", entry);
  }

  // Settings: only the UI language, applied live through the i18n store
  // (which persists itself to extension-page localStorage).
  let settingsChanged = false;
  if (isSupportedLanguage(data.language)) {
    const i18n = useI18nStore.getState();
    if (i18n.language !== data.language) {
      settingsChanged = true;
      void i18n.setLanguage(data.language);
    }
  }

  // Reflect the merged data in the live stores.
  let activeWorkspaceIdToRestore: string | null = null;
  const currentActiveId = workspaceState.activeWorkspaceId;
  const activeStillValid = mergedWorkspaces.merged.some((w) => w.id === currentActiveId);
  if (!activeStillValid) {
    const remoteActive = (data.kv ?? []).find((entry) => entry.key === "activeWorkspaceId");
    if (
      typeof remoteActive?.value === "string" &&
      mergedWorkspaces.merged.some((w) => w.id === remoteActive.value)
    ) {
      activeWorkspaceIdToRestore = remoteActive.value;
    }
  }

  useWorkspaceStore.setState({
    workspaces: mergedWorkspaces.merged,
    collections: mergedCollections.merged,
    tags: mergedTags.merged,
    ...(activeWorkspaceIdToRestore ? { activeWorkspaceId: activeWorkspaceIdToRestore } : {}),
  });
  useBookmarksStore.setState({
    bookmarks: new Map(mergedBookmarks.merged.map((b) => [b.id, b])),
    countsByCollection: computeCountsByCollection(mergedBookmarks.merged),
    archivedBookmarks: mergedArchived.merged,
    trashedBookmarks: mergedTrashed.merged,
  });
  useGroupsStore.setState({
    groups: mergedGroups.merged,
    groupTabs: mergedGroupTabs.merged,
  });

  return { changed: entitiesChanged || kvChanged || settingsChanged };
}
