/* Preface Scheduler — content script
 *
 * Runs once per page load on https://nomad.preface.ai/.
 *
 * 1. Injects a floating, draggable toggle button into a Shadow DOM root
 *    so page CSS (Tailwind etc.) can't bleed into our widget.
 * 2. Reads `enabled` from chrome.storage.sync (default true). When enabled,
 *    waits up to 5s for the target spans to mount, then runs the snippet
 *    below exactly once.
 * 3. Clicking the button (without drag) toggles the persisted state.
 * 4. Dragging the button moves it and persists the position to
 *    chrome.storage.local — per-device, no sync needed.
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // The snippet the extension runs on the page when enabled.
  // Tailwind-styled <span> elements that default to `hidden group-hover:flex`
  // are force-shown by swapping `hidden` -> `flex`.
  // ---------------------------------------------------------------------------
  const SELECTOR =
    'span[class~="hidden"][class~="w-full"][class~="min-w-0"][class~="flex-col"]' +
    '[class~="items-start"][class~="gap-0.5"][class~="group-hover:flex"]';

  function runSnippet() {
    const matches = document.querySelectorAll(SELECTOR);
    matches.forEach((el) => {
      el.classList.remove('hidden');
      el.classList.add('flex');
    });
    return matches.length;
  }

  function waitForTargetsAndRun({ timeoutMs = 5000, intervalMs = 50 } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (runSnippet() > 0) return resolve('matched');
        if (Date.now() - start >= timeoutMs) return resolve('timeout');
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  // ---------------------------------------------------------------------------
  // Toggle widget — Shadow DOM host, drag, persist state + position.
  // ---------------------------------------------------------------------------
  const STORAGE_STATE = 'preface-scheduler:enabled'; // chrome.storage.sync
  const STORAGE_POS = 'preface-scheduler:pos';       // chrome.storage.local
  const DRAG_THRESHOLD = 4; // px — clicks below this count as toggle, above as drag

  function loadCssInto(host) {
    const url = chrome.runtime.getURL('src/toggle.css');
    return fetch(url)
      .then((r) => r.text())
      .then((css) => {
        const style = document.createElement('style');
        style.textContent = css;
        host.appendChild(style);
      })
      .catch(() => {
        // Fall back to no styling rather than failing the widget entirely.
      });
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
        // Suppress the synthetic click that follows a drag.
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
      // Persist drag position only when we actually moved.
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

    await loadCssInto(root);

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
      waitForTargetsAndRun().catch(() => {});
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
