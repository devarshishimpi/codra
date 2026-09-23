FROM node:20-alpine3.24 AS builder
WORKDIR /app

# Install build dependencies if needed
RUN apk add --no-cache python3 make g++

# Copy workspace and lock file
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/node/package.json ./apps/node/
COPY packages/api/package.json ./packages/api/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/models/package.json ./packages/models/
COPY packages/provider-github/package.json ./packages/provider-github/
COPY packages/schema/package.json ./packages/schema/

# Install all dependencies (with devDependencies for build)
RUN npm ci

# Copy source code
COPY apps/node ./apps/node
COPY packages ./packages

# Build the node server and its dependencies
RUN npm run build --workspace=@codraoss/node-server

# Prune development dependencies before copying to runner stage
RUN npm prune --omit=dev

# Build runner stage
FROM node:20-alpine3.24 AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts and necessary files
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/apps/node/package.json ./apps/node/package.json
COPY --from=builder /app/apps/node/dist ./apps/node/dist

# Selectively copy only workspace packages' dist folders and package.json files
COPY --from=builder /app/packages/api/package.json ./packages/api/
COPY --from=builder /app/packages/api/dist ./packages/api/dist

COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/dist ./packages/core/dist

COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/db/dist ./packages/db/dist

COPY --from=builder /app/packages/models/package.json ./packages/models/
COPY --from=builder /app/packages/models/dist ./packages/models/dist

COPY --from=builder /app/packages/provider-github/package.json ./packages/provider-github/
COPY --from=builder /app/packages/provider-github/dist ./packages/provider-github/dist

COPY --from=builder /app/packages/schema/package.json ./packages/schema/
COPY --from=builder /app/packages/schema/dist ./packages/schema/dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "apps/node/dist/index.js"]
