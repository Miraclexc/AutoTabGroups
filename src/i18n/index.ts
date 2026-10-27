import { createInstance } from 'i18next';
import zh from './locales/zh-CN.json';
import en from './locales/en.json';
import type { UiPreferences } from '../shared/ui-preferences';

type CatalogKey = keyof typeof zh;
export type TranslationKey = CatalogKey | (CatalogKey extends infer K ? K extends `${infer Base}_one` | `${infer Base}_other` ? Base : never : never);
export type TranslationParams = Record<string, string | number>;
export type MessageParams = Record<string, string | number | MessageRef>;
export type Translate = (key: TranslationKey, params?: TranslationParams) => string;
export const resources = { 'zh-CN': { translation: zh }, en: { translation: en } };
export const i18n = createInstance();
void i18n.init({ resources, lng: 'zh-CN', fallbackLng: 'zh-CN', supportedLngs: ['zh-CN', 'en'],
  initAsync: false, keySeparator: false, interpolation: { escapeValue: false }, returnNull: false });

// Pass language explicitly: background work must not change another task's language.
export function translator(locale: UiPreferences['locale']): Translate {
  return (key, params) => i18n.t(key, { ...params, lng: locale });
}
export interface MessageRef { code: TranslationKey; params?: MessageParams }
export type UserMessage = string | MessageRef;
export function msg(code: TranslationKey, params?: MessageParams): MessageRef { return params ? { code, params } : { code }; }
export function renderMessage(message: UserMessage | undefined, locale: string): string {
  if (!message) return '';
  return typeof message === 'string' ? message : translator(locale === 'en' ? 'en' : 'zh-CN')(message.code,
    Object.fromEntries(Object.entries(message.params || {}).map(([key, value]) => [key, typeof value === 'object' ? renderMessage(value, locale) : value])));
}
export function joinMessages(first: UserMessage, second?: UserMessage): UserMessage {
  return second ? msg('messages.combined', { first, second }) : first;
}
