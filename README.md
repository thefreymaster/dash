# Dash

Dash is a calm, landscape instrument cluster for the car: a large speedometer, a compass
tape, a clock and GPS status laid over a live, heading-up Mapbox map, with day and night
themes. It is a static progressive web app (no backend) that you install on an iPhone's
Home Screen and run from a phone mount.

**Stack:** React 19 + TypeScript 7, Vite 8, Chakra UI 3, Motion, TanStack Query,
Mapbox GL JS 3, SunCalc, and vite-plugin-pwa (Workbox `generateSW`, auto-update). Tests
run with Vitest and linting with oxlint. In production, nginx serves the build inside a
Docker container on the Unraid server, and Cloudflare Tunnel publishes it at
`https://dash.unserver23.net`.

---

## 1. Local development

```sh
npm install
cp .env.example .env.local        # then set VITE_MAPBOX_TOKEN=pk.… (a public Mapbox token)
npm run dev                       # http://localhost:5173
```

- **Demo drive:** open `http://localhost:5173/?demo=1`. A simulated car loops around
  downtown San Francisco through the same pipeline as real GPS. The URL flag lasts for that
  session only; **Settings → Demo drive** keeps demo mode on.
- **Without a token** the app still runs, and the map area shows "Map unavailable".
- **Dev-only helpers:** `window.__dash` in the console, e.g. `__dash.pose.speedMps.set(21)`,
  and a token-free map harness at
  `http://localhost:5173/src/features/map/dev/harness.html?local&sim`.

| Command | What it does |
| --- | --- |
| `npm test` | Vitest, run once (`npm run test:watch` to keep watching) |
| `npm run lint` | oxlint |
| `npm run typecheck` | `tsc -b` |
| `npm run build` | type-check, then a production build into `dist/` (includes `sw.js`) |
| `npm run preview` | serve `dist/` at `http://localhost:4173`, with the service worker |

## 2. Testing on an iPhone over the LAN (before deploying)

```sh
npm run dev:phone
```

This runs `vite --host --mode phone`. In `phone` mode, `vite.config.ts` adds
`@vitejs/plugin-basic-ssl`, so the dev server uses **HTTPS with a self-signed certificate**
that the plugin generates. Everything else is the normal dev server.

1. Put the iPhone on the same Wi-Fi as the Mac. Vite prints the `Network:` URL. The Mac's
   address is also `ipconfig getifaddr en0`.
2. On the iPhone, open `https://<mac-ip>:5173` in Safari. Safari warns that the connection is
   not private: tap **Show Details → visit this website → Visit Website**.
3. Tap **Start driving** and allow Location and Motion.

**Why HTTPS is needed:** Safari offers geolocation, the motion/orientation permission (the
compass) and the screen wake lock only to secure contexts. `http://localhost` counts as
secure, but `http://192.168…` from the phone does not. Over plain `npm run dev`, the phone
loads the page but cannot get location, compass or wake lock.

The dev server does not register the service worker (`devOptions.enabled: false`). To test
installing and updating, use the deployed site.

## 3. Deploying to Unraid

The container is built **on the Unraid host** (the Mac has no Docker). The deploy files:

| File | Role |
| --- | --- |
| `Dockerfile` | `node:24-alpine` runs `npm ci && npm run build`; `nginx:alpine` serves `dist/` on port 80 and has a `HEALTHCHECK` |
| `nginx.conf` | Server block (installed as `conf.d/default.conf`): SPA fallback, PWA-safe caching, gzip, `/healthz` |
| `deploy.sh` | Pull, build, replace the `dash` container, wait for health, keep dated images for rollback |
| `docker-compose.yml` | The same service, for hosts with the Compose plugin |
| `.dockerignore` | Keeps `node_modules`, `dist`, `.git`, `.env*` and mockups out of the build |

### 3.1 Get the code onto the server

Open an SSH session to the server (`ssh root@<server-ip>`). The checkout lives at
`/mnt/user/appdata/dash`.

**Option A: git.** The repo has no remote yet. Push it to a Git host from the Mac first
(`git remote add origin <url> && git push -u origin main`). Then, on the server (check
first that `git --version` works there):

```sh
cd /mnt/user/appdata && git clone <url> dash && cd dash
```

`deploy.sh` then runs `git pull --ff-only` on every deploy.

**Option B: copy the folder from the Mac.** Run this from the repo root on the Mac:

```sh
rsync -av --delete \
  --exclude node_modules --exclude dist --exclude .git --exclude '.env*' --exclude '*.local' \
  ./ root@<server-ip>:/mnt/user/appdata/dash/
```

`--delete` removes files you deleted locally (stale sources would break the type-check).
Excluded paths are never deleted, so the server's `.env` survives. Without a `.git`
folder, `deploy.sh` skips the pull on its own.

### 3.2 Create `.env` on the server

```sh
cd /mnt/user/appdata/dash
cat > .env <<'EOF'
VITE_MAPBOX_TOKEN=pk.your-public-token
# DASH_PORT=3274
EOF
chmod 600 .env
```

- The token is read at **build time** and baked into the JavaScript. Changing it means
  running `./deploy.sh` again.
- Never commit `.env`. The current `.gitignore` covers `.env.local` but not `.env`.
  `deploy.sh` warns if `.env` is tracked.
- **Port:** the default host port is **3274**. Confirm it is free before the first deploy
  (`docker ps --format '{{.Names}} {{.Ports}}' | grep 3274` and `ss -ltn 'sport = :3274'`
  should print nothing). To use a different port, set `DASH_PORT` in `.env`. `deploy.sh`
  refuses a port that is already in use.

### 3.3 Deploy

```sh
./deploy.sh              # or: bash deploy.sh
```

It does the following:

1. Loads `VITE_MAPBOX_TOKEN` and `DASH_PORT` from `.env`. Values already set in the
   environment win. It warns loudly if the token is empty and refuses a secret `sk.` token.
2. Runs `git pull --ff-only` when this is a git checkout with an upstream. Skip it with
   `--no-pull` or `DASH_NO_PULL=1`.
3. Builds `dash:<YYYYmmdd-HHMMSS>[-<git sha>]` and `dash:latest`.
4. Replaces the container named `dash` (`--restart unless-stopped`, `-p $DASH_PORT:80`).
5. Waits for `/healthz` and checks that `/` serves the app. On failure it prints the
   container logs and exits non-zero.
6. Prints the LAN URL and a one-line rollback command, and keeps the 5 newest dated
   images (`DASH_KEEP_IMAGES`).

### 3.4 Verify

```sh
curl http://<server-ip>:3274/healthz              # → ok
curl -sI http://<server-ip>:3274/ | grep -i cache # → Cache-Control: no-cache
docker ps --filter name=dash                       # STATUS shows "(healthy)" after ~10 s
```

`dash` appears in Unraid's **Docker** tab. It does not come from an Unraid template, so
redeploy with `./deploy.sh`, not with the tab's update action. After the next reboot, check
that it came back up. If it did not, turn on **Autostart** for `dash` in the Docker tab.

**Compose instead of `deploy.sh`:** only if the Compose plugin is installed
(`docker compose version`). Run `docker compose up -d --build`. It reads the same `.env`
and uses the same container name, so use one method or the other (`docker rm -f dash`
before switching). Compose keeps no dated images for rollback.

## 4. Cloudflare Tunnel

Add a route for Dash to the existing tunnel:

1. **Zero Trust → Networks → Tunnels →** the tunnel **→ Configure → Public Hostname**
   (called *Published application routes* in newer dashboards) **→ Add**.
2. Subdomain `dash`, domain `unserver23.net`, service type **HTTP**, URL
   `<server-ip>:3274` (that is, `http://<server-ip>:3274`). Cloudflare creates the DNS
   record.
3. Check it with `curl -sI https://dash.unserver23.net/` (expect `200`), then open the URL
   in a browser.

- TLS ends at Cloudflare, and the container speaks plain HTTP. No certificates are needed
  on Unraid.
- Caching is driven by nginx's `Cache-Control` headers, which Cloudflare respects by
  default. `index.html`, `sw.js`, `registerSW.js` and `manifest.webmanifest` are
  `no-cache`; `/assets/*` and `workbox-<hash>.js` are `immutable`; icons get one day. Do
  not add a "cache everything" rule for this hostname, because it would freeze the app on
  an old version.
- **Mapbox token:** if you restrict the token by URL in your Mapbox account, include
  `https://dash.unserver23.net`. Local development (`localhost`, `https://<mac-ip>:5173`)
  then needs those URLs allowed too, or a separate unrestricted token in `.env.local`.
  nginx sends `Referrer-Policy: strict-origin-when-cross-origin` so Mapbox requests still
  carry the origin.

### Behind Cloudflare Access (optional)

Access policies are set up under **Zero Trust → Access → Applications**. What changes on
the phone:

- **Installation keeps working** because the manifest link is emitted as
  `<link rel="manifest" … crossorigin="use-credentials">` (`useCredentials: true` in
  `vite.config.ts`). Browsers fetch the manifest without cookies by default, which Access
  would block and break **Add to Home Screen**. The setting is harmless with Access off.
- **Sign in once in Safari** before adding to the Home Screen. The Home Screen app keeps
  its own cookies, separate from Safari, so if it opens on the Access login, sign in there
  once as well.
- **When the Access session expires**, the app still opens. The service worker serves the
  app from its cache, and the map tiles and GPS do not pass through Access. But the app
  stops receiving updates, because the `sw.js` update check is redirected to the login.
  The login does not reappear by itself. To sign in again, remove the app from the Home
  Screen and add it again. A long session duration on the Access application avoids this.

## 5. Installing on the iPhone

1. In **Safari**, open `https://dash.unserver23.net` and let it load fully. This first
   visit also caches the app.
2. Tap **Share → Add to Home Screen → Add**. The icon is named "Dash".
3. Launch Dash **from the Home Screen icon**. It runs full screen with no Safari bars.
   Hold the phone in landscape.
4. Tap **Start driving**. Allow **Location** (While Using the App, with Precise on) and
   **Motion & Orientation** (the compass). The screen then stays awake while Dash is in
   front.

If you denied location by mistake: **Settings → Privacy & Security → Location Services →
Safari Websites**. If a prompt does not come back, remove the app and add it again.

## 6. On-device checklist

- [ ] **Speed:** compare with the car's speedometer at a steady 30 and 60 mph. Dash should
      read the same or slightly lower, because car speedometers over-read by design. Units
      can be changed in Settings.
- [ ] **Screen stays awake:** set Auto-Lock to 30 seconds and drive or sit for 5 minutes or
      more. The screen must not dim.
- [ ] **Both landscape directions:** rotate both ways. Nothing important sits under the
      Dynamic Island or the home indicator. Portrait shows the rotate prompt.
- [ ] **Background and foreground:** switch to another app (or lock the phone) for a
      minute, then come back. The GPS indicator recovers and the speed updates again.
- [ ] **Day and night:** **Settings → Appearance**. Auto follows the sun at your position
      (the map also goes through dawn and dusk); Day and Night force the look.
- [ ] **Update after a redeploy:** make a visible change and run `./deploy.sh`. Open the
      app, wait 10–20 s, close it from the app switcher and open it again. The change is
      there.
- [ ] **Demo:** `https://dash.unserver23.net/?demo=1` in Safari, or Settings → Demo drive,
      runs the simulated drive.

## 7. Known limits

- **Orientation can't be locked.** iOS ignores `orientation: landscape` for web apps, so
  Dash shows a rotate prompt in portrait. Keep the iPhone's Portrait Orientation Lock
  **off**, or the phone stays in portrait.
- **GPS stops when Dash is not in front.** Web apps get no background location: switching
  apps or locking the phone pauses it, and Dash resumes when you return. The wake lock
  only works while Dash is visible, and Low Power Mode can refuse it.
- **The first launch needs a network connection.** After that the app itself is cached, but
  map tiles, styles and other Mapbox requests are always live (no tile caching by design).
  Without signal the map cannot load new areas, while speed, compass and clock keep
  working.

## 8. Updating and rolling back

**Update**

```sh
# Mac: commit and push (Option A), or rsync the folder again (Option B)
ssh root@<server-ip>
cd /mnt/user/appdata/dash && ./deploy.sh
```

Installed phones pick up the new version on their next launch (see the checklist item
above). Editing `.env` (token or port) also needs `./deploy.sh`.

**Roll back**

```sh
docker image ls dash                         # dated builds, newest first by name
./deploy.sh --rollback 20261125-131200-abc1234
```

Every successful deploy prints the exact rollback command for the build it replaced. A
rollback skips the pull and the build, retags `dash:latest`, and phones pick it up like an
update. The next plain `./deploy.sh` moves forward again. To undo a bad commit for good,
revert it in git.

**Housekeeping:** Docker data lives in Unraid's fixed-size Docker image file. If it fills
up, `docker builder prune -f` clears the BuildKit build cache, and `docker image prune -f`
removes dangling images.
