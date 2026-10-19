import { z } from 'zod';
import { categoriesSchema, settingsSchema } from './schemas';

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state') }),
  z.object({ type: z.literal('save-settings'), settings: settingsSchema,
    generatorKey: z.string().max(4000).optional(), classifierKey: z.string().max(4000).optional() }),
  z.object({ type: z.literal('save-categories'), categories: categoriesSchema }),
  z.object({ type: z.literal('describe-category'), name: z.string().trim().min(1).max(60) }),
  z.object({ type: z.literal('start'), kind: z.enum(['generate', 'update']), windowId: z.number().int() }),
  z.object({ type: z.literal('cancel') }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('ignore'), tabId: z.number().int(), ignored: z.boolean() }),
  z.object({ type: z.literal('clear-cache') }),
  z.object({ type: z.literal('test-provider'), provider: z.enum(['generator', 'classifier']) }),
  z.object({ type: z.literal('adopt'), groupId: z.number().int(), categoryId: z.string() }),
]);
export type Command = z.infer<typeof commandSchema>;
export function isTrustedUi(sender: Pick<chrome.runtime.MessageSender, 'id' | 'url'>, extensionId: string, root: string): boolean {
  const url = sender.url?.split(/[?#]/)[0];
  return sender.id === extensionId && (url === `${root}sidepanel.html` || url === `${root}options.html`);
}
export async function send<T>(command: Command): Promise<T> {
  const result = await chrome.runtime.sendMessage(command);
  if (!result?.ok) throw new Error(result?.error || '后台没有响应，请重新打开扩展');
  return result.data as T;
}
