const SETTINGS_KEY = 'claudeExporterSettings';
const input = document.getElementById('outputPath');
const savedMsg = document.getElementById('savedMsg');

chrome.storage.local.get(SETTINGS_KEY, (result) => {
  const settings = result[SETTINGS_KEY] || {};
  input.value = settings.outputPath || 'claude-chats';
});

let saveTimeout;
input.addEventListener('input', () => {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const outputPath = input.value.trim() || 'claude-chats';
    chrome.storage.local.set({ [SETTINGS_KEY]: { outputPath } });
    savedMsg.classList.add('visible');
    setTimeout(() => savedMsg.classList.remove('visible'), 1500);
  }, 400);
});
