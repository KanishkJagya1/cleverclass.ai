# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# --------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The build reads the API for generateStaticParams. That call is capped to ~40
# slugs and returns [] on failure (see lib/data/api-adapter.ts), so a backend
# blip degrades to on-demand ISR instead of failing the deploy.
ARG CATALOG_API_URL=http://cc-api:8000
ENV CATALOG_API_URL=$CATALOG_API_URL \
    CATALOG_SOURCE=api \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# --------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000

RUN addgroup -g 10001 -S app && adduser -u 10001 -S app -G app

# `output: standalone` would be leaner, but this app uses route handlers and
# middleware that read env at RUNTIME; standalone traces them at build time and
# the difference is not worth debugging on a box shared with another stack.
COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./package.json
COPY --from=builder --chown=app:app /app/next.config.ts ./next.config.ts

USER app
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
