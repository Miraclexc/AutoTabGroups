import type { UiPreferences } from '../../shared/ui-preferences';

export type OutputLocale = UiPreferences['locale'];

export function outputLanguage(locale: OutputLocale): string {
  return `Write all generated user-facing text, including group names, descriptions, inclusion and exclusion rules, in ${locale === 'en' ? 'English' : 'Simplified Chinese'}. This language takes precedence over the language of the input pages or existing group names. Preserve proper nouns and technical identifiers when needed. Keep JSON keys, enum values, candidate keys and tab IDs unchanged.`;
}

export function groupWritingRules(locale: OutputLocale): string {
  return `${outputLanguage(locale)}
Group names appear in the browser tab strip and must be short: ${locale === 'en' ? 'prefer 1-3 words, at most 24 characters including spaces and punctuation' : 'prefer 2-6 Chinese characters, at most 8 characters in total'}.
Keep only the distinguishing topic or task in each name. Do not copy page titles, combine unrelated topics, add numbering, parentheses, explanations or generic collection suffixes. Use distinct names for different groups. Put details, purpose and boundaries in descriptions and inclusion/exclusion rules.`;
}
