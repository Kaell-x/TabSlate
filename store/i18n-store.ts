import { create } from "zustand";
import { persist } from "zustand/middleware";
import { browser } from "wxt/browser";

// 单语言版本：仅维护简体中文，language 固定为 zh_CN。
export type SupportedLanguage = "zh_CN";

interface I18nState {
  language: SupportedLanguage;
  messages: Record<string, { message: string }> | null;
  isHydrated: boolean;
  setLanguage: (lang: SupportedLanguage) => Promise<void>;
  _hasHydrated: () => void;
}

export function resolveAcceptLanguage(_lang: SupportedLanguage): string {
  return "zh-CN";
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      language: "zh_CN",
      messages: null,
      isHydrated: false,
      setLanguage: async () => {
        try {
          const url = browser.runtime.getURL("_locales/zh_CN/messages.json" as any);
          const response = await fetch(url);
          const data = await response.json();
          set({ language: "zh_CN", messages: data });
        } catch (err) {
          console.error("Failed to load locales for zh_CN:", err);
          set({ language: "zh_CN", messages: null });
        }
      },
      _hasHydrated: () => {
        set({ isHydrated: true });
      }
    }),
    {
      name: "tabslate-i18n",
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Re-fetch the language file on load to ensure it's up to date.
          state.setLanguage("zh_CN").then(() => {
            state._hasHydrated();
          });
        }
      },
    }
  )
);
