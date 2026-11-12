import * as React from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImportDialog } from "@/components/dashboard/import-dialog";
import { useDirectSyncStore } from "@/store/direct-sync-store";
import { isSecureServerUrl } from "@/lib/server-url";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/use-translation";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t, tNode } = useTranslation();

  const [importDialogOpen, setImportDialogOpen] = React.useState(false);

  const [searchOverlayEnabled, setSearchOverlayEnabled] = React.useState(false);

  // Direct sync (self-hosted endpoint, no account)
  const directSyncEnabled = useDirectSyncStore(s => s.enabled);
  const directSyncStatus = useDirectSyncStore(s => s.status);
  const directSyncErrorMessage = useDirectSyncStore(s => s.errorMessage);
  const directSyncLastSyncedAt = useDirectSyncStore(s => s.lastSyncedAt);
  const setDirectSyncConfig = useDirectSyncStore(s => s.setConfig);
  const [directSyncUrl, setDirectSyncUrl] = React.useState("");
  const [directSyncToken, setDirectSyncToken] = React.useState("");
  const [directSyncError, setDirectSyncError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setDirectSyncUrl(useDirectSyncStore.getState().serverUrl);
      setDirectSyncToken(useDirectSyncStore.getState().token);
      setDirectSyncError(null);
    }
  }, [open]);

  const requestDirectSyncPermission = async (url: string): Promise<boolean> => {
    try {
      const origin = new URL(url).origin;
      return await chrome.permissions.request({ origins: [`${origin}/*`] });
    } catch {
      return false;
    }
  };

  const applyDirectSyncConfig = async (enable: boolean) => {
    setDirectSyncError(null);
    if (enable) {
      const url = directSyncUrl.trim();
      const token = directSyncToken.trim();
      if (!isSecureServerUrl(url)) {
        setDirectSyncError(t("settings_directSyncUrlInvalid"));
        return;
      }
      if (!token) {
        setDirectSyncError(t("settings_directSyncTokenRequired"));
        return;
      }
      const granted = await requestDirectSyncPermission(url);
      if (!granted) {
        setDirectSyncError(t("settings_directSyncPermissionDenied"));
        return;
      }
      setDirectSyncConfig({ enabled: true, serverUrl: url, token });
      return;
    }
    const previousUrl = useDirectSyncStore.getState().serverUrl;
    setDirectSyncConfig({ enabled: false, serverUrl: previousUrl, token: useDirectSyncStore.getState().token });
    if (previousUrl) {
      try {
        await chrome.permissions.remove({ origins: [`${new URL(previousUrl).origin}/*`] });
      } catch {
        // Ignore — leaving a stale host permission is harmless.
      }
    }
  };

  const handleDirectSyncNow = () => {
    window.dispatchEvent(new Event("tabslate-direct-sync-now"));
  };

  const directSyncStatusText = (() => {
    if (directSyncStatus === "syncing") {
      return t("settings_directSyncStatusSyncing");
    }
    if (directSyncStatus === "error" || directSyncStatus === "offline") {
      return directSyncErrorMessage ?? t("settings_directSyncStatusOffline");
    }
    if (directSyncLastSyncedAt) {
      return t("settings_directSyncLastSynced", [new Date(directSyncLastSyncedAt).toLocaleString()]);
    }
    return t("settings_directSyncStatusNever");
  })();

  React.useEffect(() => {
    if (open && typeof chrome !== "undefined" && chrome.permissions) {
      chrome.permissions.contains({ origins: ["<all_urls>"] }).then(setSearchOverlayEnabled);
    }
  }, [open]);

  const handleToggleSearchOverlay = async (checked: boolean) => {
    if (typeof chrome === "undefined" || !chrome.permissions) return;

    if (checked) {
      const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
      setSearchOverlayEnabled(granted);
    } else {
      const removed = await chrome.permissions.remove({ origins: ["<all_urls>"] });
      if (removed) {
        setSearchOverlayEnabled(false);
      }
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("settings_title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("settings_desc")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-2 -mr-2 min-h-0">
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="rounded-lg border p-3 shadow-sm bg-card/20">
              <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-semibold">{t("settings_generalOverlayTitle")}</h3>
                  <p className="text-xs text-muted-foreground mr-4 mt-0.5">
                    {tNode("settings_generalOverlayDesc", (
                      <kbd className="px-1 py-0.5 rounded-md bg-muted border font-sans text-[10px]">Ctrl+Shift+K</kbd>
                    ))}
                  </p>
                </div>
                <Switch
                  checked={searchOverlayEnabled}
                  onCheckedChange={handleToggleSearchOverlay}
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <h3 className="text-sm font-semibold">{t("settings_generalImportTitle")}</h3>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {t("settings_generalImportDesc")}
              </p>
              <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)} className="cursor-pointer">
                {t("settings_generalImportBtn")}
              </Button>
            </div>

            {/* Direct sync: self-hosted endpoint over SSH tunnel, no account */}
            <div className="space-y-2.5">
              <div className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-sm font-semibold">{t("settings_directSyncTitle")}</h3>
                  <p className="text-xs text-muted-foreground mr-4 mt-0.5 leading-relaxed">
                    {t("settings_directSyncDesc")}
                  </p>
                </div>
                <Switch checked={directSyncEnabled} onCheckedChange={(checked) => void applyDirectSyncConfig(checked)} />
              </div>

              {directSyncEnabled && (
                <div className="space-y-2.5 rounded-lg border p-3 bg-card/20">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="direct-sync-url">
                      {t("settings_directSyncUrlLabel")}
                    </label>
                    <Input
                      id="direct-sync-url"
                      value={directSyncUrl}
                      onChange={(e) => setDirectSyncUrl(e.target.value)}
                      placeholder="http://127.0.0.1:8787"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium" htmlFor="direct-sync-token">
                      {t("settings_directSyncTokenLabel")}
                    </label>
                    <Input
                      id="direct-sync-token"
                      type="password"
                      value={directSyncToken}
                      onChange={(e) => setDirectSyncToken(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  {directSyncError && (
                    <p className="text-xs text-destructive">{directSyncError}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <p className="text-[11px] text-muted-foreground">{directSyncStatusText}</p>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="outline" size="sm" onClick={() => void applyDirectSyncConfig(true)} className="cursor-pointer">
                        {t("settings_directSyncSave")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDirectSyncNow}
                        disabled={directSyncStatus === "syncing"}
                        className="cursor-pointer"
                      >
                        {t("settings_directSyncSyncNow")}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="pt-4 border-t mt-auto flex justify-end shrink-0">
          <Button onClick={() => onOpenChange(false)} className="cursor-pointer">{t("settings_done")}</Button>
        </div>
      </DialogContent>
    </Dialog>
    <ImportDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />
    </>
  );
}
