export function isTrustedUi(sender: Pick<chrome.runtime.MessageSender, 'id' | 'url'>, extensionId: string, root: string): boolean {
  const url = sender.url?.split(/[?#]/)[0];
  return sender.id === extensionId && (url === `${root}sidepanel.html` || url === `${root}options.html`);
}
