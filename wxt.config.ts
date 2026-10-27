import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    default_locale: 'zh_CN',
    minimum_chrome_version: '140',
    permissions: ['tabs', 'tabGroups', 'scripting', 'storage', 'sidePanel', 'alarms', 'contextMenus'],
    host_permissions: ['http://*/*', 'https://*/*'],
    icons: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_title: '__MSG_openExtension__', default_icon: { 16: 'icon/16.png', 32: 'icon/32.png', 48: 'icon/48.png', 128: 'icon/128.png' } },
    commands: {
      'organize-current': { suggested_key: { default: 'Alt+1' }, description: '__MSG_commandCurrent__' },
      'organize-window': { suggested_key: { default: 'Alt+Shift+1' }, description: '__MSG_commandWindow__' },
      'organize-window-with-new': { suggested_key: { default: 'Alt+Shift+2' }, description: '__MSG_commandNew__' },
    },
  },
});
