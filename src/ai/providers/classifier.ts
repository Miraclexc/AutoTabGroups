import type { Settings } from '../../shared/schemas';
import type { Fetch } from '../transport';
import { createClassifier as createJevClassifier } from './jev';
import { createDecisionsClassifier } from './decisions';
import { createLlmClassifier } from './llm';

export function createClassifier(settings: Settings, apiKey: string, fetcher?: Fetch) {
  switch (settings.classifier.backend) {
    case 'jev': return createJevClassifier(settings, apiKey, fetcher);
    case 'openai-decisions': return createDecisionsClassifier(settings, apiKey, fetcher);
    case 'llm': return createLlmClassifier(settings, apiKey, fetcher);
    default: throw new Error('未知的分类后端，请重新保存设置');
  }
}
