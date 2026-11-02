<div align="center">
  <h1>Codra</h1>

  <p>
    Self-hosted AI code review for GitHub pull requests.<br/>
    Multi-runtime (Cloudflare Workers, Node.js 24, Docker), queue-backed, repository-aware, and built for teams that want to own their review engine.
  </p>

  <p>
    <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg"></a>
    <a href="https://github.com/sponsors/devarshishimpi"><img alt="Sponsor" src="https://img.shields.io/badge/Sponsor-devarshishimpi-EA4AAA?logo=githubsponsors"></a>
    <a href="https://workers.cloudflare.com/"><img alt="Cloudflare Workers" src="https://img.shields.io/badge/runtime-Cloudflare%20Workers-f38020?logo=cloudflare"></a>
    <a href="https://nodejs.org/"><img alt="Node.js" src="https://img.shields.io/badge/runtime-Node.js-339933?logo=node.js&logoColor=white"></a>
    <a href="https://hub.docker.com/r/devarshishimpi/codra"><img alt="Docker" src="https://img.shields.io/badge/docker-devarshishimpi%2Fcodra-2496ed?logo=docker&logoColor=white"></a>
    <a href="https://react.dev/"><img alt="Built with React" src="https://img.shields.io/badge/dashboard-React-61dafb?logo=react&logoColor=111"></a>
    <a href="https://www.typescriptlang.org/"><img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript&logoColor=fff"></a>
  </p>

  <p>
    <a href="https://codra.run">Website</a>
    |
    <a href="https://codra.run/docs">Docs</a>
    |
    <a href="https://codra.run/docs/installation">Installation</a>
    |
    <a href="https://codra.run/docs/cloudflare">Cloudflare</a>
    |
    <a href="https://codra.run/docs/docker">Docker</a>
    |
    <a href="https://codra.run/docs/nodejs">Node.js</a>
    |
    <a href="https://github.com/devarshishimpi/codra/issues">Issues</a>
    |
    <a href="CONTRIBUTING.md">Contributing</a>
  </p>
</div>

![Codra dashboard](./public/assets/codra-dashboard.png)

Codra listens to GitHub pull request events, runs AI-powered review jobs, posts inline findings back to the PR, and gives you a dashboard to inspect jobs, repositories, model routing, review history, and failed queue runs.

> **Beta** - Codra is under active development. Cloudflare Worker is stable for self-hosted use; Node/Docker standalone is newer and still being hardened. Expect rough edges. Bugs and feedback welcome via [GitHub Issues](https://github.com/devarshishimpi/codra/issues).

## Why Codra

- **Own the whole review loop**: Run the GitHub App, web server, queue, database, model credentials, and dashboard under your own control (deploy on Cloudflare Workers, Node.js 24, or your own server via Docker).
- **Review with repository context**: Codra checks pull request diffs for correctness, security, performance, maintainability, and repo-specific patterns.
- **Configure each repository**: Tune triggers, skipped paths, draft handling, mention reviews, labels, custom rules, and review budgets from the dashboard.
- **Route models deliberately**: Use global defaults, per-repo model chains, fallbacks, and size-based overrides for larger pull requests.
- **Operate the system**: Inspect job history, PR findings, webhook deliveries, model usage, and dashboard stats.

## Features

- Automatic reviews on `opened`, `synchronize`, `ready_for_review`, and `reopened` pull request events
- Mention-triggered reviews for on-demand analysis
- Inline GitHub review comments plus summary reviews and check run updates
- Queue-backed processing through Cloudflare Queues or BullMQ + Redis
- GitHub OAuth dashboard authentication
- PostgreSQL storage with support for Cloudflare Hyperdrive or direct connection pooling
- Dashboard-managed LLM providers for OpenAI, OpenRouter, Anthropic, Google, NVIDIA, and Cloudflare models
- Repository settings for labels, skipped globs, custom rules, and model routing

## How It Works

1. GitHub sends Codra a pull request webhook.
2. Codra verifies the signature and loads repository review settings.
3. A review job is stored in PostgreSQL and queued on Cloudflare Queues or BullMQ.
4. The review worker consumes the job, fetches the PR diff, runs model review passes, and formats findings.
5. Codra posts inline comments and a summary review back to GitHub.
6. The dashboard keeps the job history, findings, logs, and stats available for operators.

## Stack

- **Server / Runtime**: Cloudflare Workers, Node.js 24, Docker (Distroless), Hono, Wrangler
- **Dashboard**: React, Vite, Tailwind CSS, Radix UI, Recharts
- **Data**: PostgreSQL, Cloudflare Hyperdrive, Cloudflare KV, Redis
- **Queues**: Cloudflare Queues, Workflows, BullMQ
- **Models**: OpenAI, OpenRouter, Anthropic, Google, NVIDIA, and Cloudflare providers
- **GitHub**: GitHub App webhooks, checks, reviews, and OAuth
- **Quality**: TypeScript, Zod, Vitest, Playwright browser tests

## Documentation

The full setup and operations guides live at [codra.run/docs](https://codra.run/docs).

- [Installation Prerequisites](https://codra.run/docs/installation)
- [Local Development Guide](https://codra.run/docs/local-dev)
- [Configuration Guide](https://codra.run/docs/configuration)
- [LLM Providers Guide](https://codra.run/docs/providers)
- [Contributing](CONTRIBUTING.md)
- [Security Policy](SECURITY.md)

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request against `dev`. Codra uses a Contributor License Agreement for contributions.

## License

Codra is licensed under the [GNU Affero General Public License v3.0](LICENSE).
