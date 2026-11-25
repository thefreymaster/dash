#!/usr/bin/env bash
# Build Dash and (re)start its container. Run this on the Unraid host, from the repo checkout.
#
#   ./deploy.sh                  git pull (when possible), build, replace the `dash` container
#   ./deploy.sh --no-pull        the same without `git pull` (for files copied over by hand)
#   ./deploy.sh --rollback TAG   run an earlier build again, with no pull and no build
#                                (TAG from `docker image ls dash`)
#   ./deploy.sh --help
#
# Settings come from the environment or from the same names in ./.env (the environment wins):
#   VITE_MAPBOX_TOKEN   public Mapbox token (pk.…), baked into the bundle at build time
#   DASH_PORT           host port to publish (default 3274)
#   DASH_NO_PULL=1      same as --no-pull
#   DASH_KEEP_IMAGES    dated images kept for rollback (default 5)
set -euo pipefail

NAME=dash                        # container name
IMAGE=dash                       # image repository
STAMP_RE='^[0-9]{8}-[0-9]{6}'    # dated tags made by this script: YYYYmmdd-HHMMSS[-gitsha]
PUBLIC_URL=https://dash.unserver23.net

SCRIPT=$(basename -- "${BASH_SOURCE[0]}")
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
ARGS=("$@")

# ---- Helpers ---------------------------------------------------------------------------

if [[ -t 1 ]]; then
  BOLD=$'\033[1m' YELLOW=$'\033[1;33m' RED=$'\033[1;31m' RESET=$'\033[0m'
else
  BOLD='' YELLOW='' RED='' RESET=''
fi
log()  { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$*"; }
warn() { printf '%sWARNING:%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '%sERROR:%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "./$SCRIPT"; }

# env_file_value KEY: the value of KEY in ./.env (the last line wins), with quotes,
# surrounding whitespace, a trailing comment and a Windows CR stripped. .env is read as
# data and never sourced.
env_file_value() {
  [[ -f .env ]] || return 0
  local v
  v=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" .env | tail -n 1 | cut -d= -f2-) || true
  v=${v%$'\r'}
  v=$(printf '%s' "$v" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+#.*$//; s/[[:space:]]+$//')
  case $v in
    \"*\") v=${v#\"}; v=${v%\"} ;;
    \'*\') v=${v#\'}; v=${v%\'} ;;
  esac
  printf '%s' "$v"
}

# http_get URL: print the response body, failing on HTTP errors (curl, else busybox wget).
http_get() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "$1"
  else
    wget -q -T 3 -O - "$1"
  fi
}

# The host's LAN address, for the summary line.
lan_ip() {
  local ip=''
  if command -v ip >/dev/null 2>&1; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null \
      | awk '{ for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit } }') || true
  fi
  [[ -n $ip ]] || ip=$(hostname -I 2>/dev/null | awk '{ print $1 }') || true
  printf '%s' "${ip:-<server-ip>}"
}

# The dated tag of the image the `dash` container runs now, if any. This is the rollback target.
running_tag() {
  local id
  id=$(docker container inspect --format '{{.Image}}' "$NAME" 2>/dev/null) || return 0
  docker image inspect --format '{{range .RepoTags}}{{println .}}{{end}}' "$id" 2>/dev/null \
    | sed -n "s/^$IMAGE://p" | grep -E "$STAMP_RE" | sort -r | head -n 1 || true
}

# Refuse a port that another container or process already holds. Otherwise the old container
# would be removed and the new one would fail to start.
check_port() {
  local others current
  others=$(docker ps --filter "publish=$DASH_PORT" --format '{{.Names}}' | grep -vx "$NAME" || true)
  [[ -z $others ]] || die "Port $DASH_PORT is already published by: $others. Set DASH_PORT (e.g. in .env) to a free port."
  current=$(docker port "$NAME" 80/tcp 2>/dev/null | head -n 1 | sed 's/.*://') || true
  if [[ $current != "$DASH_PORT" ]] && command -v ss >/dev/null 2>&1 \
    && [[ -n $(ss -Hltn "sport = :$DASH_PORT" 2>/dev/null) ]]; then
    die "Something on this host already listens on port $DASH_PORT. Set DASH_PORT (e.g. in .env) to a free port."
  fi
}

# Succeeds when git is installed and this directory is a git checkout it will work in.
# Sets GIT_PROBLEM=dubious when git refuses the checkout because another user owns it.
GIT_PROBLEM=''
git_usable() {
  command -v git >/dev/null 2>&1 || return 1
  local err
  err=$(git rev-parse --is-inside-work-tree 2>&1 >/dev/null) && return 0
  if [[ $err == *"dubious ownership"* ]]; then GIT_PROBLEM=dubious; fi
  return 1
}

pull() {
  if ! git_usable; then
    [[ $GIT_PROBLEM != dubious ]] \
      || die "git refuses this checkout because another user owns it. Fix with: chown -R root:root '$PWD' (or re-run with --no-pull)."
    log "Not a git checkout (or git is not installed): building the files as they are"
    return
  fi
  if ! git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
    log "This branch has no upstream: building the files as they are"
    return
  fi
  local before
  before=$(git rev-parse HEAD)
  log "Updating the checkout (git pull --ff-only)"
  git pull --ff-only || die "git pull failed (local changes or a diverged branch?). Fix the checkout, or re-run with --no-pull."
  if ! git diff --quiet "$before" HEAD -- "$SCRIPT"; then
    log "$SCRIPT itself changed: running the new version"
    exec env DASH_NO_PULL=1 "./$SCRIPT" ${ARGS[@]+"${ARGS[@]}"}
  fi
}

# Remove dated images beyond the newest $KEEP, never the one that was running before.
prune_images() {
  local tags tag n=0
  tags=$(docker image ls "$IMAGE" --format '{{.Tag}}' | grep -E "$STAMP_RE" | sort -r) || true
  for tag in $tags; do
    n=$((n + 1))
    if (( n > KEEP )) && [[ $tag != "$PREVIOUS" ]]; then
      docker rmi "$IMAGE:$tag" >/dev/null 2>&1 && log "Removed old image $IMAGE:$tag" || true
    fi
  done
}

rollback_hint() {
  if [[ -n $PREVIOUS && $PREVIOUS != "$TAG" ]]; then
    printf 'Rollback: ./deploy.sh --rollback %s\n' "$PREVIOUS"
  else
    printf 'Rollback: no earlier build was running (list builds with: docker image ls %s)\n' "$IMAGE"
  fi
}

# ---- Options and settings --------------------------------------------------------------

NO_PULL=${DASH_NO_PULL:-0}
ROLLBACK_TAG=''
while (( $# )); do
  case $1 in
    --no-pull) NO_PULL=1 ;;
    --rollback)
      [[ $# -ge 2 && -n $2 ]] || die "--rollback needs a tag (list them with: docker image ls $IMAGE)"
      ROLLBACK_TAG=${2#"$IMAGE":}
      shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (see ./deploy.sh --help)" ;;
  esac
  shift
done

command -v docker >/dev/null 2>&1 || die "docker is not installed."
docker info >/dev/null 2>&1 || die "Docker is not running (Unraid: Settings → Docker → Enable Docker)."

[[ -f .env ]] || warn "No .env in $PWD (see README.md, 'Deploying to Unraid')."
DASH_PORT=${DASH_PORT:-$(env_file_value DASH_PORT)}
DASH_PORT=${DASH_PORT:-3274}
[[ $DASH_PORT =~ ^[0-9]+$ ]] || die "DASH_PORT must be a port number, got '$DASH_PORT'."
KEEP=${DASH_KEEP_IMAGES:-5}
[[ $KEEP =~ ^[0-9]+$ ]] || die "DASH_KEEP_IMAGES must be a number, got '$KEEP'."
check_port   # fail before a long build, not after it

# ---- Build (or pick the rollback image) ------------------------------------------------

if [[ -n $ROLLBACK_TAG ]]; then
  TAG=$ROLLBACK_TAG
  docker image inspect "$IMAGE:$TAG" >/dev/null 2>&1 \
    || die "No image $IMAGE:$TAG. Available builds: $(docker image ls "$IMAGE" --format '{{.Tag}}' | grep -E "$STAMP_RE" | sort -r | tr '\n' ' ')"
  log "Rolling back to $IMAGE:$TAG (no pull, no build)"
  docker tag "$IMAGE:$TAG" "$IMAGE:latest"
else
  if [[ $NO_PULL == 1 ]]; then
    log "Skipping git pull (--no-pull / DASH_NO_PULL=1)"
  else
    pull
  fi

  if git_usable && git ls-files --error-unmatch .env >/dev/null 2>&1; then
    warn ".env is tracked by git. Remove it from the repo (git rm --cached .env) and add it to .gitignore."
  fi

  VITE_MAPBOX_TOKEN=${VITE_MAPBOX_TOKEN:-$(env_file_value VITE_MAPBOX_TOKEN)}
  case $VITE_MAPBOX_TOKEN in
    '')   warn "VITE_MAPBOX_TOKEN is empty (set it in $PWD/.env). Building anyway: the map will show 'map unavailable'." ;;
    pk.*) ;;
    sk.*) die "VITE_MAPBOX_TOKEN is a secret (sk.) token. It would be published inside the JavaScript; use a public pk. token." ;;
    *)    warn "VITE_MAPBOX_TOKEN does not start with 'pk.'. Check that it is a Mapbox public token." ;;
  esac

  TAG=$(date +%Y%m%d-%H%M%S)
  if git_usable && sha=$(git rev-parse --short HEAD 2>/dev/null); then TAG="$TAG-$sha"; fi

  log "Building $IMAGE:$TAG"
  export BUILDKIT_PROGRESS=${BUILDKIT_PROGRESS:-plain}   # full build log, so warnings stay visible
  docker build --pull \
    --build-arg "VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN" \
    --tag "$IMAGE:$TAG" --tag "$IMAGE:latest" \
    . || die "Build failed. The running container (if any) was not touched."
fi

# ---- Replace the container -------------------------------------------------------------

PREVIOUS=$(running_tag)

if docker container inspect "$NAME" >/dev/null 2>&1; then
  log "Removing the old $NAME container"
  docker rm -f "$NAME" >/dev/null
fi

log "Starting $NAME from $IMAGE:$TAG on port $DASH_PORT"
if ! docker run -d --name "$NAME" --restart unless-stopped -p "$DASH_PORT:80" "$IMAGE:$TAG" >/dev/null; then
  warn "docker run failed, so Dash is not running."
  rollback_hint
  exit 1
fi

# ---- Wait for it to answer -------------------------------------------------------------

log "Waiting for http://127.0.0.1:$DASH_PORT/healthz"
healthy=0
for ((i = 0; i < 30; i++)); do
  if [[ $(http_get "http://127.0.0.1:$DASH_PORT/healthz" 2>/dev/null) == ok ]]; then
    healthy=1
    break
  fi
  [[ $(docker container inspect --format '{{.State.Running}}' "$NAME" 2>/dev/null) == true ]] || break
  sleep 1
done

# A healthy nginx that serves no app (e.g. an empty dist/) is still a failed deploy.
if (( healthy )); then
  index=$(http_get "http://127.0.0.1:$DASH_PORT/" 2>/dev/null) || true
  if [[ $index != *'id="root"'* ]]; then
    warn "/healthz answers, but / does not return Dash's index.html."
    healthy=0
  fi
fi

if (( ! healthy )); then
  warn "Dash failed its checks on port $DASH_PORT. Last container logs:"
  docker logs --tail 50 "$NAME" 2>&1 || true
  rollback_hint
  exit 1
fi

[[ -n $ROLLBACK_TAG ]] || prune_images

log "Dash is up ($IMAGE:$TAG)"
printf '    LAN:     http://%s:%s/\n' "$(lan_ip)" "$DASH_PORT"
printf '    Public:  %s (through the Cloudflare Tunnel)\n' "$PUBLIC_URL"
rollback_hint
