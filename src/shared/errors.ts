import { ZodError } from 'zod';

export function errorMessage(error: unknown): string {
  if (error instanceof ZodError) return `数据格式不正确：${error.issues[0]?.path.join('.') || '响应'} ${error.issues[0]?.message}`;
  if (error instanceof Error && error.name === 'AbortError') return '操作已取消';
  if (error instanceof Error && error.name === 'TimeoutError') return '请求超时，请稍后重试';
  return error instanceof Error ? error.message.slice(0, 300) : '操作失败';
}
