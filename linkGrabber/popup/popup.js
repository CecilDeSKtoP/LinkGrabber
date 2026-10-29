document.addEventListener('DOMContentLoaded', () => {
  const toggleEnabled = document.getElementById('toggleEnabled');
  const modifierSelect = document.getElementById('modifierSelect');
  const checkDeduplicate = document.getElementById('checkDeduplicate');
  const statCount = document.getElementById('statCount');
  const resetStatBtn = document.getElementById('resetStatBtn');
  const guideKeyBadge = document.getElementById('guideKeyBadge');

  function updateGuideBadge(modifier) {
    switch (modifier) {
      case 'alt':
        guideKeyBadge.textContent = 'Alt';
        break;
      case 'shift':
        guideKeyBadge.textContent = 'Shift';
        break;
      case 'ctrl':
        guideKeyBadge.textContent = 'Ctrl';
        break;
      case 'ctrlOrCmd':
      default:
        guideKeyBadge.textContent = 'Ctrl (or Cmd)';
        break;
    }
  }

  // Load sync settings
  if (chrome?.storage?.sync) {
    chrome.storage.sync.get(['enabled', 'deduplicate', 'modifierKey'], (items) => {
      if (items.enabled !== undefined) {
        toggleEnabled.checked = items.enabled;
      }
      if (items.deduplicate !== undefined) {
        checkDeduplicate.checked = items.deduplicate;
      }
      if (items.modifierKey !== undefined) {
        modifierSelect.value = items.modifierKey;
        updateGuideBadge(items.modifierKey);
      }
    });
  }

  // Load cumulative stats
  function loadStats() {
    if (chrome?.storage?.local) {
      chrome.storage.local.get(['totalGrabbed'], (items) => {
        statCount.textContent = (items.totalGrabbed || 0).toLocaleString();
      });
    }
  }
  loadStats();

  // Save changes
  toggleEnabled.addEventListener('change', () => {
    chrome.storage?.sync?.set({ enabled: toggleEnabled.checked });
  });

  checkDeduplicate.addEventListener('change', () => {
    chrome.storage?.sync?.set({ deduplicate: checkDeduplicate.checked });
  });

  modifierSelect.addEventListener('change', () => {
    const val = modifierSelect.value;
    updateGuideBadge(val);
    chrome.storage?.sync?.set({ modifierKey: val });
  });

  resetStatBtn.addEventListener('click', () => {
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ totalGrabbed: 0 }, () => {
        statCount.textContent = '0';
      });
    }
  });
});
