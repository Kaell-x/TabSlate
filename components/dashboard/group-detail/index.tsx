import * as React from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Check,
  Layers,
  Pencil,
  Play,
  Trash2,
  X,
  MoreHorizontal,
  Save,
  BookmarkPlus,
  FolderPlus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { focusOrOpenTab, openInNewTab } from "@/lib/chrome/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/ui/color-picker";
import { useGroupsStore, type GroupTab } from "@/store/groups-store";
import { useBookmarksStore } from "@/store/bookmarks-store";
import { useWorkspaceStore } from "@/store/workspace-store";
import { useDroppable } from "@dnd-kit/core";
import { useTabsDndContext } from "@/components/dashboard/tabs-dnd-provider";
import { savedGroupDropId } from "@/lib/drop-ids";
import { BaseTabRow } from "@/components/dashboard/shared/base-tab-row";
import {
  ALL_CATEGORY_COLOR,
  GroupCategoryStrip,
  categoryColor,
} from "@/components/dashboard/group-detail/group-category-strip";
import { GroupCategoryMenu } from "@/components/dashboard/group-detail/group-category-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SaveCollectionDialog } from "@/components/dashboard/tabs-panel/save-collection-dialog";
import { CollectionDialog } from "@/components/dashboard/sidebar/collection-dialog";
import { generateId } from "@/lib/id";
import {
  getActiveWorkspaceCollections,
  isActiveWorkspace,
  resolveActiveWorkspaceCollectionTarget,
} from "@/lib/workspace-visibility";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";

export function GroupDetail() {
  const { t } = useTranslation();
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const groups = useGroupsStore(s => s.groups);
  const updateGroup = useGroupsStore(s => s.updateGroup);
  const deleteGroup = useGroupsStore(s => s.deleteGroup);
  const openGroup = useGroupsStore(s => s.openGroup);
  const allGroupTabs = useGroupsStore(s => s.groupTabs);
  const removeTabFromGroup = useGroupsStore(s => s.removeTabFromGroup);
  const allCategories = useGroupsStore(s => s.groupCategories);
  const addBookmarks = useBookmarksStore(s => s.addBookmarks);

  const groupTabs = React.useMemo(
    () =>
      allGroupTabs
        .filter(t => t.groupId === groupId)
        .sort((a, b) => a.position - b.position),
    [allGroupTabs, groupId]
  );

  const [editing, setEditing] = React.useState(false);
  const [nameVal, setNameVal] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [activeCategoryId, setActiveCategoryId] = React.useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveResult, setSaveResult] = React.useState<{ saved: number; skipped: number } | null>(null);
  const [savedTabIds, setSavedTabIds] = React.useState<Set<string>>(new Set());
  const [saveMenuOpenMap, setSaveMenuOpenMap] = React.useState<Record<string, boolean>>({});
  const [collectionDialogTab, setCollectionDialogTab] = React.useState<GroupTab | null>(null);

  const collections = useWorkspaceStore(s => s.collections);
  const workspaces = useWorkspaceStore(s => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId);

  const group = React.useMemo(() => {
    const activeWorkspace = workspaces.find(
      (workspace) => workspace.id === activeWorkspaceId,
    );
    if (!isActiveWorkspace(activeWorkspace)) {
      return undefined;
    }
    return groups.find(
      (candidate) => candidate.id === groupId &&
        !candidate.deletedAt &&
        candidate.workspaceId === activeWorkspaceId,
    );
  }, [activeWorkspaceId, groupId, groups, workspaces]);

  const activeCollections = React.useMemo(() => {
    return getActiveWorkspaceCollections(activeWorkspaceId, workspaces, collections);
  }, [activeWorkspaceId, workspaces, collections]);

  // A selected category may have been deleted; fall back to "All".
  const activeCategoryValid =
    activeCategoryId === null ||
    allCategories.some((c) => c.id === activeCategoryId && c.groupId === groupId);

  const visibleTabs = React.useMemo(() => {
    if (activeCategoryId === null || !activeCategoryValid) { return groupTabs; }
    return groupTabs.filter((tab) => (tab.categoryIds ?? []).includes(activeCategoryId));
  }, [groupTabs, activeCategoryId, activeCategoryValid]);

  // 连体框架：整页容器边框、页签行、内容区淡染都跟随激活分类色。
  const activeColor = React.useMemo(() => {
    if (activeCategoryId === null || !activeCategoryValid) { return ALL_CATEGORY_COLOR; }
    const cat = allCategories.find((c) => c.id === activeCategoryId && c.groupId === groupId);
    return cat ? categoryColor(cat) : ALL_CATEGORY_COLOR;
  }, [activeCategoryId, activeCategoryValid, allCategories, groupId]);

  // 分类色渲染整个页面：去掉边框着色，整页统一浅色背景。
  const pageTint = `color-mix(in srgb, ${activeColor} 4.5%, var(--background))`;

  const [targetUnavailable, setTargetUnavailable] = React.useState(false);

  // Navigate away when workspace switches and this group doesn't belong to the new workspace
  React.useEffect(() => {
    if (group && group.workspaceId !== activeWorkspaceId) {
      navigate("/");
    }
  }, [activeWorkspaceId, group, navigate]);

  // Init local state when group loads
  React.useEffect(() => {
    if (group && !editing) {
      setNameVal(group.name);
    }
  }, [group, editing]);

  // 整页都是拖放区：从右侧 OPENED TABS 拖到页面任意位置即可加入分组。
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: savedGroupDropId(groupId ?? "") });
  const { activeData } = useTabsDndContext();
  const isDragOver = isOver && (activeData?.type === "tab" || activeData?.type === "tab-group");

  const handleSaveGroup = React.useCallback(async (name: string) => {
    setIsSaving(true);
    const state = useWorkspaceStore.getState();
    const activeWorkspace = state.workspaces.find(
      (workspace) => workspace.id === state.activeWorkspaceId,
    );
    if (!isActiveWorkspace(activeWorkspace)) {
      setIsSaving(false);
      setTargetUnavailable(true);
      return;
    }
    const collection = state.createCollection(state.activeWorkspaceId, name, "folder");

    const newBookmarks = groupTabs.map(t => ({
      id: generateId(),
      title: t.title,
      url: t.url,
      favicon: t.favicon,
      collectionId: collection.id,
      description: "",
      tags: [],
      createdAt: new Date().toISOString(),
      isFavorite: false,
      seq: 0,
    }));

    addBookmarks(newBookmarks);
    setIsSaving(false);
    setSaveDialogOpen(false);
    setSaveResult({ saved: newBookmarks.length, skipped: 0 });
    setTargetUnavailable(false);
    setTimeout(() => setSaveResult(null), 3000);
  }, [groupTabs, addBookmarks]);

  const handleSaveTab = React.useCallback((tab: GroupTab, collectionId: string) => {
    const state = useWorkspaceStore.getState();
    const target = resolveActiveWorkspaceCollectionTarget(
      collectionId,
      state.activeWorkspaceId,
      state.workspaces,
      state.collections,
    );
    if (!target) {
      setSaveMenuOpenMap({});
      setTargetUnavailable(true);
      return;
    }
    addBookmarks([{
      id: generateId(),
      title: tab.title,
      url: tab.url,
      favicon: tab.favicon,
      collectionId: target.id,
      description: "",
      tags: [],
      createdAt: new Date().toISOString(),
      isFavorite: false,
      seq: 0,
    }]);
    setTargetUnavailable(false);
    setSavedTabIds(prev => new Set(prev).add(tab.id));
    setTimeout(() => {
      setSavedTabIds(prev => {
        const next = new Set(prev);
        next.delete(tab.id);
        return next;
      });
    }, 2000);
  }, [addBookmarks]);

  if (!group) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground p-10">
        <p className="text-sm">分组不存在</p>
        <Button variant="link" onClick={() => navigate("/tabs")} className="mt-2 text-xs">
          返回标签页
        </Button>
      </div>
    );
  }

  const handleSaveName = () => {
    if (nameVal.trim() && nameVal.trim() !== group.name) {
      updateGroup(group.id, { name: nameVal.trim() });
    }
    setEditing(false);
  };

  const handleToggleSelect = (tabId: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      checked ? next.add(tabId) : next.delete(tabId);
      return next;
    });
  };

  const handleOpenSelected = () => {
    groupTabs
      .filter((tab) => selected.has(tab.id))
      .forEach((tab) => openInNewTab(tab.url));
    setSelected(new Set());
  };

  const handleDeleteGroup = () => {
    deleteGroup(group.id);
    navigate("/tabs");
  };

  const titleInput = editing ? (
    <Input
      value={nameVal}
      onChange={(e) => setNameVal(e.target.value)}
      onBlur={handleSaveName}
      className="h-7 text-sm py-0 w-48"
      autoFocus
      onKeyDown={(e) => {
        if (e.key === "Enter") { handleSaveName(); }
        if (e.key === "Escape") {
          setNameVal(group.name);
          setEditing(false);
        }
      }}
    />
  ) : (
    <span className="text-xs text-muted-foreground shrink-0">{groupTabs.length} 个标签页</span>
  );

  return (
    <div
      ref={setDropRef}
      className={cn(
        "flex-1 flex flex-col overflow-hidden border rounded-lg bg-background transition-colors",
        isDragOver && "border-primary/50 bg-primary/5",
      )}
      style={{ background: pageTint }}
    >
      {targetUnavailable && (
        <Alert className="m-4 mb-0" variant="destructive">
          <AlertCircle />
          <AlertDescription>{t("workspaceVisibility_targetUnavailable")}</AlertDescription>
        </Alert>
      )}

      {/* 吸顶功能栏 */}
      <div
        className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2.5 border-b"
        style={{ background: pageTint }}
      >
        {titleInput}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          {saveResult && (
            <span className="text-[10px] bg-green-500/10 text-green-600 px-1.5 py-0.5 rounded-full animate-in fade-in zoom-in duration-300">
              已保存 {saveResult.saved}
            </span>
          )}

          {selected.size > 0 && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleOpenSelected}
              className="size-6 hover:text-green-500 transition-colors"
              title={t("groupDetail_openSelectedTabs", [selected.size.toString()])}
            >
              <Play className="size-3.5" />
            </Button>
          )}

          <div className="flex items-center gap-1.5 px-2 border-l border-r border-border/50">
            <Switch
              checked={group.isCompact}
              onCheckedChange={(checked) => updateGroup(group.id, { isCompact: checked })}
              onMouseDown={(e) => e.preventDefault()}
              className="scale-75"
              title="切换简称模式"
            />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-tight">
              Compact
            </span>
          </div>

          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => openGroup(group.id)}
            className="size-6 hover:text-green-500"
            title="在 Chrome 中打开分组"
          >
            <Play className="size-3.5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" className="size-6">
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil className="size-4 mr-2" />
                重命名分组
              </DropdownMenuItem>
              <div className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                <p className="text-xs text-muted-foreground mb-1.5">分组颜色</p>
                <ColorPicker
                  value={group.color}
                  onChange={(c) => updateGroup(group.id, { color: c })}
                  size="sm"
                />
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setSaveDialogOpen(true)}>
                <Save className="size-4 mr-2" />
                保存为收藏集
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive focus:bg-destructive/10 font-medium cursor-pointer"
                onClick={handleDeleteGroup}
              >
                <Trash2 className="size-4 mr-2" />
                删除分组
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <GroupCategoryStrip
          groupId={group.id}
          activeCategoryId={activeCategoryValid ? activeCategoryId : null}
          onSelect={setActiveCategoryId}
          activeColor={activeColor}
        />

        <div className="px-2 pb-2">
          {visibleTabs.length === 0 && !isDragOver && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground select-none">
              <Layers className="size-10 mb-3 opacity-30" />
              {activeCategoryId !== null && activeCategoryValid ? (
                <p className="text-sm">{t("groupCategory_noTabsInCategory")}</p>
              ) : (
                <>
                  <p className="text-sm">该分组暂无标签页</p>
                  <p className="text-xs mt-1 opacity-70">从右侧「打开的标签页」拖入即可添加</p>
                </>
              )}
            </div>
          )}

          {visibleTabs.map((tab) => (
            <BaseTabRow
              key={tab.id}
              title={tab.title}
              url={tab.url}
              favicon={tab.favicon}
              selected={selected.has(tab.id)}
              showCheckbox
              onSelect={(checked) => handleToggleSelect(tab.id, checked)}
              onClick={() => focusOrOpenTab(tab.url)}
              actions={
                <div className="flex items-center gap-0.5">

                  <DropdownMenu
                    open={saveMenuOpenMap[tab.id] ?? false}
                    onOpenChange={(open) => setSaveMenuOpenMap(prev => ({ ...prev, [tab.id]: open }))}
                  >
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => e.stopPropagation()}
                        title={savedTabIds.has(tab.id) ? "已保存！" : "保存到收藏集"}
                        className={cn("size-6 text-muted-foreground", savedTabIds.has(tab.id) && "text-green-600 hover:text-green-600")}
                      >
                        {savedTabIds.has(tab.id) ? <Check className="size-3" /> : <BookmarkPlus className="size-3" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 max-h-64 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                      {activeCollections.map((c) => (
                        <DropdownMenuItem
                          key={c.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSaveMenuOpenMap(prev => ({ ...prev, [tab.id]: false }));
                            handleSaveTab(tab, c.id);
                          }}
                        >
                          <span className="truncate">{c.name}</span>
                        </DropdownMenuItem>
                      ))}
                      {activeCollections.length > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setSaveMenuOpenMap(prev => ({ ...prev, [tab.id]: false }));
                          setCollectionDialogTab(tab);
                        }}
                      >
                        <FolderPlus className="size-3.5 mr-2" />
                        新建收藏集…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <GroupCategoryMenu groupId={group.id} tab={tab} />
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTabFromGroup(tab.id);
                    }}
                    title="从列表删除"
                    className="size-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              }
            />
          ))}
        </div>
      </div>

      <SaveCollectionDialog
        open={saveDialogOpen}
        defaultName={group.name}
        tabCount={groupTabs.length}
        isSaving={isSaving}
        onConfirm={handleSaveGroup}
        onClose={() => setSaveDialogOpen(false)}
      />

      {collectionDialogTab && (
        <CollectionDialog
          open={!!collectionDialogTab}
          onOpenChange={(open) => { if (!open) { setCollectionDialogTab(null); } }}
          onSubmit={(name, icon) => {
            const state = useWorkspaceStore.getState();
            const activeWorkspace = state.workspaces.find(
              (workspace) => workspace.id === state.activeWorkspaceId,
            );
            if (!isActiveWorkspace(activeWorkspace)) {
              setTargetUnavailable(true);
              return;
            }
            const newCol = state.createCollection(state.activeWorkspaceId, name, icon);
            handleSaveTab(collectionDialogTab, newCol.id);
            setCollectionDialogTab(null);
          }}
        />
      )}
    </div>
  );
}
