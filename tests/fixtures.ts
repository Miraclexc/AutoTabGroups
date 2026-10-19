import { defaultSettings, type Category, type PageInput, type Settings, type TabSnapshot } from '../src/shared/schemas';

export const category: Category = { id: 'dev', name: '插件开发', description: '浏览器插件 API、开发文档和问题讨论', include: ['Manifest V3'], exclude: ['浏览器新闻'], color: 'blue' };
export const secondCategory: Category = { ...category, id: 'travel', name: '旅行计划', description: '行程、酒店与景点', include: [], exclude: [] };
export const page: PageInput = { title: 'Chrome extension API', url: 'https://example.com/docs', description: 'Browser extension development', extraction: 'metadata', truncated: false };
export const tab: TabSnapshot = { id: 1, windowId: 10, url: page.url, title: page.title, index: 3, groupId: -1 };
export const settings: Settings = { ...defaultSettings, generator: { ...defaultSettings.generator, model: 'mock-generator' }, classifier: { ...defaultSettings.classifier, model: 'mock-jev' } };
export const draft = { name: category.name, description: category.description, include: category.include, exclude: category.exclude, color: category.color };
export const jevReply = (choice = 'group_0', p = 0.94) => ({
  model: 'mock-jev', answers: { route: { type: 'choice', choice, confidence: 0.91, probabilities: { group_0: p, none: 1 - p } } },
});
