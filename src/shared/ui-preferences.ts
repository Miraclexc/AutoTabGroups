import { z } from 'zod';

export const UI_PREFERENCES_KEY = 'ui.preferences.v1';
export const uiPreferencesSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  locale: z.enum(['zh-CN', 'en']).default('zh-CN'),
});
export const uiPreferencesPatchSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  locale: z.enum(['zh-CN', 'en']).optional(),
});
export type UiPreferences = z.infer<typeof uiPreferencesSchema>;
export async function readUiPreferences(): Promise<UiPreferences> {
  const raw = (await chrome.storage.local.get(UI_PREFERENCES_KEY))[UI_PREFERENCES_KEY];
  const parsed = uiPreferencesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : uiPreferencesSchema.parse({});
}
let pending: Promise<unknown> = Promise.resolve();
export function saveUiPreferences(patch: Partial<UiPreferences>): Promise<UiPreferences> {
  const operation = pending.then(async () => {
    const next = uiPreferencesSchema.parse({ ...await readUiPreferences(), ...patch });
    await chrome.storage.local.set({ [UI_PREFERENCES_KEY]: next });
    return next;
  });
  pending = operation.catch(() => {});
  return operation;
}
