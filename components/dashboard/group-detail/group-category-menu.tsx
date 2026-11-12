import * as React from "react";
import { Check, Tags } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useGroupsStore, type GroupTab } from "@/store/groups-store";
import { useTranslation } from "@/hooks/use-translation";

interface GroupCategoryMenuProps {
  groupId: string;
  tab: GroupTab;
}

export function GroupCategoryMenu({ groupId, tab }: GroupCategoryMenuProps) {
  const { t } = useTranslation();
  const allCategories = useGroupsStore(s => s.groupCategories);
  const toggleTabCategory = useGroupsStore(s => s.toggleTabCategory);
  const categories = React.useMemo(
    () => allCategories.filter(c => c.groupId === groupId).sort((a, b) => a.position - b.position),
    [allCategories, groupId],
  );
  const assignedCount = tab.categoryIds?.length ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => e.stopPropagation()}
          title={t("groupCategory_manage")}
          className={cn(
            "size-6",
            assignedCount > 0
              ? "text-primary hover:text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Tags className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 max-h-64 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {categories.length === 0 && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("groupCategory_emptyMenu")}
          </div>
        )}
        {categories.map((c) => {
          const active = (tab.categoryIds ?? []).includes(c.id);
          return (
            <DropdownMenuItem
              key={c.id}
              onSelect={(e) => {
                e.preventDefault();
                toggleTabCategory(tab.id, c.id);
              }}
            >
              <span className="mr-2 flex size-3.5 items-center justify-center">
                {active && <Check className="size-3" />}
              </span>
              <span className="truncate">{c.name}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
