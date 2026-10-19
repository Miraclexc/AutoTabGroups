import { mockModelReply } from './mock-models.mjs';
import { createServer } from 'node:http';

// Local-only deterministic fixture service; never forwards requests or logs page data.
const group = { name: '插件开发', description: '浏览器插件开发文档和技术讨论', include: ['Chrome', 'extension', '插件'], exclude: ['旅行'], color: 'blue' };
const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
  if (request.method !== 'POST') { response.writeHead(405); response.end('{}'); return; }
  try {
    let text = '';
    for await (const chunk of request) {
      text += chunk;
      if (text.length > 1_000_000) { response.writeHead(413); response.end('{}'); return; }
    }
    const body = JSON.parse(text);
    const reply = mockModelReply(request.url, body, [group]);
    if (reply) response.end(JSON.stringify(reply));
    else { response.writeHead(404); response.end('{}'); }
  } catch { response.writeHead(400); response.end('{}'); }
});
server.listen(4317, '127.0.0.1', () => {
  console.log('Mock models: http://127.0.0.1:4317/v1 — no external API requests, use any model name and no API key.');
});
