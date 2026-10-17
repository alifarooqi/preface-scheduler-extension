# Preface Scheduler — Chrome Extension

A tiny Manifest V3 Chrome extension that runs a toggleable tweak on
[`https://nomad.preface.ai/`](https://nomad.preface.ai/): when ON, the
Tailwind-styled list-item labels that normally only appear on hover
(`hidden` + `group-hover:flex`) are permanently forced to `flex`;
turning OFF reverts them.

Control from a floating, draggable widget that lives on the page itself —
no Chrome toolbar popup required.

```
+----------------------+
| ●  Availability: ON  |  <- click to toggle, drag to reposition
+----------------------+
```

## Install from a CI artifact

Each green build on `main` produces a versioned `.zip` you can load as an
unpacked extension.

1. Open the repo's **Actions** tab and click the latest green **Build and
   zip** run.
2. Scroll to the bottom of the run page → **Artifacts** → download
   `preface-scheduler-v<version>.zip`.
3. Unzip it anywhere on disk.
4. Visit `chrome://extensions` in Chrome.
5. Toggle **Developer mode** on (top right).
6. Click **Load unpacked** and select the unzipped folder.
7. Open <https://nomad.preface.ai/> — a small floating chip should appear in
   the top-left corner.

> On Windows / Linux the same steps apply — only the path differs.

## How it works

- Manifest V3, single content script (`src/content.js`).
- The widget lives inside a closed **Shadow DOM** so page CSS (Tailwind in
  particular) can't bleed into it.
- Enabled/disabled state is stored in `chrome.storage.sync` so it follows
  you across signed-in Chrome devices.
- Button position is stored in `chrome.storage.local` — per-device, not
  synced.
- When enabled, the script polls for the target `<span>` elements up to
  5 seconds on initial load, then applies the ON state (swap `hidden` ->
  `flex`) once. No MutationObserver, no continuous re-application.
- Toggling the chip re-applies immediately: ON removes `hidden` and adds
  `flex`; OFF does the reverse.

### Snippet that's run on the page

The matched `<span>`s are cached in `matches` so both toggle directions
can find them after the ON pass has stripped `hidden`:

```js
const SELECTOR =
  'span[class~="hidden"][class~="w-full"][class~="min-w-0"][class~="flex-col"]' +
  '[class~="items-start"][class~="gap-0.5"][class~="group-hover:flex"]';

let matches = null;

function applyState({ enabled }) {
  if (!matches || matches.length === 0) {
    matches = document.querySelectorAll(SELECTOR);
  }
  matches.forEach((el) => {
    if (enabled) {
      el.classList.remove('hidden');
      el.classList.add('flex');
    } else {
      el.classList.add('hidden');
      el.classList.remove('flex');
    }
  });
}
```

Edit `SELECTOR` / the body of `applyState` in `src/content.js` to point the
extension at any other on-page tweak.

## Local development

```bash
git clone git@github.com:alifarooqi/preface-scheduler-extension.git
cd preface-scheduler-extension
```

1. Open `chrome://extensions`.
2. Toggle **Developer mode** on.
3. **Load unpacked** → point at the cloned folder (not the CI zip, it has
   the same contents).
4. Edit `src/content.js` / `manifest.json`, then hit
   the reload icon on the extension's card in `chrome://extensions` and
   refresh the `nomad.preface.ai` tab.

There is no build step and no `node_modules` — it's plain JS.

## CI / release flow

- Triggered on every push to `main` and via manual **Run workflow**.
- Reads `version` from `manifest.json`.
- For push builds: bumps the patch segment (`0.1.0` → `0.1.1`), writes it
  back to `manifest.json`, and auto-commits the bump.
- Zips the extension into `preface-scheduler-v<version>.zip` (excluding
  `.git`, `.github`, docs, gitignore) and uploads it as a workflow
  artifact.
- Concurrency is keyed on the ref so simultaneous pushes don't fight over
  the version.

To cut a release manually, just edit the `version` field in
`manifest.json`, push to `main`, and the next workflow run will respect
it (and then bump it again on the run after).

## Privacy

- The extension only runs on `https://nomad.preface.ai/*`.
- It does not make any network requests.
- It reads/writes two values to `chrome.storage`: one boolean (enabled)
  to sync storage and one object (`{x,y}`) to local storage.

## Project layout

```
.
├── .github/workflows/build.yml
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── content.js        # toggle widget + the run-once snippet
│   └── content.js        # toggle widget (shadow DOM) + the run-once snippet + inlined styles
├── manifest.json
├── README.md
├── LICENSE
└── .gitignore
```

## License

[MIT](LICENSE)
