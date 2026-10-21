import { beforeEach, describe, expect, it, vi } from 'vitest';
import { proposeGroups } from '../src/ai/providers/generator';
import { draft, page, settings, category } from './fixtures';
let response: unknown;
const fetcher = vi.fn();
beforeEach(() => {
  response = { groups: [{ ...draft, tabIds: [1, 2, 3] }] };
  fetcher.mockReset().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] })));
  vi.stubGlobal('fetch', fetcher);
});
const pages = [1, 2, 3].map(tabId => ({ tabId, page }));
describe('new-group planning contract', () => {
  it('provides existing descriptions and explicit tab references and returns stable proposal references', async () => {
    const result = await proposeGroups(pages, [], settings, 'key');
    expect(result[0].tabIds).toEqual([1, 2, 3]); expect(result[0].id).toMatch(/^new_/);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    const input = JSON.parse(body.messages[1].content);
    expect(input.pages.map((p: { tabId: number }) => p.tabId)).toEqual([1, 2, 3]); expect(input.existing).toEqual([]);
  });
  it.each([
    ['too small', { groups: [{ ...draft, tabIds: [1, 2] }] }],
    ['unknown ref', { groups: [{ ...draft, tabIds: [1, 2, 99] }] }],
    ['duplicate ref', { groups: [{ ...draft, tabIds: [1, 1, 3] }] }],
    ['invalid color', { groups: [{ ...draft, color: 'black', tabIds: [1, 2, 3] }] }],
    ['catchall', { groups: [{ ...draft, name: '其他', tabIds: [1, 2, 3] }] }],
  ])('rejects %s without accepting an executable plan', async (_name, invalid) => {
    response = invalid; await expect(proposeGroups(pages, [], settings, 'key')).rejects.toThrow();
  });
  it('rejects a name already used by an existing native target', async () => {
    await expect(proposeGroups(pages, [category], settings, 'key')).rejects.toThrow('重复');
  });
  it('accepts an intentional empty plan', async () => {
    response = { groups: [] }; expect(await proposeGroups(pages, [], settings, 'key')).toEqual([]);
  });
});
