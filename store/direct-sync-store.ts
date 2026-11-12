import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { chromeStorageAdapter } from "@/lib/chrome-storage-adapter";
import { generateId } from "@/lib/id";

export type DirectSyncStatus = "idle" | "syncing" | "error" | "offline";

interface DirectSyncState {
  enabled: boolean;
  serverUrl: string;
  token: string;
  deviceId: string;
  lastSyncedAt: number | null;
  status: DirectSyncStatus;
  errorMessage: string | null;
  setConfig: (config: { enabled: boolean; serverUrl: string; token: string }) => void;
  setStatus: (status: DirectSyncStatus, errorMessage?: string | null) => void;
  setLastSyncedAt: (timestamp: number) => void;
}

export const useDirectSyncStore = create<DirectSyncState>()(
  persist(
    (set) => ({
      enabled: false,
      serverUrl: "",
      token: "",
      deviceId: generateId(),
      lastSyncedAt: null,
      status: "idle",
      errorMessage: null,
      setConfig: (config) => set({ ...config }),
      setStatus: (status, errorMessage = null) => set({ status, errorMessage }),
      setLastSyncedAt: (timestamp) => set({ lastSyncedAt: timestamp }),
    }),
    {
      name: "tabslate-direct-sync",
      storage: createJSONStorage(() => chromeStorageAdapter),
      partialize: (state) => ({
        enabled: state.enabled,
        serverUrl: state.serverUrl,
        token: state.token,
        deviceId: state.deviceId,
        lastSyncedAt: state.lastSyncedAt,
      }),
    },
  ),
);
