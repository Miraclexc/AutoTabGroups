import { describe, expect, it, vi } from 'vitest';
import { createClassifier } from '../src/ai/providers/classifier';
import { routeInstructions } from '../src/ai/providers/choices';
import { settingsSchema, type Settings } from '../src/shared/schemas';
import { decide } from '../src/grouping/decision-policy';
import { category, jevReply, page, settings } from './fixtures';

const config = (backend: Settings['classifier']['backend'], extra: Partial<Settings['classifier']> = {}): Settings => ({ ...settings, generator: { ...settings.generator }, classifier: { ...settings.classifier, backend, baseUrl: 'https://mock.example/custom/v1', model: 'gpt-6-luna', ...extra } });
const answer = () => jevReply().answers.route;
const decisionReply = () => ({ model: 'gpt-6-luna', answers: [{ ...answer(), name: 'route', probabilities: Object.entries(answer().probabilities).map(([value, probability]) => ({ value, probability })) }] });
const chatReply = (text = JSON.stringify(answer())) => ({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
const fake = (data: unknown, status = 200) => vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(data), { status }));

describe('selectable classification backends (mock HTTP only)', () => {
  it.each(['jev', 'openai-decisions', 'llm'] as const)('%s sends the shared semantic rules and only one abstention option for metadata and name-only categories', async backend => {
    const fetcher = fake(backend === 'jev' ? jevReply() : backend === 'llm' ? chatReply() : decisionReply());
    const metadata = { ...page, description: '' };
    const result = await createClassifier(config(backend), '', fetcher).classify(metadata, [{ ...category, description: '', include: [], exclude: [] }]);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    const instructions = backend === 'jev' ? body.questions.route.instructions : backend === 'llm' ? body.messages[0].content : body.questions[0].instructions;
    const choices = backend === 'jev' ? body.questions.route.criteria : backend === 'llm' ? JSON.parse(body.messages[1].content).choices : Object.fromEntries(body.questions[0].choices.map((item: { value: string; description: string }) => [item.value, item.description]));
    const input = backend === 'jev' ? body.state : backend === 'llm' ? JSON.parse(body.messages[1].content).page : JSON.parse(body.input);
    expect(instructions).toContain(routeInstructions);
    expect(Object.keys(choices)).toEqual(['group_0', 'none']);
    expect(choices.group_0).toContain(category.name);
    expect(choices.none).toContain('信息确实不足');
    expect(input).toEqual(metadata);
    expect(decide(result, [category], settings).categoryId).toBe(category.id);
  });
  it.each(['jev', 'openai-decisions', 'llm'] as const)('%s rejects obsolete abstention distributions instead of using their scores', async backend => {
    const a = { choice: 'insufficient_information', confidence: 1, probabilities: { group_0: 0, none: 0, insufficient_information: 1 } };
    const data = backend === 'jev' ? { model: 'mock', answers: { route: { ...a, type: 'choice' } } } : backend === 'llm' ? chatReply(JSON.stringify(a)) : { model: 'mock', answers: [{ ...a, type: 'choice', name: 'route', probabilities: Object.entries(a.probabilities).map(([value, probability]) => ({ value, probability })) }] };
    await expect(createClassifier(config(backend), '', fake(data)).classify(page, [category])).rejects.toThrow('不属于候选列表');
  });
  it.each(['jev', 'openai-decisions'] as const)('%s uses the complete configured URL verbatim, including custom paths and trailing slashes', async backend => {
    for (const baseUrl of ['https://mock.example/custom/route/', 'https://mock.example/v1/systemone', 'https://mock.example/v1/decisions', 'https://mock.example/v1']) {
      const fetcher = fake(backend === 'jev' ? jevReply() : decisionReply());
      await createClassifier(config(backend, { baseUrl }), '', fetcher).classify(page, [category]);
      expect(fetcher.mock.calls[0][0]).toBe(baseUrl);
    }
  });
  it('migrates old settings to Jev and independent default-off thinking', () => {
    const old = settingsSchema.parse({ ...settings, classifier: { baseUrl: settings.classifier.baseUrl, model: 'old-jev' } });
    expect(old.classifier).toMatchObject({ backend: 'jev', model: 'old-jev', thinkingEffort: 'off', protocol: 'openai' });
  });
  it('routes Jev through the factory without chat parameters', async () => {
    const fetcher = fake(jevReply());
    const result = await createClassifier(config('jev', { thinkingEffort: 'high' }), '', fetcher).classify(page, [category]);
    expect(result.scoreSource).toBe('decision_probability');
    expect(fetcher.mock.calls[0][0]).toBe('https://mock.example/custom/v1');
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).not.toHaveProperty('reasoning_effort');
  });
  it('sends OpenAI Decisions choice protocol and maps the probability array to stable IDs', async () => {
    const fetcher = fake(decisionReply());
    const result = await createClassifier(config('openai-decisions', { thinkingEffort: 'high' }), 'fake-key', fetcher).classify(page, [category]);
    expect(result).toMatchObject({ choice: category.id, scoreSource: 'decision_probability', probabilities: { [category.id]: 0.94 } });
    expect(fetcher.mock.calls[0][0]).toBe('https://mock.example/custom/v1');
    const request = fetcher.mock.calls[0][1]!;
    expect(request.headers).toMatchObject({ Authorization: 'Bearer fake-key' });
    const body = JSON.parse(request.body as string);
    expect(body).toMatchObject({ model: 'gpt-6-luna', input: JSON.stringify(page), questions: [{ type: 'choice', name: 'route' }] });
    expect(body.questions[0].choices.map((item: { value: string }) => item.value)).toEqual(['group_0', 'none']);
    expect(body.questions[0].choices[0].description).toContain(category.description);
    expect(body).not.toHaveProperty('thinking'); expect(body).not.toHaveProperty('reasoning_effort');
  });
  it.each(['refusal', 'wrong-name', 'wrong-type', 'duplicate', 'missing', 'bad-sum', 'wrong-winner', 'unknown', 'extra-answer'])('rejects Decisions %s without another backend or invented scores', async issue => {
    const reply = decisionReply();
    switch (issue) {
      case 'refusal': Object.assign(reply.answers[0], { type: 'refusal' }); break;
      case 'wrong-name': reply.answers[0].name = 'another'; break;
      case 'wrong-type': reply.answers[0].type = 'score'; break;
      case 'duplicate': reply.answers[0].probabilities.push(reply.answers[0].probabilities[0]); break;
      case 'missing': reply.answers[0].probabilities.pop(); break;
      case 'bad-sum': reply.answers[0].probabilities[0].probability = 0.5; break;
      case 'wrong-winner': reply.answers[0].choice = 'none'; break;
      case 'unknown': reply.answers[0].choice = 'new-group'; break;
      case 'extra-answer': reply.answers.push(reply.answers[0]); break;
    }
    const fetcher = fake(reply);
    await expect(createClassifier(config('openai-decisions'), '', fetcher).classify(page, [category])).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses classifier thinking independently and labels LLM estimates', async () => {
    const fetcher = fake(chatReply());
    const s = config('llm'); s.generator.thinkingEffort = 'high';
    const result = await createClassifier(s, 'fake-key', fetcher).classify(page, [category]);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.reasoning_effort).toBe('none');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(JSON.parse(body.messages[1].content)).toMatchObject({ page, choices: { group_0: expect.stringContaining(category.description) } });
    expect(body.messages[0].content).toContain('不要总结网页');
    expect(result.scoreSource).toBe('llm_estimate');
    expect(decide(result, [category], settings).message).toContain('模型自评分');
  });
  it('supports Anthropic text blocks and classifier thinking without reading reasoning blocks', async () => {
    const fetcher = fake({ content: [{ type: 'thinking', thinking: 'not json' }, { type: 'text', text: '```json\n' + JSON.stringify(answer()) + '\n```' }], stop_reason: 'end_turn' });
    const result = await createClassifier(config('llm', { protocol: 'anthropic', model: 'claude-sonnet-4-6', thinkingEffort: 'high' }), 'fake-key', fetcher).classify(page, [category]);
    expect(result.choice).toBe(category.id);
    expect(fetcher.mock.calls[0][0]).toBe('https://mock.example/custom/v1/messages');
    expect(fetcher.mock.calls[0][1]!.headers).toMatchObject({ 'x-api-key': 'fake-key' });
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.thinking).toEqual({ type: 'adaptive' }); expect(body.output_config).toEqual({ effort: 'high' });
  });
  it('preserves the unified none outcome in all backends', async () => {
    const a = { choice: 'none', confidence: 1, probabilities: { group_0: 0, none: 1 } };
    for (const backend of ['jev', 'llm', 'openai-decisions'] as const) {
      const data = backend === 'jev' ? jevReply('none', 0) : backend === 'llm' ? chatReply(JSON.stringify(a)) : { model: 'mock', answers: [{ ...a, type: 'choice', name: 'route', probabilities: Object.entries(a.probabilities).map(([value, probability]) => ({ value, probability })) }] };
      const result = await createClassifier(config(backend), '', fake(data)).classify(page, [category]);
      expect(result.probabilities).toEqual({ dev: 0, none: 1 });
      expect(decide(result, [category], settings).status).toBe('unmatched');
    }
  });
  it.each(['not-json', 'missing-scores', 'truncated', 'refused'])('rejects LLM %s', async issue => {
    const data = chatReply(issue === 'not-json' ? 'no JSON' : issue === 'missing-scores' ? '{"choice":"group_0"}' : undefined);
    if (issue === 'truncated') data.choices[0].finish_reason = 'length';
    if (issue === 'refused') Object.assign(data.choices[0].message, { content: null, refusal: 'refused' });
    await expect(createClassifier(config('llm'), '', fake(data)).classify(page, [category])).rejects.toThrow();
  });
  it.each(['jev', 'openai-decisions', 'llm'] as const)('checks budget, model and cancellation before sending %s', async backend => {
    const fetcher = fake({});
    await expect(createClassifier({ ...config(backend), requestBudget: 100 }, '', fetcher).classify(page, [category])).rejects.toThrow('预算');
    await expect(createClassifier(config(backend, { model: '' }), '', fetcher).classify(page, [category])).rejects.toThrow('模型名称');
    await expect(createClassifier(config(backend), '', fetcher).classify(page, [category], AbortSignal.abort())).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('retains low-scored LLM results as ungrouped and does not treat confidence as probability', async () => {
    const data = { choice: 'group_0', confidence: 1, probabilities: { group_0: 0.6, none: 0.4 } };
    const result = await createClassifier(config('llm'), '', fake(chatReply(JSON.stringify(data)))).classify(page, [category]);
    expect(decide(result, [category], settings).status).toBe('uncertain');
  });
});
