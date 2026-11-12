import { describe, expect, test } from "bun:test";
import zhCN from "../public/_locales/zh_CN/messages.json";

describe("sync recovery messages", () => {
  test("defines migration and conflict copy", () => {
    expect(zhCN.sync_guestDataMerged.message).toContain("$1");
    expect(zhCN.sync_noMigrationTarget.message.length).toBeGreaterThan(0);
    expect(zhCN.sync_invalidParentConflict.message.length).toBeGreaterThan(0);
    expect(zhCN.sync_quotaConflict.message.length).toBeGreaterThan(0);
    expect(zhCN.workspaceLifecycle_legacyArchiveStateLimited.message.length).toBeGreaterThan(0);
  });
});
