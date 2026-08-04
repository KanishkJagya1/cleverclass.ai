#!/usr/bin/env bash
#
# Deploy CleverClass.AI.
#
#   bash /opt/cleverclass/deploy/deploy.sh [--no-pull]
#
# THIS SCRIPT NEVER TOUCHES THE LMS STACK.
#   * It operates only inside the `cleverclass` compose project, which scopes
#     every command to these containers.
#   * There is deliberately NO `docker system prune -a` anywhere in here. That
#     one command would delete the LMS images too, and a disk-space problem is
#     far cheaper to fix than a deleted production image.
#   * It verifies the LMS is healthy BEFORE and AFTER, and shouts if that
#     changes.
set -euo pipefail

ROOT=/opt/cleverclass
DEPLOY="$ROOT/deploy"
REPO="$ROOT/cleverclass.ai"
COMPOSE="docker compose -f $DEPLOY/docker-compose.yml --env-file $DEPLOY/.env"

cd "$DEPLOY"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '\033[31mFAILED: %s\033[0m\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- preflight --
say "Preflight"

# Docker's disk, not /. On this host Docker Root Dir is /opt/lms/docker and
# /var/lib/containerd is symlinked onto the same 49 GB volume — the boot disk
# has ~3 GB and is NOT where images land. Checking / would fail for no reason.
DOCKER_DIR=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
AVAIL_GB=$(df -BG --output=avail "$DOCKER_DIR" | tail -1 | tr -dc '0-9')
echo "  docker root: $DOCKER_DIR (${AVAIL_GB}G free)"
[ "$AVAIL_GB" -ge 8 ] || fail "Only ${AVAIL_GB}G free on $DOCKER_DIR; torch needs ~2.5G plus room to build."

FREE_MB=$(free -m | awk '/^Mem:/{print $7}')
echo "  memory available: ${FREE_MB}M"
[ "$FREE_MB" -ge 1800 ] || fail "Only ${FREE_MB}M RAM available; the api container is capped at 1600M."

# Baseline: is the LMS healthy right now? If it is already broken, that is not
# something this deploy caused, and we should know that before we start.
LMS_BEFORE=$(curl -so /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:80/health || echo 000)
echo "  LMS /health before: $LMS_BEFORE"

[ -f "$DEPLOY/.env" ] || fail "$DEPLOY/.env is missing — run bootstrap-env.sh"
[ -f "$DEPLOY/nginx/.htpasswd" ] || fail "nginx/.htpasswd is missing — run bootstrap-env.sh"

# ------------------------------------------------------------------- source --
if [ "${1:-}" != "--no-pull" ]; then
  say "Pulling source"
  git -C "$REPO" pull --ff-only
fi

# -------------------------------------------------------------------- build --
#
# STAGED ON PURPOSE: api first, started, and only then web.
#
# The Next build prerenders pages and runs generateStaticParams, so it needs a
# live catalogue API. A `docker build` container is NOT on the compose network
# and cannot resolve "cc-api" — building both in parallel fails with
# "Failed to collect page data". So the api is brought up first and published on
# 127.0.0.1:18000, and the web build reaches it through the docker0 gateway.
#
# Loopback-bound, so 18000 is not reachable from outside this host.
say "Building the API"
$COMPOSE build api
$COMPOSE up -d api

say "Waiting for the API before building the web image"
for i in $(seq 1 60); do
  API_CODE=$(curl -so /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:18000/health || echo 000)
  [ "$API_CODE" = "200" ] && break
  sleep 5
done
[ "$API_CODE" = "200" ] || { $COMPOSE logs --tail 60 api; fail "api never became healthy"; }
echo "  api is up (first boot loads the embedding model, so this is the slow part)"

# The web build runs with `network: host` (see docker-compose.yml), so the
# loopback publish above is what it talks to. Prove it is actually reachable
# before starting a five-minute build that would otherwise fail at the end.
say "Building the web image"
curl -fsS --max-time 5 http://127.0.0.1:18000/health >/dev/null \
  || fail "the API is not reachable on 127.0.0.1:18000 — the web build needs it to prerender"
echo "  build-time API: http://127.0.0.1:18000 (host network)"

$COMPOSE build web

say "Starting everything"
$COMPOSE up -d --remove-orphans

# nginx caches upstream container IPs at startup. The config uses a runtime
# resolver to avoid that, and this restart is the belt to that pair of braces —
# it is exactly the failure documented in the LMS deploy script.
$COMPOSE restart proxy

# ------------------------------------------------------------------- verify --
say "Waiting for health"
for i in $(seq 1 60); do
  CODE=$(curl -so /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8050/api/ai/health || echo 000)
  [ "$CODE" = "200" ] && break
  sleep 5
done
[ "$CODE" = "200" ] || { $COMPOSE logs --tail 60 api; fail "api never became healthy"; }

STORE=$(curl -so /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8050/ || echo 000)
ADMIN_NOAUTH=$(curl -so /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:8051/admin || echo 000)

echo "  storefront  :8050/          -> $STORE   (want 200)"
echo "  admin       :8051/admin     -> $ADMIN_NOAUTH   (want 401)"
[ "$STORE" = "200" ] || fail "storefront did not come up"
[ "$ADMIN_NOAUTH" = "401" ] || fail "admin port is NOT behind Basic auth — refusing to leave it exposed"

# ----------------------------------------------------------- LMS regression --
say "LMS regression check"
LMS_AFTER=$(curl -so /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:80/health || echo 000)
LMS_ADMIN=$(curl -so /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:8080/ || echo 000)
echo "  LMS :80/health -> $LMS_AFTER (was $LMS_BEFORE)"
echo "  LMS :8080/     -> $LMS_ADMIN (401 expected — Basic auth)"
if [ "$LMS_BEFORE" = "200" ] && [ "$LMS_AFTER" != "200" ]; then
  fail "THE LMS WENT DOWN. Roll back: $COMPOSE down"
fi

say "Resource usage"
docker stats --no-stream --format '  {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'
df -h "$DOCKER_DIR" | tail -1 | awk '{print "  disk: "$4" free of "$2}'

say "Deployed"
echo "  storefront : http://34.131.254.234:8050"
echo "  admin      : http://34.131.254.234:8051/admin"
echo "  logs       : http://34.131.254.234:8080/logs/  (cc-api, cc-web, cc-proxy)"
