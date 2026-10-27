import { z } from 'zod';
import type { MessageRef, UserMessage } from './index';

const reference: z.ZodType<MessageRef> = z.lazy(() => z.object({
  code: z.string().max(160).transform(code => code as MessageRef['code']),
  params: z.record(z.string(), z.union([z.string(), z.number(), reference])).optional(),
}));
export const userMessageSchema: z.ZodType<UserMessage> = z.union([z.string(), reference]);
