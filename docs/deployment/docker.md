# Deployment

Codra supports three deployment modes:

- **Cloudflare Workers** using Wrangler.
- **Direct Node.js** using a managed PostgreSQL and Redis.
- **Docker** using the published Codra image and external PostgreSQL and Redis.

All modes use the same application variables and migration script.

## Requirements

You need a configured GitHub App, an LLM provider, PostgreSQL, and Redis. Node.js 20+ is required for Cloudflare commands and direct Node.js deployment. Docker is required for Docker deployment.

Create `.env` in the repository root for local deployment. Do not commit it or copy it into a Docker image.

```env
APP_URL=https://codra.example.com
ENVIRONMENT=production
DATABASE_URL=postgres://user:password@postgres.example.com:5432/codra?sslmode=require
REDIS_URL=rediss://user:password@redis.example.com:6379
GITHUB_APP_ID=your_app_id
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_APP_WEBHOOK_SECRET=your_webhook_secret
APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
AUTH_CALLBACK_URL=https://codra.example.com/auth/github/callback
DASHBOARD_ALLOWED_USERS=your_github_username
BOT_USERNAME=your-github-app-slug[bot]
LLM_CONFIG_ENCRYPTION_KEY=your_random_encryption_key
```

`DATABASE_URL` is read from the process environment first, then `.dev.vars`, `.env.local`, or `.env`. The migration script is shared by Cloudflare and Node/Docker deployments.

## Cloudflare Workers

From the repository root:

```bash
npm ci
npm run deploy
```

`npm run deploy` builds the dashboard, runs migrations, and deploys the Worker with Wrangler. Cloudflare Worker secrets are not readable by the local migration script, so provide `DATABASE_URL` in the shell or one of the supported local env files.

## Direct Node.js

Use this when PostgreSQL and Redis are already hosted separately:

```bash
npm ci
npm run deploy:node
```

This builds the dashboard and Node server, runs migrations, and starts the API plus BullMQ worker on port `3000`.

For separate processes, use the same built application with:

```bash
START_WORKER=false npm run start -w @codraoss/node-server
START_API=false npm run start -w @codraoss/node-server
```

Keep one API process and one worker process running, sharing the same database and Redis URLs.

## Docker

The image contains only Codra. PostgreSQL, Redis, and secrets are external.

Build and run the local image:

```bash
docker compose build
docker compose run --rm codra node packages/db/scripts/migrate.mjs
docker compose up -d codra
```

View logs or check health:

```bash
docker compose logs -f codra
curl http://localhost:3000/health
```

The local image is tagged as `codra:0.9.13` and `codra:latest`.

### Docker Hub

Publish both the release tag and the rolling tag:

```bash
docker build -f apps/node/Dockerfile \
  -t YOUR_DOCKERHUB_USER/codra:0.9.13 \
  -t YOUR_DOCKERHUB_USER/codra:latest .
docker push YOUR_DOCKERHUB_USER/codra:0.9.13
docker push YOUR_DOCKERHUB_USER/codra:latest
```

To run a published image, set `CODRA_IMAGE` in the environment or `.env`:

```bash
CODRA_IMAGE=docker.io/YOUR_DOCKERHUB_USER/codra:0.9.13 docker compose pull
CODRA_IMAGE=docker.io/YOUR_DOCKERHUB_USER/codra:0.9.13 docker compose run --rm codra node packages/db/scripts/migrate.mjs
CODRA_IMAGE=docker.io/YOUR_DOCKERHUB_USER/codra:0.9.13 docker compose up -d codra
```

For each release, replace `0.9.13` with the new version and publish that tag plus `latest`.

## Domains

For any permanent host, configure:

```text
GitHub webhook:  https://your-domain.example/webhook
OAuth callback:  https://your-domain.example/auth/github/callback
```

Set `APP_URL` to the same HTTPS origin.

**Railway:** Deploy the Docker image, add the variables in the service settings, expose port `3000`, and use Railway's generated HTTPS domain. Run the migration once from a Railway shell, then configure the GitHub App URLs. Add a custom domain through Railway Networking when ready.

**GitHub Codespaces:** Start the container, forward port `3000`, and set the port visibility to **Public**. Use the generated `https://YOUR-CODESPACE-3000.app.github.dev` URL temporarily for `APP_URL`, the webhook, and the OAuth callback. Codespaces URLs are temporary and are not suitable for permanent GitHub webhooks.

For BullMQ, configure Redis with the `noeviction` maxmemory policy.
