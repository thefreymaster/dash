# Dash

Dash is a calm, landscape instrument cluster for the car: a large speedometer, a compass
tape, a clock and GPS status laid over a live, heading-up Mapbox map, with day and night
themes. It is a static progressive web app (no backend) that you install on an iPhone's
Home Screen and run from a phone mount.

**Stack:** React 19 + TypeScript 7, Vite 8, Chakra UI 3, Motion, TanStack Query,
Mapbox GL JS 3, SunCalc, and vite-plugin-pwa (Workbox `generateSW`, auto-update). Tests
run with Vitest and linting with oxlint. In production, GitHub Actions builds a Docker
image in which nginx serves the build, and publishes it to GitHub Container Registry. The
Unraid server pulls and runs that image, and Cloudflare Tunnel publishes it at
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

GitHub builds the image and the server only pulls it. A push to `main` runs a GitHub
Actions workflow: lint, tests and a build, then a Docker build. The workflow publishes
the image to GitHub Container Registry (GHCR), and the Unraid server pulls it and runs
it as the container `dash`. The Mac needs no Docker. Building on the server still
works; see [3.5](#35-alternative-build-on-the-server).

Below, `ghcr.io/<owner>/dash` means your GitHub user or organization and the repository
name, **in lower case**, because Docker requires that. For example, user `Octocat` →
`ghcr.io/octocat/dash`. If the repository has another name, use that name instead of
`dash`.

| File | Role |
| --- | --- |
| `.github/workflows/publish.yml` | On a push to `main` or a manual run: lint, test, build, then build the image and push `ghcr.io/<owner>/dash:latest` and `:<short commit sha>` |
| `Dockerfile` | `node:24-alpine` runs `npm ci && npm run build`; `nginx:alpine` serves `dist/` on port 80 and has a `HEALTHCHECK` |
| `nginx.conf` | Server block (installed as `conf.d/default.conf`): SPA fallback, PWA-safe caching, gzip, `/healthz` |
| `deploy.sh` | On the server: pull the published image (or build), replace the `dash` container, wait for health, keep dated images for rollback |
| `docker-compose.yml` | The same service, for hosts with the Compose plugin. It builds locally; a comment in it shows how to run the published image instead |
| `.dockerignore` | Keeps `node_modules`, `dist`, `.git`, `.env*` and mockups out of the build |

### 3.1 One-time GitHub setup

1. **Create the repository** on GitHub. It can be private. Leave out the README and the
   license, so the first push goes through.
2. **Add the Mapbox token as a secret**, before the first push. In the repository, go to
   **Settings → Secrets and variables → Actions → Secrets → New repository secret**. Use
   the name `VITE_MAPBOX_TOKEN` and paste the public `pk.…` token as the value, then
   **Add secret**. The workflow refuses to publish if the secret is missing or is not a
   `pk.` token.
3. **Push** from the Mac. `.gitignore` keeps `.env`, `.env.local` and every other `.env*`
   file except `.env.example` out of the repository.

   ```sh
   git remote add origin https://github.com/<owner>/dash.git
   git push -u origin main          # after the first commit
   ```

4. **Watch it run** in the repository's **Actions** tab, under **Publish image**. The job
   *Lint, test, build* runs first, then *Build and push image*, which takes a few minutes.
   When the run is green, its summary shows the pushed tags and the digest. To start a run
   by hand: **Actions → Publish image → Run workflow**.
5. **Find the image.** The repository's main page lists it under **Packages** in the
   right-hand sidebar. Each image is tagged `latest` and with its 7-character commit SHA,
   e.g. `ghcr.io/<owner>/dash:3f9c2ab`.

If *Build and push image* fails with `denied` or `permission_denied`, a package with
that name already exists and this repository may not write to it. Fix it on the package
page: **Package settings → Manage Actions access → Add repository**, choose this
repository, and give it the role **Write**.

### 3.2 Image visibility

A newly published package is **private**, even if the repository is public. Before the
server can pull it, choose one of two options.

**Make the package public (simplest).** Anyone can then pull it without logging in, so
`docker pull`, `deploy.sh` and Unraid's Docker tab, including its update check, need no
credentials. Only the image becomes public. It contains nginx, its config and the built
static site, which are the same files `https://dash.unserver23.net` sends every
visitor. It also contains the public Mapbox token, which is in that JavaScript anyway.
Its labels name the repository and the commit. The source code stays private. To change
it, open the package page: **Package settings → Danger Zone → Change visibility →
Public**, then type the package name to confirm. **This is one-way.** GitHub cannot make
a public package private again. If you use Cloudflare Access (section 4) to keep the
app private, a public image undoes that, so keep the package private instead.

**Keep it private, and log the server in once.** GHCR accepts only a **personal access
token (classic)**, not a fine-grained one. Create one with only the **`read:packages`**
scope: on GitHub, **Settings → Developer settings → Personal access tokens → Tokens
(classic) → Generate new token (classic)**. Choose an expiration date. Then, on the
server:

```sh
docker login ghcr.io -u <github-username>    # paste the token at the Password prompt
```

Docker stores the login unencrypted in `/root/.docker/config.json`. The trade-offs:

- The server holds one more secret.
- A `read:packages` token can read every package your account can read, not only this one.
- When the token expires, or the login is lost, pulls fail with `unauthorized`.
  `deploy.sh` reports this, and running the login again fixes it.
- If the Docker tab shows the version of `dash` as *not available*, Unraid's update check
  cannot see the private package. Update with `deploy.sh` or the commands instead.

### 3.3 First deploy on the server

Open an SSH session to the server (`ssh root@<server-ip>`). Before the first deploy,
confirm that port **3274** is free. These two commands should print nothing:
`docker ps --format '{{.Names}} {{.Ports}}' | grep 3274` and `ss -ltn 'sport = :3274'`.

Then use **one** of the three ways below. All three manage the container named `dash`,
so do not mix them. To switch, remove the container first, with `docker rm -f dash` or
**Remove** in the Docker tab.

**A. `deploy.sh` (recommended).** It checks health, prints logs on failure, and keeps
dated images, so a rollback is a single command. It needs only itself: no checkout and
no `.env`.

```sh
# On the Mac, from the repo root:
ssh root@<server-ip> mkdir -p /mnt/user/appdata/dash
scp deploy.sh root@<server-ip>:/mnt/user/appdata/dash/
# On the server:
cd /mnt/user/appdata/dash && chmod +x deploy.sh
./deploy.sh --image ghcr.io/<owner>/dash
```

What it does:

1. Pulls `ghcr.io/<owner>/dash:latest`. A tag works too, e.g. `--image …/dash:3f9c2ab`.
   If the pull fails, the running container is left alone.
2. Tags the image `dash:<YYYYmmdd-HHMMSS>-<commit sha>` for rollback.
3. Replaces the `dash` container (`--restart unless-stopped`, `-p 3274:80`).
4. Waits for `/healthz` and checks that `/` serves the app. On failure it prints the
   container logs and the rollback command.
5. Keeps the 5 newest dated images.

If the container already runs that image, `deploy.sh` changes nothing. So running it
on a schedule (e.g. with the User Scripts plugin) costs only a `docker pull`.

To avoid typing the image each time, save it in a `.env` file next to the script:

```sh
echo 'DASH_IMAGE=ghcr.io/<owner>/dash' > .env    # from then on: ./deploy.sh
```

`DASH_PORT` (default 3274) and `DASH_KEEP_IMAGES` (default 5) can go in the same file.
`./deploy.sh --help` lists every option.

**B. Plain `docker` commands.** These give no health wait and no dated images for
rollback.

```sh
docker pull ghcr.io/<owner>/dash:latest
docker run -d --name dash --restart unless-stopped -p 3274:80 ghcr.io/<owner>/dash:latest
```

**C. Unraid's Docker tab.** Go to **Docker → Add Container** and fill in:

- **Name:** `dash`
- **Repository:** `ghcr.io/<owner>/dash:latest`
- **Network Type:** `Bridge`
- Click **Add another Path, Port, Variable, Label or Device** and set **Config Type**
  `Port`, **Name** `HTTP`, **Container Port** `80`, **Host Port** `3274`,
  **Connection Type** `TCP`. Then click **Add**.
- Optional, in **Advanced View**: **WebUI** `http://[IP]:[PORT:80]/`

Click **Apply**. Unraid pulls the image and starts the container. Then turn on
**Auto-Start** for `dash` on the Docker tab; it is Unraid's version of the restart
policy. This container comes from an Unraid template, so Unraid manages its updates.
After a new image is published, **Check for Updates** marks `dash` as *update ready*,
and **apply update** pulls the image and recreates the container (section 8).
`deploy.sh` refuses to replace a container that was created this way.

### 3.4 Verify

```sh
curl http://<server-ip>:3274/healthz              # → ok
curl -sI http://<server-ip>:3274/ | grep -i cache # → Cache-Control: no-cache
docker ps --filter name=dash                       # STATUS shows "(healthy)" after ~10 s
```

With way A or B, `dash` appears in Unraid's **Docker** tab without a template (newer
Unraid versions call this third-party). Update it with `deploy.sh` or the commands, not
with the tab's update action. After the next reboot, check that it came back up. If it
did not, turn on **Auto-Start** for `dash` in the Docker tab.

### 3.5 Alternative: build on the server

Use this only to deploy without GitHub Actions. The server then builds the image from a
copy of the code, and the Mapbox token lives in a `.env` file there. The checkout lives
at `/mnt/user/appdata/dash`.

**Get the code onto the server. Option A: git.** Clone the GitHub repository (3.1). A
private repository needs credentials on the server, such as an SSH deploy key. First
check that `git --version` works on the server.

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

`--delete` removes files you deleted locally; stale sources would break the type-check.
Excluded paths are never deleted, so the server's `.env` survives. Without a `.git`
folder, `deploy.sh` skips the pull on its own.

**Create `.env` on the server:**

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
- Do not set `DASH_IMAGE` in this `.env`. With it set, `deploy.sh` pulls instead of
  building.
- Never commit `.env`. `.gitignore` excludes it, and `deploy.sh` warns if it is tracked.
- The port check from 3.3 applies here too. `deploy.sh` refuses a port that is already
  in use.

**Deploy:**

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

Verify as in 3.4.

**Compose instead of `deploy.sh`:** only if the Compose plugin is installed
(`docker compose version`). Run `docker compose up -d --build`. It reads the same `.env`
and uses the same container name, so use one method or the other (`docker rm -f dash`
before switching). Compose keeps no dated images for rollback. A comment at the top of
`docker-compose.yml` shows how to make Compose run the published image instead of
building it.

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
- [ ] **Update after a redeploy:** make a visible change, push it, and redeploy once the
      workflow is green (section 8). Open the app, wait 10–20 s, close it from the app
      switcher and open it again. The change is there.
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

1. Commit and push to `main` from the Mac.
2. Wait until the **Publish image** run in the repository's **Actions** tab is green. Its
   summary lists the new tags.
3. On the server, update the same way you deployed (3.3):

   ```sh
   # A: deploy.sh
   ssh root@<server-ip>
   cd /mnt/user/appdata/dash && ./deploy.sh --image ghcr.io/<owner>/dash   # or ./deploy.sh with DASH_IMAGE in .env

   # B: plain docker
   docker pull ghcr.io/<owner>/dash:latest
   docker rm -f dash
   docker run -d --name dash --restart unless-stopped -p 3274:80 ghcr.io/<owner>/dash:latest
   ```

   C (Docker tab): click **Check for Updates**. `dash` then shows *update ready*; click
   **apply update**. Plugins from Community Applications can also apply updates on a
   schedule.

Installed phones pick up the new version on their next launch (see the checklist item
above). After a change to `DASH_PORT`, run `./deploy.sh` again; it recreates the
container even when the image is the same. In pull mode `deploy.sh` does not update
itself, so after you change it, copy it to the server again with `scp` (3.3). With the
build-on-server setup (3.5), push or rsync the code, then run `./deploy.sh` in the
checkout.

**Roll back**

```sh
docker image ls dash                                 # dated deploys, newest first by name
./deploy.sh --rollback 20261125-131200-3f9c2ab       # an earlier deploy: no pull, no build
./deploy.sh --image ghcr.io/<owner>/dash:3f9c2ab     # any commit the workflow ever published
```

- Every successful deploy prints the exact `--rollback` command for the build it
  replaced. The suffix of a dated tag is the commit's short SHA. This works for pulled
  images and local builds alike.
- With plain `docker` (B), roll back with the `docker pull` and `docker run` commands
  above, using the SHA tag instead of `latest`.
- In the Docker tab (C), **Edit** `dash`, set **Repository** to
  `ghcr.io/<owner>/dash:3f9c2ab`, then **Apply**. Unraid then stays on that build. Set
  the repository back to `:latest` to follow `main` again.

Phones pick up a rollback like an update. Deploying `:latest` again, or a plain
`./deploy.sh` in the build setup, moves forward to whatever `main` last produced. To get
rid of a bad commit for good, revert it in git and push.

**Housekeeping:** Docker data lives in Unraid's fixed-size Docker image file.
`deploy.sh` keeps only the newest dated images. Images pulled by SHA tag stay until you
remove them: list them with `docker image ls ghcr.io/<owner>/dash`, then remove them
with `docker rmi`. `docker image prune -f` removes dangling images, and
`docker builder prune -f` clears the build cache that the build-on-server setup leaves
behind.
