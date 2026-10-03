// Only opens the side panel when the toolbar icon is clicked. Recording runs inside the panel,
// so nothing here listens to browser traffic and the extension adds no overhead to normal browsing.
const open = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
open();
chrome.runtime.onInstalled.addListener(open);
