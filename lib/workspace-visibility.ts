import type { Collection, Workspace } from "@/lib/types";
import { resolveGlobalDefaultCollection } from "@/lib/collection-utils";

export function isActiveWorkspace(
  workspace: Workspace | undefined,
): workspace is Workspace {
  return workspace !== undefined && workspace.deletedAt === undefined;
}

/**
 * Collections form a global library shared by all active workspaces
 * (browser-bookmarks philosophy). A collection is visible when its owner
 * workspace is active (not soft-deleted); collections of a deleted workspace
 * stay hidden with it and come back when the workspace is restored.
 *
 * The activeWorkspaceId parameter is kept for call-site compatibility and
 * purge-target validation but no longer narrows the visible set.
 */
export function getCollectionsUnderActiveWorkspace(
  activeWorkspaceId: string,
  workspaces: readonly Workspace[],
  collections: readonly Collection[],
): Collection[] {
  const activeWorkspaceIds = new Set(
    workspaces
      .filter(isActiveWorkspace)
      .map((workspace) => workspace.id),
  );
  return collections.filter((collection) =>
    activeWorkspaceIds.has(collection.workspaceId),
  );
}

export function getActiveWorkspaceCollectionIds(
  activeWorkspaceId: string,
  workspaces: readonly Workspace[],
  collections: readonly Collection[],
): Set<string> {
  return new Set(getActiveWorkspaceCollections(
    activeWorkspaceId,
    workspaces,
    collections,
  ).map((collection) => collection.id));
}

export function getActiveWorkspaceCollections(
  activeWorkspaceId: string,
  workspaces: readonly Workspace[],
  collections: readonly Collection[],
): Collection[] {
  const active = getCollectionsUnderActiveWorkspace(
    activeWorkspaceId,
    workspaces,
    collections,
  ).filter((collection) => !collection.deletedAt && !collection.archivedAt);
  // The server flags one default per workspace; expose a single global
  // default (resolved by smallest position) at the top of the list.
  const globalDefaultId = resolveGlobalDefaultCollection(active)?.id;
  return active.sort((left, right) => {
    const leftIsDefault = left.id === globalDefaultId;
    const rightIsDefault = right.id === globalDefaultId;
    if (leftIsDefault !== rightIsDefault) {
      return leftIsDefault ? -1 : 1;
    }
    return right.position - left.position;
  });
}

export function belongsToActiveWorkspace(
  collectionId: string,
  activeCollectionIds: ReadonlySet<string>,
): boolean {
  return activeCollectionIds.has(collectionId);
}

export interface PurgeTargets {
  collectionIds?: readonly string[];
  groupIds?: readonly string[];
  bookmarkIds?: readonly string[];
  tabIds?: readonly string[];
}

export interface PurgeVisibilityInput {
  activeWorkspaceId: string;
  workspaces: readonly Workspace[];
  collections: readonly Collection[];
  groups: readonly { id: string; workspaceId: string }[];
  groupTabs: readonly { id: string; groupId: string }[];
  trashedBookmarks: readonly { id: string; collectionId: string }[];
}

/**
 * True when every purge target still belongs to the active workspace.
 *
 * Confirm dialogs invoke a closure captured when the dialog opened, so a remote
 * pull can retire the parent workspace in that window. Permanently deleting a
 * descendant of a retained workspace is irreversible and would leave a later
 * restore missing children, so destructive paths must re-check against live
 * state before proceeding.
 */
export function purgeTargetsRemainVisible(
  input: PurgeVisibilityInput,
  targets: PurgeTargets,
): boolean {
  const scopedCollections = getCollectionsUnderActiveWorkspace(
    input.activeWorkspaceId,
    input.workspaces,
    input.collections,
  );
  // An empty scope means the active workspace itself is retired or missing.
  const activeWorkspace = input.workspaces.find(
    (workspace) => workspace.id === input.activeWorkspaceId,
  );
  if (!isActiveWorkspace(activeWorkspace)) {
    return false;
  }

  const scopedCollectionIds = new Set(scopedCollections.map((collection) => collection.id));
  if ((targets.collectionIds ?? []).some((id) => !scopedCollectionIds.has(id))) {
    return false;
  }

  const visibleGroupIds = new Set(
    input.groups
      .filter((group) => group.workspaceId === input.activeWorkspaceId)
      .map((group) => group.id),
  );
  if ((targets.groupIds ?? []).some((id) => !visibleGroupIds.has(id))) {
    return false;
  }

  const staleTab = (targets.tabIds ?? []).some((id) => {
    const tab = input.groupTabs.find((candidate) => candidate.id === id);
    return !tab || !visibleGroupIds.has(tab.groupId);
  });
  if (staleTab) {
    return false;
  }

  return !(targets.bookmarkIds ?? []).some((id) => {
    const bookmark = input.trashedBookmarks.find((candidate) => candidate.id === id);
    // "" is the uncategorized sentinel — it has no workspace parent to validate.
    return !bookmark
      || (bookmark.collectionId !== "" && !scopedCollectionIds.has(bookmark.collectionId));
  });
}

export function resolveActiveWorkspaceCollectionTarget(
  collectionId: string,
  activeWorkspaceId: string,
  workspaces: readonly Workspace[],
  collections: readonly Collection[],
): Collection | undefined {
  const activeCollectionIds = getActiveWorkspaceCollectionIds(
    activeWorkspaceId,
    workspaces,
    collections,
  );
  if (!belongsToActiveWorkspace(collectionId, activeCollectionIds)) {
    return undefined;
  }
  return collections.find((collection) => collection.id === collectionId);
}
