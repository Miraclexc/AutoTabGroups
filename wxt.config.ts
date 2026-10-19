import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'AutoTabGroups',
    description: '使用网页语义与自定义分类整理 Chrome 标签页。',
    minimum_chrome_version: '140',
    permissions: ['tabs', 'tabGroups', 'scripting', 'storage', 'sidePanel', 'alarms'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: '打开 AutoTabGroups' },
  },
});
