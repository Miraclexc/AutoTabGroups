// Deterministic fixtures shared by the local server and browser tests. No network access.
export function mockModelReply(path, body, groups) {
  let page, criteria, description, proposal;
  if (path === '/v1/systemone') { page = body.state; criteria = body.questions.route.criteria; }
  else if (path === '/v1/decisions') {
    page = JSON.parse(body.input);
    criteria = Object.fromEntries(body.questions[0].choices.map(item => [item.value, item.description]));
  } else if (['/v1/chat/completions', '/v1/messages'].includes(path)) {
    const input = JSON.parse(body.messages.find(item => item.role === 'user').content);
    page = input.page; criteria = input.choices;
    if (input.name) description = { description: `与“${input.name}”相关的文档、学习资料和实践记录。` };
    if (input.existing && input.pages) {
      const ids = input.pages.filter(item => /chrome|extension|插件/i.test(JSON.stringify(item))).map(item => item.tabId);
      proposal = { groups: ids.length >= 3 ? [{ ...groups[0], tabIds: ids }] : [] };
    }
  } else return null;
  let answer;
  if (criteria) {
    const keys = Object.keys(criteria);
    const choice = /chrome|extension|插件/i.test(JSON.stringify(page)) ? keys.find(key => key.startsWith('group_')) || 'none' : 'none';
    answer = { type: 'choice', choice, confidence: 1, probabilities: Object.fromEntries(keys.map(key => [key, key === choice ? 1 : 0])) };
  }
  if (path === '/v1/systemone') return { model: 'mock-jev', answers: { route: answer } };
  if (path === '/v1/decisions') return { model: 'mock-decisions', answers: [{ ...answer, name: 'route', probabilities: Object.entries(answer.probabilities).map(([value, probability]) => ({ value, probability })) }] };
  const text = JSON.stringify(answer || description || proposal || { groups });
  return path === '/v1/messages' ? { content: [{ type: 'thinking', thinking: 'MOCK_REASONING' }, { type: 'text', text }], stop_reason: 'end_turn' } : { choices: [{ message: { content: text }, finish_reason: 'stop' }] };
}
