import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'AutoTabGroups',
    description: '使用网页语义与自定义分类整理 Chrome 标签页。',
    minimum_chrome_version: '140',
    permissions: ['tabs', 'tabGroups', 'scripting', 'storage', 'sidePanel', 'alarms', 'contextMenus'],
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_title: '打开 AutoTabGroups', default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' } },
    commands: {
      'organize-current': { suggested_key: { default: 'Alt+1' }, description: '整理当前未分组页面' },
      'organize-window': { suggested_key: { default: 'Alt+Shift+1' }, description: '更新当前窗口分组（无组时初始化）' },
      'organize-window-with-new': { suggested_key: { default: 'Alt+Shift+2' }, description: '更新当前窗口并允许新建分组' },
    },
  },
});
