# Self-Hosting with Docker

While Codra is natively optimized for Cloudflare Workers, you can easily self-host the entire architecture on a dedicated server (like a VPS or EC2 instance) using Docker. This setup replaces Cloudflare infrastructure with standard open-source equivalents:

* **Node.js** (Web Server and Job Runner)
* **PostgreSQL** (Database)
* **Redis** (Key-Value Store and Queues via BullMQ)

## Prerequisites

Before deploying, ensure your server has the following installed:
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

You will also need:
- A GitHub App configured for your organization (See [GitHub App Setup](../setup/github-app.md)). You will need the **App ID**, **Client ID**, **Client Secret**, **Webhook Secret**, and **Private Key**.
- An API Key for your chosen LLM provider (e.g., Anthropic, OpenAI, or Google).

## Environment Setup

Create a `.env` file in the root of the cloned repository. This file handles all your secrets.

```env
# Server Configuration
APP_URL=https://codra.yourdomain.com
ENVIRONMENT=production

# Database & Redis (these map to the docker-compose.yml service names)
DATABASE_URL=postgres://postgres:password@postgres:5432/codra
REDIS_URL=redis://redis:6379

# GitHub App Secrets
GITHUB_APP_ID=your_app_id
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_APP_WEBHOOK_SECRET=your_webhook_secret
APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"

# Application Settings
AUTH_CALLBACK_URL=https://codra.yourdomain.com/api/auth/callback
DASHBOARD_ALLOWED_USERS=your_github_username
BOT_USERNAME=your-github-app-slug[bot]

# Encryption Key (Must be 32 random characters for AES-256)
LLM_CONFIG_ENCRYPTION_KEY=generate_a_random_32_char_string
```

## Running the Stack

Once your `.env` is prepared, deploying is a single command. From the root of the repository, run:

```bash
docker compose up -d --build
```

This command will:
1. Compile the Codra Node app and its workspace dependencies.
2. Boot Postgres and Redis containers.
3. Start the Codra Node application container (which runs both the HTTP server and the background worker by default).

To view logs:
```bash
docker compose logs -f codra-app
```

The application should now be accessible at `http://localhost:3000` (or whatever `PORT` you configured).

## Advanced Configuration: Scaling (Unified Process Model)

By default, the `codra-app` service boots *both* the web server (Hono API) and the background worker (BullMQ) in a single Node process. 

For high-traffic environments, you may want to scale the API web nodes independently of the heavy AI review worker nodes. 

You can split these by overriding the `START_WORKER` and `START_API` environment variables across different containers.

**API Node:**
```env
START_WORKER=false
# START_API=true (Default)
```

**Worker Node:**
```env
START_WORKER=true
START_API=false # Disables the HTTP server
```

This allows you to spin up multiple worker containers listening to Redis while load-balancing incoming HTTP requests to your API nodes.
