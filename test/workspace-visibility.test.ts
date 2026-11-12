// @ts-expect-error Bun provides this test module at runtime.
import { describe, expect, test } from "bun:test";
import type { Collection, Workspace } from "@/lib/types";
import { resolveGlobalDefaultCollection } from "@/lib/collection-utils";
import {
  belongsToActiveWorkspace,
  getActiveWorkspaceCollectionIds,
  getCollectionsUnderActiveWorkspace,
  purgeTargetsRemainVisible,
  resolveActiveWorkspaceCollectionTarget,
  type PurgeVisibilityInput,
} from "@/lib/workspace-visibility";

function workspace(id: string, deletedAt?: number): Workspace {
  return {
    id,
    name: id,
    color: "blue",
    position: 0,
    seq: 1,
    deletedAt,
  };
}

function collection(
  id: string,
  workspaceId: string,
  lifecycle: Pick<Collection, "deletedAt" | "archivedAt"> = {},
  isDefault = false,
): Collection {
  return {
    id,
    workspaceId,
    name: id,
    icon: "folder",
    position: isDefault ? 0 : 10,
    isDefault,
    seq: 1,
    ...lifecycle,
  };
}

describe("global collection library visibility", () => {
  const workspaces = [
    workspace("active"),
    workspace("retained", Date.UTC(2026, 7, 20)),
  ];
  const collections = [
    collection("active-default", "active", {}, true),
    collection("active-newest", "active"),
    collection("retained-active", "retained"),
    collection("retained-archived", "retained", { archivedAt: 10 }),
    collection("retained-trashed", "retained", { deletedAt: 20 }),
  ];

  test("collections of every active workspace are visible, regardless of the current workspace", () => {
    const activeIds = getActiveWorkspaceCollectionIds(
      "retained",
      workspaces,
      collections,
    );
    const scopedIds = new Set(
      getCollectionsUnderActiveWorkspace("active", workspaces, collections)
        .map((candidate) => candidate.id),
    );

    expect(Array.from(activeIds)).toEqual(["active-default", "active-newest"]);
    expect(Array.from(scopedIds)).toEqual(["active-default", "active-newest"]);
    expect(belongsToActiveWorkspace("active-default", activeIds)).toBe(true);
  });

  test("a retained parent keeps hiding its active, archived, and trashed collections", () => {
    const activeIds = getActiveWorkspaceCollectionIds(
      "active",
      workspaces,
      collections,
    );
    const scopedIds = new Set(
      getCollectionsUnderActiveWorkspace("active", workspaces, collections)
        .map((candidate) => candidate.id),
    );

    expect(belongsToActiveWorkspace("retained-active", activeIds)).toBe(false);
    expect(belongsToActiveWorkspace("retained-archived", scopedIds)).toBe(false);
    expect(belongsToActiveWorkspace("retained-trashed", scopedIds)).toBe(false);
  });

  test("a collection whose parent workspace is missing never falls back into view", () => {
    const orphanCollections = [
      collection("active-default", "active", {}, true),
      collection("orphan-trash", "missing-parent", { deletedAt: 20 }),
    ];

    const scopedIds = new Set(
      getCollectionsUnderActiveWorkspace("active", workspaces, orphanCollections)
        .map((candidate) => candidate.id),
    );

    expect(Array.from(scopedIds)).toEqual(["active-default"]);
    expect(belongsToActiveWorkspace("orphan-trash", scopedIds)).toBe(false);
  });
});

describe("global default collection resolution", () => {
  test("picks the flagged default with the smallest position", () => {
    const collections = [
      { ...collection("default-b", "ws-b", {}, true), position: 5 },
      { ...collection("default-a", "ws-a", {}, true), position: 0 },
    ];
    expect(resolveGlobalDefaultCollection(collections)?.id).toBe("default-a");
  });

  test("tie-breaks equal positions by id", () => {
    const collections = [
      { ...collection("z-default", "ws-a", {}, true), position: 2 },
      { ...collection("m-default", "ws-a", {}, true), position: 2 },
    ];
    expect(resolveGlobalDefaultCollection(collections)?.id).toBe("m-default");
  });

  test("falls back to the lowest-position collection when none is flagged", () => {
    const collections = [
      { ...collection("newer", "ws-a"), position: 3 },
      { ...collection("oldest", "ws-a"), position: 1 },
    ];
    expect(resolveGlobalDefaultCollection(collections)?.id).toBe("oldest");
  });

  test("returns undefined for an empty library", () => {
    expect(resolveGlobalDefaultCollection([])).toBeUndefined();
  });
});

describe("collection mutation targets", () => {
  test("dialogs and popup cannot target a collection under a retained workspace", () => {
    const workspaces = [
      workspace("active"),
      workspace("retained", Date.UTC(2026, 7, 20)),
    ];
    const collections = [
      collection("active-default", "active", {}, true),
      collection("active-newest", "active"),
      collection("retained-target", "retained"),
    ];

    expect(resolveActiveWorkspaceCollectionTarget(
      "retained-target",
      "active",
      workspaces,
      collections,
    )).toBeUndefined();
  });

  test("a collection under another active workspace is a valid target", () => {
    const workspaces = [workspace("ws-a"), workspace("ws-b")];
    const collections = [
      collection("default-a", "ws-a", {}, true),
      collection("other-workspace-col", "ws-b"),
    ];

    expect(resolveActiveWorkspaceCollectionTarget(
      "other-workspace-col",
      "ws-a",
      workspaces,
      collections,
    )?.id).toBe("other-workspace-col");
  });

  test("target refresh keeps the global default first, then position-descending", () => {
    const workspaces = [workspace("active")];
    const collections = [
      { ...collection("older", "active"), position: 1 },
      { ...collection("default", "active", {}, true), position: 0 },
      { ...collection("newest", "active"), position: 20 },
      collection("archived", "active", { archivedAt: 10 }),
    ];

    expect(Array.from(getActiveWorkspaceCollectionIds(
      "active",
      workspaces,
      collections,
    ))).toEqual(["default", "newest", "older"]);
    expect(resolveActiveWorkspaceCollectionTarget(
      "newest",
      "active",
      workspaces,
      collections,
    )?.id).toBe("newest");
    expect(resolveActiveWorkspaceCollectionTarget(
      "archived",
      "active",
      workspaces,
      collections,
    )).toBeUndefined();
  });

  test("with several workspace-flagged defaults only the resolved global default sorts first", () => {
    const workspaces = [workspace("ws-a"), workspace("ws-b")];
    const collections = [
      { ...collection("default-b", "ws-b", {}, true), position: 5 },
      { ...collection("default-a", "ws-a", {}, true), position: 0 },
      { ...collection("newest", "ws-a"), position: 20 },
    ];

    expect(Array.from(getActiveWorkspaceCollectionIds(
      "ws-a",
      workspaces,
      collections,
    ))).toEqual(["default-a", "newest", "default-b"]);
  });
});

describe("purge target revalidation", () => {
  // Models the window between opening a confirm dialog and clicking Confirm,
  // during which a remote pull can retire the parent workspace.
  function scene(activeWorkspaceId: string, retainedAt?: number): PurgeVisibilityInput {
    return {
      activeWorkspaceId,
      workspaces: [workspace("ws-a"), workspace("ws-b", retainedAt)],
      collections: [
        collection("col-a", "ws-a", { deletedAt: Date.UTC(2026, 7, 1) }),
        collection("col-b", "ws-b", { deletedAt: Date.UTC(2026, 7, 1) }),
      ],
      groups: [
        { id: "grp-a", workspaceId: "ws-a" },
        { id: "grp-b", workspaceId: "ws-b" },
      ],
      groupTabs: [
        { id: "tab-a", groupId: "grp-a" },
        { id: "tab-b", groupId: "grp-b" },
      ],
      trashedBookmarks: [
        { id: "bm-a", collectionId: "col-a" },
        { id: "bm-b", collectionId: "col-b" },
        { id: "bm-uncategorized", collectionId: "" },
      ],
    };
  }

  test("accepts collection and bookmark targets owned by any active workspace", () => {
    expect(purgeTargetsRemainVisible(scene("ws-a"), {
      collectionIds: ["col-a", "col-b"],
      bookmarkIds: ["bm-a", "bm-b"],
    })).toBe(true);
  });

  test("still accepts targets that belong to the active workspace itself", () => {
    expect(purgeTargetsRemainVisible(scene("ws-a"), {
      collectionIds: ["col-a"],
      groupIds: ["grp-a"],
      bookmarkIds: ["bm-a"],
      tabIds: ["tab-a"],
    })).toBe(true);
  });

  test("rejects group and tab targets under another workspace", () => {
    const input = scene("ws-a");
    expect(purgeTargetsRemainVisible(input, { groupIds: ["grp-b"] })).toBe(false);
    expect(purgeTargetsRemainVisible(input, { tabIds: ["tab-b"] })).toBe(false);
  });

  test("rejects every target once the owning workspace is retired mid-dialog", () => {
    // Captured while ws-b was active; a pull then soft-deleted ws-b.
    const retired = scene("ws-b", Date.UTC(2026, 7, 25));
    expect(purgeTargetsRemainVisible(retired, { collectionIds: ["col-b"] })).toBe(false);
    expect(purgeTargetsRemainVisible(retired, { groupIds: ["grp-b"] })).toBe(false);
    expect(purgeTargetsRemainVisible(retired, { bookmarkIds: ["bm-b"] })).toBe(false);
  });

  test("keeps uncategorized bookmarks purgeable and rejects vanished ids", () => {
    const input = scene("ws-a");
    expect(purgeTargetsRemainVisible(input, { bookmarkIds: ["bm-uncategorized"] })).toBe(true);
    expect(purgeTargetsRemainVisible(input, { bookmarkIds: ["bm-gone"] })).toBe(false);
    expect(purgeTargetsRemainVisible(input, { collectionIds: ["col-gone"] })).toBe(false);
    expect(purgeTargetsRemainVisible(input, { tabIds: ["tab-gone"] })).toBe(false);
  });

  test("treats an empty target set as nothing to invalidate", () => {
    expect(purgeTargetsRemainVisible(scene("ws-a"), {})).toBe(true);
  });
});
