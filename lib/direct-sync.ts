// Direct snapshot sync engine: pushes/pulls the full TabSlate snapshot
// (lib/backup.ts) to a user-configured HTTP endpoint (see
// scripts/sync-server/server.py) with a shared bearer token — no account or
// login involved. Replaces the account-based SyncEngine while enabled.
//
// Lifecycle: the newtab page owns this engine (same as the account SyncEngine),
// so syncing runs while the dashboard is open. Local store changes debounce
// into a push; a periodic pull merges remote changes back and re-pushes the
// merged union so every device converges.

import {
  applySnapshot,
  buildSnapshot,
  isTabSlateSnapshot,
  type TabSlateSnapshot,
} from "@/lib/backup";
import { isSecureServerUrl } from "@/lib/server-url";
import { useDirectSyncStore } from "@/store/direct-sync-store";
import { useBookmarksStore } from "@/store/bookmarks-store";
import { useGroupsStore } from "@/store/groups-store";
import { useWorkspaceStore } from "@/store/workspace-store";

const PUSH_DEBOUNCE_MS = 8_000;
const PULL_INTERVAL_MS = 45_000;

function snapshotHash(snapshot: TabSlateSnapshot): string {
  const text = JSON.stringify(snapshot.data);
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function describeError(err: unknown): { status: "offline" | "error"; message: string } {
  if (err instanceof TypeError) {
    return { status: "offline", message: "Network request failed. Check the server URL and tunnel." };
  }
  const message = err instanceof Error ? err.message : "Sync failed.";
  return { status: "error", message };
}

function readEtag(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const etag: unknown = (body as Record<string, unknown>)["etag"];
  return typeof etag === "string" ? etag : null;
}

export class DirectSyncEngine {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly deviceId: string;
  private unsubscribeFns: Array<() => void> = [];
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pullTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private pushing = false;
  private pulling = false;
  private applyingRemote = false;
  private lastPushedHash: string | null = null;
  private etag: string | null = null;

  constructor(serverUrl: string, token: string, deviceId: string) {
    this.baseUrl = serverUrl.replace(/\/+$/, "");
    this.token = token;
    this.deviceId = deviceId;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.subscribeToStores();
    void this.initialSync();
    this.pullTimer = setInterval(() => { void this.pull(); }, PULL_INTERVAL_MS);
  }

  destroy(): void {
    this.running = false;
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    if (this.pullTimer) {
      clearInterval(this.pullTimer);
      this.pullTimer = null;
    }
    for (const unsubscribe of this.unsubscribeFns) {
      unsubscribe();
    }
    this.unsubscribeFns = [];
    // Flush any pending local changes to the endpoint this engine was
    // configured for (fire-and-forget, same pattern as the account engine).
    void this.push();
  }

  async forceSyncNow(): Promise<void> {
    await this.push();
    await this.pull();
  }

  private subscribeToStores(): void {
    const stores = [useWorkspaceStore, useBookmarksStore, useGroupsStore];
    for (const store of stores) {
      this.unsubscribeFns.push(store.subscribe(() => this.handleLocalChange()));
    }
  }

  private handleLocalChange(): void {
    if (!this.running || this.applyingRemote) {
      return;
    }
    this.schedulePush();
  }

  private schedulePush(): void {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
    }
    this.pushTimer = setTimeout(() => { void this.push(); }, PUSH_DEBOUNCE_MS);
  }

  private async initialSync(): Promise<void> {
    await this.pull();
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
  }

  private async push(): Promise<void> {
    if (this.pushing) {
      return;
    }
    const store = useDirectSyncStore.getState();
    if (!isSecureServerUrl(this.baseUrl)) {
      store.setStatus("error", "Server URL must use https://, or http:// for localhost/127.0.0.1 only.");
      return;
    }
    this.pushing = true;
    store.setStatus("syncing");
    try {
      const snapshot = await buildSnapshot(this.deviceId);
      const hash = snapshotHash(snapshot);
      if (hash === this.lastPushedHash) {
        useDirectSyncStore.getState().setStatus("idle");
        return;
      }
      const res = await fetch(`${this.baseUrl}/snapshot`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...this.authHeaders() },
        body: JSON.stringify(snapshot),
      });
      if (!res.ok) {
        throw new Error(`Push failed with HTTP ${res.status}.`);
      }
      const body: unknown = await res.json().catch(() => null);
      const etag = readEtag(body);
      if (etag) {
        this.etag = etag;
      }
      this.lastPushedHash = hash;
      useDirectSyncStore.getState().setLastSyncedAt(Date.now());
      useDirectSyncStore.getState().setStatus("idle");
    } catch (err) {
      if (!this.running) {
        return;
      }
      const { status, message } = describeError(err);
      useDirectSyncStore.getState().setStatus(status, message);
    } finally {
      this.pushing = false;
    }
  }

  private async pull(): Promise<void> {
    if (this.pulling || !this.running) {
      return;
    }
    if (!isSecureServerUrl(this.baseUrl)) {
      return;
    }
    this.pulling = true;
    try {
      const headers: Record<string, string> = { ...this.authHeaders() };
      if (this.etag) {
        headers["If-None-Match"] = this.etag;
      }
      const res = await fetch(`${this.baseUrl}/snapshot`, { headers });
      if (res.status === 304) {
        return;
      }
      if (res.status === 404) {
        // No snapshot on the server yet — seed it with the local data.
        await this.push();
        return;
      }
      if (!res.ok) {
        throw new Error(`Pull failed with HTTP ${res.status}.`);
      }
      const snapshot: unknown = await res.json();
      if (!isTabSlateSnapshot(snapshot)) {
        throw new Error("The server returned an unrecognized snapshot payload.");
      }
      const etagHeader = res.headers.get("ETag");
      if (etagHeader) {
        this.etag = etagHeader;
      }
      useDirectSyncStore.getState().setStatus("syncing");
      this.applyingRemote = true;
      let changed = false;
      try {
        changed = (await applySnapshot(snapshot)).changed;
      } finally {
        this.applyingRemote = false;
      }
      if (changed) {
        // Push the merged union back so other devices converge on it.
        this.lastPushedHash = null;
        await this.push();
      }
    } catch (err) {
      if (!this.running) {
        return;
      }
      const { status, message } = describeError(err);
      useDirectSyncStore.getState().setStatus(status, message);
    } finally {
      this.pulling = false;
    }
  }
}
