#!/usr/bin/env bash
#
# One-time setup: directories, secrets, and the admin Basic-auth file.
#
#   bash /opt/cleverclass/deploy/bootstrap-env.sh
#
# Safe to re-run: it never overwrites an existing secret, because rotating
# ADMIN_SESSION_SECRET silently would log every admin out and rotating
# REVALIDATE_SECRET would break storefront cache invalidation until both sides
# were restarted together.
set -euo pipefail

ROOT=/opt/cleverclass
DEPLOY="$ROOT/deploy"
ENV_FILE="$DEPLOY/.env"
LMS_ENV=/opt/lms/lms-deploy/.env

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

say "Data directories"
# NOTE these live on the 49 GB volume via the /opt/cleverclass symlink. /opt
# itself is on the 10 GB boot disk with ~3 GB free — putting 370 MB of rendered
# preview pages plus the PDFs there would fill it and take the LMS down with it.
sudo mkdir -p "$ROOT"/{db,media,chroma,cache,backups}
sudo chown -R "$(id -u):$(id -g)" "$ROOT"/{db,media,chroma,cache,backups}
for d in db media chroma cache backups; do printf '  %s\n' "$ROOT/$d"; done

say "Secrets"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"

keep_or_set() {
  local key=$1 value=$2
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    echo "  $key: kept (already set)"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
    echo "  $key: generated"
  fi
}

# The Gemini key is READ from the LMS env and copied. That file is never
# written to — this deployment does not modify anything under /opt/lms.
if ! grep -q '^GEMINI_API_KEY=' "$ENV_FILE" 2>/dev/null; then
  if [ -r "$LMS_ENV" ]; then
    KEY=$(sudo grep -m1 '^GEMINI_API_KEY=' "$LMS_ENV" | cut -d= -f2- | tr -d '"' | tr -d "'")
    if [ -n "$KEY" ]; then
      echo "GEMINI_API_KEY=$KEY" >> "$ENV_FILE"
      echo "  GEMINI_API_KEY: copied from the LMS .env (that file was only read)"
    fi
  fi
fi
grep -q '^GEMINI_API_KEY=' "$ENV_FILE" || {
  echo "  GEMINI_API_KEY: NOT FOUND — add it to $ENV_FILE by hand"; }

keep_or_set ADMIN_SESSION_SECRET "$(openssl rand -hex 32)"
keep_or_set REVALIDATE_SECRET    "$(openssl rand -hex 32)"
keep_or_set BACKEND_API_KEY      "$(openssl rand -hex 24)"
keep_or_set GEMINI_MODEL         "gemini-flash-latest"
keep_or_set COOKIE_SECURE        "false"
keep_or_set SITE_URL             "http://34.131.254.234:8050"
keep_or_set ALLOWED_ORIGINS      "http://34.131.254.234:8050"

say "Admin Basic auth"
HTPASSWD="$DEPLOY/nginx/.htpasswd"
mkdir -p "$DEPLOY/nginx"
if [ -f "$HTPASSWD" ]; then
  echo "  kept the existing .htpasswd"
else
  ADMIN_PASS=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)
  # Generated inside a container so the host needs no apache2-utils.
  docker run --rm httpd:alpine htpasswd -nbB admin "$ADMIN_PASS" > "$HTPASSWD"
  echo
  printf '\033[1;33m  Basic auth for :8051  ->  admin / %s\033[0m\n' "$ADMIN_PASS"
  echo "  Save that now; it is not stored anywhere else."
fi

# Ownership is fixed every run, not just on creation — the file is bind-mounted
# into nginx:alpine, whose workers run as uid 101.
#
# This bites in a way that hides itself: nginx answers a request with NO
# credentials as 401 without ever opening this file, and only reads it once
# credentials arrive. So a file the worker cannot read looks like working auth
# right up until someone logs in — and then every attempt is a bare 500 with
# nothing written to the error log. Left at 0600 owned by the invoking user,
# that is exactly what happened on the first deploy.
chown 101:101 "$HTPASSWD" 2>/dev/null || sudo chown 101:101 "$HTPASSWD"
chmod 400 "$HTPASSWD"
echo "  .htpasswd owned by uid 101 (the nginx worker), mode 400"

say "Next"
echo "  1. bash $DEPLOY/deploy.sh"
echo "  2. docker exec -it cc-api python -m scripts.create_admin --email you@example.com"
