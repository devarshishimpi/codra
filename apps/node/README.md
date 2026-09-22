# @codraoss/node-server

The Node.js deployment target for Codra. Runs the same API, dashboard, and review
engine as the Cloudflare Worker, backed by Postgres and Redis instead of
Hyperdrive, KV, and Cloudflare Queues.

Use this when you want Codra on a VM, a VPS, or any platform that runs Docker
(Coolify, Railway, Render, Fly.io).

## Run the stack with Docker

From the repository root:

```bash
cp .env.docker.example .env
# fill in the GitHub App and OAuth values, then:
docker compose up -d
```

The dashboard is at <http://localhost:3000>.

`docker compose up` starts four things:

| Service     | What it does                                              |
| ----------- | --------------------------------------------------------- |
| `postgres`  | Database, on a named volume so data survives restarts      |
| `redis`     | Config cache and the review job queue                      |
| `migrate`   | Applies `packages/db/migrations`, then exits               |
| `codra-app` | The API, dashboard, and webhook receiver on port 3000      |

The app waits for Postgres and Redis to report healthy and for `migrate` to
finish, so a first boot lands on a ready schema.

Postgres and Redis are published on `127.0.0.1` only, so deploying this file to
a VPS does not expose them to the internet. They are still reachable by anything
else on the host, and they ship with development credentials, so change
`POSTGRES_PASSWORD` before you deploy and drop the `ports:` entries from
`docker-compose.yml` if you do not need to reach them from the host; the
services find each other over the compose network either way.

Useful commands:

```bash
docker compose logs -f codra-app   # follow the app logs
docker compose ps                  # health of each service
docker compose down                # stop (volumes are kept)
docker compose down -v             # stop and delete the database
```

## Configuration

Every value lives in `.env`; see `.env.docker.example` for the full list with
comments. The ones you must set before the app will boot:

| Variable                    | Notes                                              |
| --------------------------- | -------------------------------------------------- |
| `GITHUB_APP_ID`             | From your GitHub App settings page                  |
| `GITHUB_APP_WEBHOOK_SECRET` | The webhook secret on that same page                |
| `APP_PRIVATE_KEY`           | The App private key, newlines written as `\n`       |
| `GITHUB_CLIENT_ID`          | OAuth client, for dashboard sign-in                 |
| `GITHUB_CLIENT_SECRET`      | OAuth client secret                                 |
| `DASHBOARD_ALLOWED_USERS`   | Your GitHub username; nobody else can sign in       |
| `LLM_CONFIG_ENCRYPTION_KEY` | `openssl rand -base64 48`, encrypts provider keys   |
| `APP_URL`                   | Public URL; set with `AUTH_CALLBACK_URL` for a domain |

`DATABASE_URL` and `REDIS_URL` already point at the bundled services. Point them
somewhere else to use a managed database or a hosted Redis.

LLM provider API keys are not environment variables: add them from the dashboard
Settings page once you can sign in.

## Running without Docker

```bash
npm ci
npx vite build                            # builds the dashboard into dist/client
npm run dev --workspace=@codraoss/node-server
```

The server reads `.dev.vars` from the repository root, and expects Postgres and
Redis to be reachable at `DATABASE_URL` and `REDIS_URL`.

## Current limitations

Dashboard sessions are held in memory, not in Redis, so restarting or
redeploying the container signs every dashboard user out. They sign back in
through GitHub; nothing else is lost.

Queued reviews are not processed yet. The webhook receiver, dashboard, and queue
producer all work, but the review runtime for Node is still being built
(issues [#106](https://github.com/devarshishimpi/codra/issues/106) and
[#107](https://github.com/devarshishimpi/codra/issues/107)), so jobs land in
Redis and wait there. Cloudflare Workers remains the deployment target that
completes reviews today.
