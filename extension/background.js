// Disable the extension action on all pages by default,
// enable only on claude.ai/chat/* conversation pages.

// Set default state on install and every startup
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.disable();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.action.disable();
});

// Check every tab when it updates or is activated
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url) {
    updateActionState(tabId, tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url) {
      updateActionState(tabId, tab.url);
    }
  } catch {
    // Tab might have been closed
  }
});

function updateActionState(tabId, url) {
  if (url && /^https:\/\/claude\.ai\/chat\/.+/.test(url)) {
    chrome.action.enable(tabId);
  } else {
    chrome.action.disable(tabId);
  }
}
