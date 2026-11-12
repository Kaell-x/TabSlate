import * as React from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useGroupsStore, type GroupCategory } from "@/store/groups-store";
import { useTranslation } from "@/hooks/use-translation";

const PALETTE = ["#3b82f6", "#f59e0b", "#8b5cf6", "#10b981", "#ec4899", "#14b8a6"];
export const ALL_CATEGORY_COLOR = "#6b7280";

// 分类颜色由创建时的 position 派生（分类创建后不改名、不排序，颜色稳定）。
export function categoryColor(c: GroupCategory): string {
  return PALETTE[c.position % PALETTE.length];
}

interface GroupCategoryStripProps {
  groupId: string;
  activeCategoryId: string | null;
  onSelect: (categoryId: string | null) => void;
  activeColor: string;
}

export function GroupCategoryStrip({ groupId, activeCategoryId, onSelect, activeColor }: GroupCategoryStripProps) {
  const { t } = useTranslation();
  const allCategories = useGroupsStore(s => s.groupCategories);
  const createCategory = useGroupsStore(s => s.createCategory);
  const deleteCategory = useGroupsStore(s => s.deleteCategory);
  const categories = React.useMemo(
    () => allCategories.filter(c => c.groupId === groupId).sort((a, b) => a.position - b.position),
    [allCategories, groupId],
  );

  const [adding, setAdding] = React.useState(false);
  const [newName, setNewName] = React.useState("");

  const handleCreate = () => {
    const name = newName.trim();
    if (name) { createCategory(groupId, name); }
    setNewName("");
    setAdding(false);
  };

  return (
    <div
      className="gcat-strip"
      style={{ background: `color-mix(in srgb, ${activeColor} 4.5%, var(--background))` }}
    >
      <button
        onClick={() => onSelect(null)}
        className={`gcat-tab${activeCategoryId === null ? " gcat-active" : ""}`}
        style={{ ["--c" as string]: ALL_CATEGORY_COLOR }}
      >
        <span className="gcat-dot" />
        {t("groupCategory_all")}
      </button>

      {categories.map((c) => {
        const active = activeCategoryId === c.id;
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`gcat-tab${active ? " gcat-active" : ""}`}
            style={{ ["--c" as string]: categoryColor(c) }}
          >
            <span className="gcat-dot" />
            <span>{c.name}</span>
            <span
              className="gcat-close"
              title={t("groupCategory_delete")}
              onClick={(e) => {
                e.stopPropagation();
                if (active) { onSelect(null); }
                deleteCategory(c.id);
              }}
            >
              <X className="size-3" />
            </span>
          </button>
        );
      })}

      {adding ? (
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onBlur={handleCreate}
          placeholder={t("groupCategory_add")}
          className="h-8 w-28 px-2 py-0 text-sm mx-1 mb-1"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") { handleCreate(); }
            if (e.key === "Escape") {
              setNewName("");
              setAdding(false);
            }
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          title={t("groupCategory_add")}
          className="gcat-tab gcat-add"
        >
          <Plus className="size-4" />
        </button>
      )}
    </div>
  );
}
