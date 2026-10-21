/* global window */
window.previewContent = {
  product: 'AutoTabGroups',
  windowLabel: '当前窗口',
  current: { title: 'Chrome 扩展开发指南', domain: 'developer.chrome.com', status: '未分组' },
  counts: { ungrouped: 12, eligible: 9, groups: 3 },
  actions: { current: '整理当前页', update: '更新分组', create: '更新并允许新建分组' },
  actionHelp: '先加入已有组；允许新建时，再整理剩余页面。',
  groups: [
    { name: '插件开发', count: 8, color: '#4b77d1', description: '浏览器扩展、API 与开发文档' },
    { name: '设计参考', count: 5, color: '#b074b8', description: '界面设计、交互与视觉参考' },
    { name: '周末出行', count: 4, color: '#488b70', description: '目的地、路线与旅行安排' }
  ],
  recent: { title: '最近整理', summary: '6 页已归组 · 3 页保持未分组', time: '2 分钟前', undo: '撤销' },
  navigation: ['模型服务', '整理与读取', '快捷键', '外观与语言', '数据与帮助'],
  config: {
    title: '模型服务', subtitle: '设置网页理解与归组判断使用的服务。',
    chatTitle: '标准 Chat 服务', chatHelp: '补充分组说明、分析新组，并判断网页归属。',
    protocol: 'OpenAI 兼容', address: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', key: '••••••••••••••••••••',
    test: '测试连接', status: '已保存 · 当前配置尚未测试',
    classifyTitle: '归组判断服务', reuse: '复用标准 Chat 服务', reuseHelp: '使用上方配置，无需再填写一组密钥。',
    save: '保存配置', privacy: '连接测试使用虚构内容；密钥仅保存在本机，不随配置导出。'
  }
};
