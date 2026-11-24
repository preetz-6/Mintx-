// Background service worker: opens the side panel and wires the context menu.
// It never reads page content; the panel injects the extractor only when the user sends a message.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "mintx-ask", title: "Ask Mintx about the selection", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "mintx-ask" || !tab) return;
  chrome.sidePanel.open({ windowId: tab.windowId });   // must run inside the user gesture
  chrome.storage.session.set({ pending: { prompt: "Explain the selected text.", at: Date.now() } });
});
