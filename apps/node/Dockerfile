FROM node:20-alpine AS builder
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

# Build runner stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy built artifacts and necessary files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/node/dist ./apps/node/dist
COPY --from=builder /app/apps/node/package.json ./apps/node/package.json

# Copy packages that the node app might need at runtime
COPY --from=builder /app/packages ./packages

EXPOSE 3000

CMD ["node", "apps/node/dist/index.js"]
