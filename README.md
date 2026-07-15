# evendev

Development monorepo for Even G2 glasses apps built on the Even Hub SDK.

Docs: https://hub.evenrealities.com/docs/get-started/overview

## Repo layout

One git repo at the root; each top-level folder is a standalone app with its own `package.json`, `app.json`, and build output.

```
evendev/
├── README.md
├── .gitignore                  # ignores node_modules/ and dist/ across all apps
└── counter/                    # first app — simple tap counter
    ├── app.json                # Even Hub manifest (id, version, entrypoint, permissions)
    ├── package.json            # per-app deps and scripts
    ├── vite.config.js
    ├── index.html              # entrypoint referenced by app.json
    └── src/
        ├── main.jsx
        ├── App.jsx             # bridges React state ↔ Even Hub page containers
        └── styles.css
```

Each app is self-contained — install and build inside its own folder.

## App anatomy (counter)

The counter renders a number on the glasses' 576×288 canvas and increments on a ring/temple tap. Two surfaces run in parallel:

- **Glasses surface** — driven by `@evenrealities/even_hub_sdk`. `waitForEvenAppBridge()` gets a handle, `createStartUpPageContainer` seeds the initial view, `rebuildPageContainer` redraws on state change, and `onEvenHubEvent` receives `CLICK_EVENT`s from the hardware.
- **Browser surface** — plain React DOM. Useful as a dev fallback (a button that increments the same state) so you can iterate without the simulator open.

Text is positioned with `@evenrealities/pretext` (`getTextWidth`, `measureTextWrap`) so wrapping matches what the glasses render.

`app.json` fields worth knowing:

| field | purpose |
| --- | --- |
| `package_id` | reverse-DNS id (`com.vixen.counter`) — must be unique per app |
| `edition` / `min_app_version` | Even Hub compatibility |
| `entrypoint` | HTML file the runtime loads (`index.html`, resolved against `dist/` after build) |
| `permissions` | request OS capabilities; empty for counter |

## Prerequisites

- Node 20+ and npm
- Install the Even Hub CLI + simulator once, globally:

  ```sh
  npm i -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
  ```

## Develop the counter

From `counter/`:

```sh
npm install                     # first time only
npm run dev                     # vite on http://localhost:5173
npm run sim                     # in a second terminal — opens simulator against the dev server
```

`npm run sim` runs `evenhub-simulator http://localhost:5173`. The simulator window shows the glasses canvas and exposes tap/gesture controls that fire `CLICK_EVENT` into the bridge. Edits under `src/` hot-reload in both the browser tab and the simulator.

If you only want the browser fallback (no simulator), just visit `http://localhost:5173` and click the on-screen button.

## Build + package for sideload

From `counter/`:

```sh
npm run build                                    # vite build → dist/
evenhub pack app.json dist -o counter.ehpk       # produces the sideloadable package
```

The `.ehpk` bundles `app.json` plus everything under `dist/`. Preview the built bundle locally with:

```sh
npm run preview                 # serves dist/ on http://localhost:4173
evenhub-simulator http://localhost:4173
```

## Sideload onto the glasses

1. Build and pack as above to get `counter.ehpk`.
2. Upload the `.ehpk` as a **private build** in the Even developer portal, or generate a **sideload QR** for it.
3. Scan the QR from the Even companion app on your phone (glasses paired) — the app installs to the G2 and appears in the hub launcher.

Version bumps: increment `version` in `app.json` before repacking so the glasses replace the previous install instead of rejecting it as identical.

## Adding a new app

1. `cp -R counter my-new-app` (or scaffold fresh), then edit `app.json`:
   - unique `package_id`
   - new `name`, `tagline`, reset `version` to `0.1.0`
2. `cd my-new-app && npm install`
3. Same dev / build / pack loop as above.
