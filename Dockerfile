# check=skip=SecretsUsedInArgOrEnv
# (VITE_MAPBOX_TOKEN is a public pk. token that ends up in the shipped JavaScript anyway.)
#
# Dash: static React PWA, built with Vite and served by nginx.
# Built on the Unraid host by ./deploy.sh (or `docker compose up -d --build`); see README.md.
#
#   docker build --build-arg VITE_MAPBOX_TOKEN=pk.… -t dash:latest .

# ---- Build stage ------------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# Dependencies first, so this layer stays cached until package.json or the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Vite reads VITE_* from the environment and bakes the value into the bundle. Leaving it
# empty is allowed: the app then shows its "map unavailable" state.
ARG VITE_MAPBOX_TOKEN=""
ENV VITE_MAPBOX_TOKEN=${VITE_MAPBOX_TOKEN}
RUN if [ -z "$VITE_MAPBOX_TOKEN" ]; then \
      echo "########################################################################"; \
      echo "# WARNING: VITE_MAPBOX_TOKEN is empty. Building without a Mapbox token;"; \
      echo "#          the map will show 'map unavailable'. Put the pk. token in .env."; \
      echo "########################################################################"; \
    fi \
 && npm run build

# ---- Runtime stage ----------------------------------------------------------------------
FROM nginx:alpine

LABEL org.opencontainers.image.title="Dash" \
      org.opencontainers.image.description="A calm instrument cluster for the road (static PWA)" \
      net.unraid.docker.webui="http://[IP]:[PORT:80]/"

# nginx.conf is a server block; it replaces the stock default site.
RUN rm -rf /usr/share/nginx/html/*
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/

EXPOSE 80

# busybox wget ships with the image. 127.0.0.1, not localhost: nginx listens on IPv4 only.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
