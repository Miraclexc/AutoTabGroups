import { ZodError } from 'zod';
import { msg, renderMessage, type MessageParams, type MessageRef, type TranslationKey, type UserMessage } from '../i18n';

export class AppError extends Error {
  readonly detail: MessageRef;
  constructor(code: TranslationKey, params?: MessageParams) {
    const detail = msg(code, params);
    super(renderMessage(detail, 'zh-CN'));
    this.name = 'AppError'; this.detail = detail;
  }
}
export function errorForDisplay(error: unknown): UserMessage {
  if (error instanceof AppError) return error.detail;
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const reason = issue?.code === 'custom' && issue.params?.userMessage ? issue.params.userMessage as MessageRef
      : issue?.code === 'too_small' ? msg('validation.tooSmall', { limit: String(issue.minimum) })
        : issue?.code === 'too_big' ? msg('validation.tooBig', { limit: String(issue.maximum) })
          : msg('validation.invalid');
    return msg('error.invalidData', { detail: msg('validation.field', { path: issue?.path.join('.') || msg('validation.response'), reason }) });
  }
  if (error instanceof Error && error.name === 'AbortError') return msg('messages.operation_cancelled');
  if (error instanceof Error && error.name === 'TimeoutError') return msg('messages.the_request_timed_out_please_retry');
  return error instanceof Error ? error.message.slice(0, 300) : msg('messages.the_operation_failed');
}

const configurationErrors = new Set<TranslationKey>([
  'error.authentication', 'model.configure', 'model.decisionsName', 'model.jevName', 'model.classifierName',
  'model.anthropicProtocol', 'model.openaiProtocol', 'reader.key',
  'messages.enter_the_selected_service_platform_s_api_key',
  'messages.configure_the_selected_page_reader_s_api_key_first',
  'messages.configure_the_standard_chat_service_for_group_descriptions_and',
  'messages.configure_the_classification_model_first', 'messages.enter_the_standard_chat_model_name',
  'messages.configure_the_standard_chat_service_first', 'messages.enter_the_chat_model_name_first',
  'messages.this_model_does_not_support_the_selected_reasoning_effort',
  'messages.reasoning_cannot_be_disabled_for_this_model_choose_a',
]);
export function isConfigurationError(message: UserMessage | undefined): boolean {
  if (!message) return false;
  // Raw external errors may not carry our application codes.
  if (typeof message === 'string') return /HTTP (400|401|403|404)|API.?key|authenticat|unauthorized/i.test(message);
  return configurationErrors.has(message.code)
    || ((message.code === 'error.http' || message.code === 'reader.http')
      && [400, 401, 403, 404].includes(Number(message.params?.status)));
}

export function errorMessage(error: unknown): string {
  return renderMessage(errorForDisplay(error), 'zh-CN');
}
