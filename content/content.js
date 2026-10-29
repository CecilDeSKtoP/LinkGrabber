(() => {
  // Link Grabber - Content Script
  let settings = {
    enabled: true,
    deduplicate: true,
    modifierKey: 'ctrlOrCmd' // 'ctrlOrCmd', 'ctrl', 'alt', 'shift'
  };

  // Load settings from storage
  if (chrome?.storage?.sync) {
    chrome.storage.sync.get(['enabled', 'deduplicate', 'modifierKey'], (items) => {
      if (items) {
        settings = { ...settings, ...items };
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        for (const [key, { newValue }] of Object.entries(changes)) {
          if (newValue !== undefined) {
            settings[key] = newValue;
          }
        }
      }
    });
  }

  let isPotentialDrag = false;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let targetLinkElement = null;

  let selectionBox = null;
  let selectionBadge = null;
  const DRAG_THRESHOLD = 6; // px to distinguish click from drag

  // Helper to test if modifier key matches settings
  function isModifierPressed(e) {
    switch (settings.modifierKey) {
      case 'ctrl':
        return e.ctrlKey;
      case 'alt':
        return e.altKey;
      case 'shift':
        return e.shiftKey;
      case 'ctrlOrCmd':
      default:
        return e.ctrlKey || e.metaKey;
    }
  }

  // Create UI overlay elements
  function createSelectionElements() {
    if (!selectionBox) {
      selectionBox = document.createElement('div');
      selectionBox.className = 'lg-selection-box';

      selectionBadge = document.createElement('div');
      selectionBadge.className = 'lg-selection-badge';
      selectionBadge.textContent = '0 links';
      selectionBox.appendChild(selectionBadge);
    }
  }

  function removeSelectionElements() {
    if (selectionBox && selectionBox.parentNode) {
      selectionBox.parentNode.removeChild(selectionBox);
    }
  }

  // Check intersection between two bounding rectangles
  function intersects(r1, r2) {
    return !(
      r1.right < r2.left ||
      r1.left > r2.right ||
      r1.bottom < r2.top ||
      r1.top > r2.bottom
    );
  }

  function elementIntersectsBox(el, selRect) {
    const rects = el.getClientRects();
    if (!rects || rects.length === 0) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && intersects(r, selRect)) {
        return true;
      }
      return false;
    }
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r.width > 0 && r.height > 0 && intersects(r, selRect)) {
        return true;
      }
    }
    return false;
  }

  // Collect links in the given selection rectangle
  function getLinksInRect(selRect) {
    const anchors = document.querySelectorAll('a[href], area[href]');
    const rawUrls = [];

    anchors.forEach((anchor) => {
      if (elementIntersectsBox(anchor, selRect)) {
        const href = anchor.href;
        if (!href) return;

        const trimmed = href.trim();
        // Filter out non-navigable / script URLs
        const isIgnored =
          trimmed.startsWith('javascript:') ||
          trimmed.startsWith('mailto:') ||
          trimmed.startsWith('tel:') ||
          trimmed === window.location.href + '#' ||
          trimmed === '#' ||
          trimmed.startsWith('about:blank');

        if (!isIgnored) {
          rawUrls.push(trimmed);
        }
      }
    });

    if (settings.deduplicate) {
      return Array.from(new Set(rawUrls));
    }
    return rawUrls;
  }

  // Count links currently intersecting the box (for live preview badge)
  function countIntersectingLinks(selRect) {
    return getLinksInRect(selRect).length;
  }

  // Copy text to clipboard with fallback
  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('[Link Grabber] navigator.clipboard failed, attempting fallback...', err);
      }
    }

    return new Promise((resolve) => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.select();
      let success = false;
      try {
        success = document.execCommand('copy');
      } catch (err) {
        console.error('[Link Grabber] Fallback copy failed:', err);
      }
      document.body.removeChild(textarea);
      resolve(success);
    });
  }

  // Toast Notification System
  let toastContainer = null;

  function showToast(message, type = 'success') {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'lg-toast-container';
      document.documentElement.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = `lg-toast lg-toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = `
        <svg class="lg-toast-icon" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>`;
    } else if (type === 'info') {
      iconSvg = `
        <svg class="lg-toast-icon" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>`;
    } else {
      iconSvg = `
        <svg class="lg-toast-icon" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>`;
    }

    toast.innerHTML = `${iconSvg}<div class="lg-toast-message">${message}</div>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('lg-toast-fadeout');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 250);
    }, 2500);
  }

  // Cancel active drag
  function cancelDrag() {
    isPotentialDrag = false;
    isDragging = false;
    targetLinkElement = null;
    removeSelectionElements();
  }

  // Prevent default native dragging when modifier key is pressed
  window.addEventListener('dragstart', (e) => {
    if (isPotentialDrag || isDragging || (settings.enabled && isModifierPressed(e))) {
      e.preventDefault();
    }
  }, true);

  // Mouse Down: Check if modifier key is held
  window.addEventListener('mousedown', (e) => {
    if (!settings.enabled) return;
    if (e.button !== 0) return; // Only primary (left) button

    if (isModifierPressed(e)) {
      isPotentialDrag = true;
      startX = e.clientX;
      startY = e.clientY;
      currentX = e.clientX;
      currentY = e.clientY;
      targetLinkElement = e.target.closest('a[href]');
      // Prevent browser from doing default text selection during drag
      e.preventDefault();
    }
  }, true);

  // Mouse Move: Start box when dragged past threshold
  window.addEventListener('mousemove', (e) => {
    if (!isPotentialDrag) return;

    currentX = e.clientX;
    currentY = e.clientY;

    const dx = currentX - startX;
    const dy = currentY - startY;
    const dist = Math.hypot(dx, dy);

    if (!isDragging && dist >= DRAG_THRESHOLD) {
      isDragging = true;
      createSelectionElements();
      document.documentElement.appendChild(selectionBox);
      // Clear any text selection that might have started
      if (window.getSelection) {
        window.getSelection().removeAllRanges();
      }
    }

    if (isDragging && selectionBox) {
      e.preventDefault();

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(dx);
      const height = Math.abs(dy);

      selectionBox.style.left = `${left}px`;
      selectionBox.style.top = `${top}px`;
      selectionBox.style.width = `${width}px`;
      selectionBox.style.height = `${height}px`;

      const selRect = {
        left,
        top,
        right: left + width,
        bottom: top + height
      };

      const linkCount = countIntersectingLinks(selRect);
      if (selectionBadge) {
        selectionBadge.textContent = `${linkCount} link${linkCount === 1 ? '' : 's'}`;
      }
    }
  }, true);

  // Mouse Up: Complete drag or handle plain click
  window.addEventListener('mouseup', async (e) => {
    if (!isPotentialDrag) return;

    const wasDragging = isDragging;
    const finalX = e.clientX;
    const finalY = e.clientY;

    // Reset drag state
    cancelDrag();

    if (wasDragging) {
      e.preventDefault();
      e.stopPropagation();

      const left = Math.min(startX, finalX);
      const top = Math.min(startY, finalY);
      const width = Math.abs(finalX - startX);
      const height = Math.abs(finalY - startY);

      if (width < DRAG_THRESHOLD && height < DRAG_THRESHOLD) {
        return;
      }

      const selRect = {
        left,
        top,
        right: left + width,
        bottom: top + height
      };

      const urls = getLinksInRect(selRect);

      if (urls.length > 0) {
        const textToCopy = urls.join('\n');
        const success = await copyToClipboard(textToCopy);

        if (success) {
          showToast(`${urls.length}개의 링크가 클립보드에 복사되었습니다!`, 'success');

          // Increment total stats
          if (chrome?.storage?.local) {
            chrome.storage.local.get(['totalGrabbed'], (res) => {
              const currentTotal = res.totalGrabbed || 0;
              chrome.storage.local.set({ totalGrabbed: currentTotal + urls.length });
            });
          }
        } else {
          showToast('클립보드 복사에 실패했습니다.', 'error');
        }
      } else {
        showToast('선택한 영역 내에 링크가 없습니다.', 'info');
      }
    } else {
      // It was a quick Ctrl+click without dragging
      // If user clicked directly on a link, allow standard Ctrl+click (open in new tab)
      if (targetLinkElement && targetLinkElement.href) {
        window.open(targetLinkElement.href, '_blank');
      }
    }
  }, true);

  // Cancel on Escape key or window blur
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (isDragging || isPotentialDrag)) {
      cancelDrag();
      showToast('선택이 취소되었습니다.', 'info');
    }
  });

  window.addEventListener('blur', () => {
    if (isDragging || isPotentialDrag) {
      cancelDrag();
    }
  });
})();
