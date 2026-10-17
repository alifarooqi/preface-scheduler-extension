/* Preface Scheduler — content script
 *
 * Runs once per page load on https://nomad.preface.ai/.
 *
 * 1. Injects a floating, draggable toggle button into a Shadow DOM root
 *    so page CSS (Tailwind etc.) can't bleed into our widget.
 * 2. Reads `enabled` from chrome.storage.sync (default true). When enabled,
 *    waits up to 5s for the target spans to mount, then applies the
 *    "shown" state (swap `hidden` -> `flex`) once.
 * 3. Clicking the button (without drag) toggles the persisted state and
 *    immediately re-applies: ON removes `hidden` and adds `flex`, OFF
 *    does the opposite (adds `hidden`, removes `flex`).
 * 4. Dragging the button moves it and persists the position to
 *    chrome.storage.local — per-device, no sync needed.
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // The DOM tweak the extension applies on the page.
  // Tailwind-styled <span> elements that default to `hidden group-hover:flex`:
  //   - when ON  : remove `hidden`, add `flex`  (force-shown)
  //   - when OFF : add `hidden`,    remove `flex` (back to default hover-only)
  // The selector intentionally matches the default hidden state so newly
  // mounted nodes are picked up by either direction without a separate
  // hookup.
  // ---------------------------------------------------------------------------
  const SELECTOR =
    'span[class~="hidden"][class~="w-full"][class~="min-w-0"][class~="flex-col"]' +
    '[class~="items-start"][class~="gap-0.5"][class~="group-hover:flex"]';

  function applyState({ enabled }) {
    const matches = document.querySelectorAll(SELECTOR);
    matches.forEach((el) => {
      if (enabled) {
        el.classList.remove('hidden');
        el.classList.add('flex');
      } else {
        el.classList.add('hidden');
        el.classList.remove('flex');
      }
    });
    return matches.length;
  }

  function waitForTargetsAndRun({ enabled, timeoutMs = 5000, intervalMs = 50 } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (applyState({ enabled }) > 0) return resolve('matched');
        if (Date.now() - start >= timeoutMs) return resolve('timeout');
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  // ---------------------------------------------------------------------------
  // Styles inlined as a string so the content script never has to make a
  // fetch() / chrome.runtime.getURL() round-trip. The previous implementation
  // did exactly that and surfaced "GET chrome-extension://invalid/ net::ERR_FAILED"
  // because MV3 content scripts can't reliably fetch their own bundled
  // resources unless they're listed in web_accessible_resources — and we
  // don't want a public css URL. Inlining is the standard MV3 workaround.
  // ---------------------------------------------------------------------------
  const TOGGLE_CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}

.ps-host {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2147483647;
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
}

.ps-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px 6px 8px;
  border-radius: 999px;
  background: rgba(17, 24, 39, 0.92);
  color: #f9fafb;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  line-height: 1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
  cursor: grab;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  transition: background 0.15s ease, box-shadow 0.15s ease;
  touch-action: none;
}

.ps-btn:hover {
  background: rgba(31, 41, 55, 0.96);
}

.ps-btn:active,
.ps-btn.ps-dragging {
  cursor: grabbing;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
}

.ps-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.18);
  flex: 0 0 auto;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}

.ps-btn[data-state="off"] .ps-dot {
  background: #6b7280;
  box-shadow: 0 0 0 2px rgba(107, 114, 128, 0.18);
}

.ps-label {
  white-space: nowrap;
}

.ps-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`;

  // ---------------------------------------------------------------------------
  // Toggle widget — Shadow DOM host, drag, persist state + position.
  // ---------------------------------------------------------------------------
  const STORAGE_STATE = 'preface-scheduler:enabled'; // chrome.storage.sync
  const STORAGE_POS = 'preface-scheduler:pos';       // chrome.storage.local
  const DRAG_THRESHOLD = 4; // px — clicks below this count as toggle, above as drag

  function loadCssInto(host) {
    const style = document.createElement('style');
    style.textContent = TOGGLE_CSS;
    host.appendChild(style);
  }

  function clampPosition(x, y) {
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - margin);
    const maxY = Math.max(margin, window.innerHeight - margin);
    return {
      x: Math.min(Math.max(margin, x), maxX),
      y: Math.min(Math.max(margin, y), maxY),
    };
  }

  function buildWidget({ initialEnabled, savedPos }) {
    const host = document.createElement('div');
    host.className = 'ps-host';
    host.style.transform = `translate(${savedPos.x}px, ${savedPos.y}px)`;

    const root = host.attachShadow({ mode: 'closed' });

    const btn = document.createElement('button');
    btn.className = 'ps-btn';
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(initialEnabled));
    btn.dataset.state = initialEnabled ? 'on' : 'off';

    const dot = document.createElement('span');
    dot.className = 'ps-dot';
    const label = document.createElement('span');
    label.className = 'ps-label';
    const sr = document.createElement('span');
    sr.className = 'ps-sr';

    btn.appendChild(dot);
    btn.appendChild(label);
    btn.appendChild(sr);
    root.appendChild(btn);

    const syncUi = (enabled) => {
      btn.dataset.state = enabled ? 'on' : 'off';
      btn.setAttribute('aria-pressed', String(enabled));
      label.textContent = enabled ? 'Preface: ON' : 'Preface: OFF';
      sr.textContent = enabled
        ? 'Preface Scheduler is on. Click to turn off.'
        : 'Preface Scheduler is off. Click to turn on.';
    };

    syncUi(initialEnabled);

    // ---- Drag-to-reposition -------------------------------------------------
    let pressX = 0;
    let pressY = 0;
    let startTx = 0;
    let startTy = 0;
    let moved = 0;
    let dragging = false;
    let pointerId = null;

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      pointerId = e.pointerId;
      btn.setPointerCapture(pointerId);
      pressX = e.clientX;
      pressY = e.clientY;
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(host.style.transform);
      startTx = m ? parseFloat(m[1]) : 0;
      startTy = m ? parseFloat(m[2]) : 0;
      moved = 0;
      dragging = false;
    });

    btn.addEventListener('pointermove', (e) => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      const dx = e.clientX - pressX;
      const dy = e.clientY - pressY;
      moved = Math.max(moved, Math.hypot(dx, dy));
      if (!dragging && moved >= DRAG_THRESHOLD) {
        dragging = true;
        btn.classList.add('ps-dragging');
      }
      if (dragging) {
        const next = clampPosition(startTx + dx, startTy + dy);
        host.style.transform = `translate(${next.x}px, ${next.y}px)`;
        e.preventDefault();
      }
    });

    const releasePointer = (e) => {
      if (pointerId === null || e.pointerId !== pointerId) return;
      pointerId = null;
      btn.classList.remove('ps-dragging');
    };
    btn.addEventListener('pointerup', releasePointer);
    btn.addEventListener('pointercancel', releasePointer);

    // Toggle on plain click; suppress clicks that followed a drag.
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (moved >= DRAG_THRESHOLD) {
        moved = 0;
        return;
      }
      const next = btn.dataset.state !== 'on';
      syncUi(next);
      chrome.storage.sync.set({ [STORAGE_STATE]: next });
      // Apply the matching DOM tweak immediately so the page reflects the
      // new state without waiting for a reload.
      applyState({ enabled: next });
      if (dragging) {
        const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(host.style.transform);
        if (m) {
          chrome.storage.local.set({
            [STORAGE_POS]: { x: parseFloat(m[1]), y: parseFloat(m[2]) },
          });
        }
      }
      dragging = false;
      moved = 0;
    });

    // Keep within viewport on resize.
    window.addEventListener('resize', () => {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(host.style.transform);
      if (!m) return;
      const next = clampPosition(parseFloat(m[1]), parseFloat(m[2]));
      host.style.transform = `translate(${next.x}px, ${next.y}px)`;
      chrome.storage.local.set({ [STORAGE_POS]: next });
    });

    return { host, root, syncUi };
  }

  function defaultPosition() {
    return { x: 16, y: 16 };
  }

  async function init() {
    const [{ [STORAGE_STATE]: storedEnabled }, { [STORAGE_POS]: storedPos }] =
      await Promise.all([
        chrome.storage.sync.get({ [STORAGE_STATE]: true }),
        chrome.storage.local.get({ [STORAGE_POS]: defaultPosition() }),
      ]);

    const enabled = storedEnabled !== false;
    const pos = storedPos || defaultPosition();

    const { host, root, syncUi } = buildWidget({
      initialEnabled: enabled,
      savedPos: pos,
    });

    loadCssInto(root);

    // Defer the DOM mount until body exists so we never race SPA hydration.
    (document.body || document.documentElement).appendChild(host);

    // React to state changes from other tabs / popups.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes[STORAGE_STATE]) {
        syncUi(Boolean(changes[STORAGE_STATE].newValue));
      }
    });

    if (enabled) {
      // Fire-and-forget — the snippet is best-effort and one-shot.
      waitForTargetsAndRun({ enabled: true }).catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
