# syntax=docker/dockerfile:1

# Production image for the Node deployment target (@codraoss/node-server).
# Build context is the repository root: docker build -f apps/node/Dockerfile .

# ── Stage 1: workspace install ────────────────────────────────────────────────
# Manifests are copied before the sources so npm ci stays cached until a
# dependency actually changes.
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/models/package.json packages/models/
COPY packages/provider-github/package.json packages/provider-github/
COPY packages/schema/package.json packages/schema/
COPY packages/ui/package.json packages/ui/
COPY apps/node/package.json apps/node/
COPY apps/worker/package.json apps/worker/

RUN npm ci

# ── Stage 2: build ────────────────────────────────────────────────────────────
# Two artifacts: the dashboard bundle at dist/client (served by the Node app)
# and the server bundle at apps/node/dist.
#
# `npx vite build` rather than `npm run build`: the root build script chains
# cf-typegen, which shells out to wrangler and has no place in this image.
FROM deps AS builder
WORKDIR /app

COPY . .

RUN npx vite build
RUN npm run build --workspace=@codraoss/node-server

# ── Stage 3: runtime dependencies ─────────────────────────────────────────────
# tsup bundles every @codraoss/* package into the server bundle, so only the
# node-server workspace's own runtime deps are installed here.
FROM node:22-alpine AS prod-deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/api/package.json packages/api/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/models/package.json packages/models/
COPY packages/provider-github/package.json packages/provider-github/
COPY packages/schema/package.json packages/schema/
COPY packages/ui/package.json packages/ui/
COPY apps/node/package.json apps/node/
COPY apps/worker/package.json apps/worker/

RUN npm ci --omit=dev --workspace=@codraoss/node-server

# ── Stage 4: runner ───────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# tsup emits ESM. Node 22 only runs it unflagged because of module syntax
# auto-detection; this marks the bundle explicitly so an older base image or a
# stricter loader cannot turn startup into "Cannot use import statement outside
# a module".
RUN printf '{"type":"module"}\n' > package.json

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/node/dist ./dist
COPY --from=builder /app/dist/client ./dist/client

# The migrate service in docker-compose.yml runs from this same image; the
# migration runner is a plain script and is not part of the server bundle.
COPY --from=builder /app/packages/db/package.json ./packages/db/package.json
COPY --from=builder /app/packages/db/scripts ./packages/db/scripts
COPY --from=builder /app/packages/db/migrations ./packages/db/migrations

USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
