import type { Category, CategoryDraft, Classification, PageInput } from '../shared/schemas';

export interface GroupGenerator { generate(pages: PageInput[], signal?: AbortSignal): Promise<CategoryDraft[]> }
export interface TabClassifier { classify(page: PageInput, categories: Category[], signal?: AbortSignal): Promise<Classification> }
