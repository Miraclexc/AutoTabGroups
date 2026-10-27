import { z } from 'zod';
import { colors, settingsSchema, type Category, type Settings, type TabSnapshot, type TaskItem } from './schemas';
import { uiPreferencesPatchSchema, type UiPreferences } from './ui-preferences';
import type { UserMessage } from '../i18n';
import { AppError } from './errors';

export const actionNames = ['organize-current', 'organize-window', 'organize-window-with-new'] as const;
export const organizeActionSchema = z.enum(actionNames);
export const ORGANIZER_STATE_CHANGED = 'organizer-state-changed';
export type OrganizeAction = z.infer<typeof organizeActionSchema>;
export const profileSchema = z.object({
  id: z.string().min(1), name: z.string(), description: z.string().max(5000),
  color: z.enum(colors), titles: z.array(z.string()).default([]),
  source: z.enum(['generated', 'user', 'legacy']).default('legacy'),
  sampleCount: z.number().int().nonnegative().optional(),
});
export type GroupProfile = z.infer<typeof profileSchema>;
export const workspaceSchema = z.object({ version: z.literal(2), settings: settingsSchema, profiles: z.array(profileSchema), revision: z.number().int() });
export type Workspace = z.infer<typeof workspaceSchema>;
export interface NativeTarget extends Category {
  nativeId: number; windowId: number; profileId: string;
}
export interface GroupView extends NativeTarget { members: TabSnapshot[]; source: GroupProfile['source']; sampleCount?: number }
export interface GroupShape { id: number; title: string; windowId: number }
export interface Proposal extends Category { tabIds: number[] }
export interface OriginalGroup { id: number; title: string; color: Category['color']; collapsed: boolean; profileId?: string; removedByOperation?: boolean; restoredId?: number }
export interface Mutation {
  tab: TabSnapshot; targetGroupId: number; applied: boolean; undone?: boolean; originalGroup?: OriginalGroup;
}
export interface Journal {
  id: string; sessionId: string; windowId: number; createdAt: number;
  records: Mutation[]; pending?: boolean; message?: UserMessage;
}
export type Stage = 'prepare' | 'existing' | 'apply-existing' | 'plan' | 'final' | 'apply-final' | 'done';
export interface OrganizeItem extends TaskItem { pass?: 'existing' | 'final' }
export interface OrganizeTask {
  version: 3; id: string; sessionId: string; windowId: number; action: OrganizeAction;
  source: 'sidebar' | 'shortcut' | 'menu' | 'retry';
  status: 'running' | 'completed' | 'partial' | 'cancelled' | 'interrupted' | 'failed';
  stage: Stage; createdAt: number; message?: UserMessage; allowNew: boolean;
  outputLocale: UiPreferences['locale'];
  creationReason?: 'explicit' | 'empty-window'; settings: Settings;
  initialGroups: GroupShape[]; targets: NativeTarget[]; proposals?: Proposal[];
  items: OrganizeItem[]; journal: Mutation[]; bypassCache?: boolean;
}
export interface Diagnostic { action: string; source: string; at: number; windowId?: number; executed: boolean; message: UserMessage }
export interface OrganizerState {
  settings: Settings; revision: number; groups: GroupView[]; tabs: (TabSnapshot & { pinned: boolean; eligible: boolean; active: boolean })[];
  task: OrganizeTask | null; journal: Journal | null; diagnostic: Diagnostic | null;
  sessionId: string; hasGeneratorKey: boolean; hasClassifierKey: boolean; hasReaderKeys: { tavily: boolean; deepseek: boolean }; busy: boolean;
}
const tab = z.object({ id: z.number().int(), windowId: z.number().int(), url: z.string(), title: z.string(), groupId: z.number().int(), index: z.number().int() });
export const readerKeysSchema = z.object({ tavily: z.string().max(4000).optional(), deepseek: z.string().max(4000).optional() });
const editor = z.object({ name: z.string().trim().min(1).max(200), description: z.string().trim().max(5000), color: z.enum(colors) });
export const organizerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('save-ui-preferences'), patch: uiPreferencesPatchSchema }),
  z.object({ type: z.literal('workspace-state'), windowId: z.number().int() }),
  z.object({ type: z.literal('organize'), action: organizeActionSchema, windowId: z.number().int(), tabId: z.number().int().optional() }),
  z.object({ type: z.literal('retry-items'), taskId: z.string(), tabIds: z.array(z.number().int()).min(1), bypassCache: z.boolean() }),
  z.object({ type: z.literal('cancel') }), z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('save-config'), settings: settingsSchema, revision: z.number().int(), generatorKey: z.string().max(4000).optional(), classifierKey: z.string().max(4000).optional(), readerKeys: readerKeysSchema.optional() }),
  z.object({ type: z.literal('test-config'), settings: settingsSchema, provider: z.enum(['generator', 'classifier']), generatorKey: z.string().max(4000).optional(), classifierKey: z.string().max(4000).optional() }),
  z.object({ type: z.literal('test-reader'), settings: settingsSchema, readerKeys: readerKeysSchema.optional() }),
  z.object({ type: z.literal('edit-group'), groupId: z.number().int(), windowId: z.number().int(), profileId: z.string(), expected: editor, value: editor }),
  z.object({ type: z.literal('describe-group'), groupId: z.number().int(), windowId: z.number().int() }),
  z.object({ type: z.literal('create-manual'), windowId: z.number().int(), tabs: z.array(tab).min(1), value: editor }),
  z.object({ type: z.literal('move-manual'), tab, groupId: z.number().int() }),
  z.object({ type: z.literal('locate-tab'), tab }),
  z.object({ type: z.literal('clear-cache') }), z.object({ type: z.literal('clear-task') }),
  z.object({ type: z.literal('export-config') }),
  z.object({ type: z.literal('preview-import'), data: z.unknown() }),
  z.object({ type: z.literal('import-config'), data: z.unknown(), revision: z.number().int() }),
  z.object({ type: z.literal('acknowledge-result') }),
]);
export type OrganizerCommand = z.infer<typeof organizerCommandSchema>;
export async function dispatch<T = void>(command: OrganizerCommand): Promise<T> {
  const response = await chrome.runtime.sendMessage(command);
  if (!response?.ok) {
    if (response?.error && typeof response.error === 'object') throw new AppError(response.error.code, response.error.params);
    if (response?.error) throw new Error(response.error);
    throw new AppError('messages.the_background_service_did_not_respond_please_retry');
  }
  return response.data as T;
}
