# Contributing to Codra

Thank you for your interest in contributing to Codra! We are building a high-performance, intelligent PR review engine for the Cloudflare ecosystem, and we value contributions that align with our goals of precision and reliability.

---

## Contributor License Agreement (CLA)

Before we can merge your pull request, you must sign our Contributor License Agreement. This is a quick process that takes about 10 seconds and ensures that your contributions can be included under our dual-licensing model (AGPL-3.0 for the core).

- **How to sign:** Visit [codra.run/cla](https://codra.run/cla) or follow the link provided by the automated GitHub check on your PR.

---

## Repository Layout

Codra is an npm workspace monorepo. The repository is structured into `apps/` (deployable entrypoints) and `packages/` (reusable modules):

```text
packages/
├── schema/             # Shared types + zod contracts (zero dependencies)
├── core/               # Review engine (pure ports, depends on schema)
├── db/                 # Postgres interactions and migrations (depends on schema, core)
├── models/             # LLM provider integrations (depends on schema, core)
├── provider-github/    # GitHub API adapter (depends on schema, core)
├── api/                # Hono router and API routes (depends on schema, core, db, models, provider-github)
└── ui/                 # React design system and primitives (depends on schema)

apps/
├── worker/             # Cloudflare Worker entrypoint (wires bindings to api ports)
└── dashboard/          # React SPA frontend (depends on ui, schema)
```

**Note:** The `packages/*` modules are published to npm as `@codraoss/*`; the workspace consumes them as TypeScript source and only the published tarballs carry compiled output. Reusable logic belongs in a package, deployment wiring in `apps/worker`, and UI in `apps/dashboard`.

---

## Local Development Setup

Codra is a monorepo-style project built with **Hono** (Worker), **React** (Vite), and **Cloudflare Workers**.

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (Latest LTS)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-upgrading/) (`npm install -g wrangler`)
- A Postgres-compatible database and a Cloudflare Hyperdrive config.

### 2. Installation

```bash
git clone https://github.com/devarshishimpi/codra.git
cd codra
npm install
```

### 3. Environment Variables

Copy `.dev.vars.example` to `.dev.vars` and fill in your secrets:

```bash
cp .dev.vars.example .dev.vars
```

You will need to set up:

- A GitHub App (for webhooks/checks).
- A GitHub OAuth App (for dashboard authentication).
- `LLM_CONFIG_ENCRYPTION_KEY` for encrypting dashboard-managed provider API keys.
- LLM providers and model credentials from the Settings dashboard.
- A Hyperdrive local connection string for `wrangler dev`.
- A direct `DATABASE_URL` for migrations.

### 4. Running Locally

Codra uses `concurrently` to run the Vite frontend and the Wrangler worker simultaneously:

```bash
npm run dev
```

- Frontend: `http://localhost:5173` (proxied via Worker)
- Worker: `http://localhost:8787`

---

## Testing

We use **Vitest** for unit and integration testing. `npm test` requires a disposable Postgres database, runs migrations against it, and then runs the full test suite.

The test runner loads `.env.test`, `.env.local`, `.env`, `.dev.vars`, and then `.env.test.example`. Override `TEST_DATABASE_URL` in one of the private env files when your local test database does not match the example URL.

```bash
# Run the full test suite
npm test

# Run tests in watch mode
npm run test:watch

# Run typecheck
npm run typecheck
```

### Browser E2E tests

Browser tests live in `playwright/`, separate from the existing Vitest/JSDOM tests under `test/`. The Playwright setup runs one Chromium smoke test against the real local Node server and uses a synthetic signed-out session response; it does not sign in to GitHub or call a real LLM provider.

Requirements: Node.js 24+, Docker, and disposable local PostgreSQL and Redis services.

```bash
# Clean up any leftover test containers from a previous run
docker rm -f codra-e2e-postgres codra-e2e-redis 2>/dev/null || true

# Start isolated local services (keep these separate from any real Codra data).
docker run -d --name codra-e2e-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=codra_e2e -p 127.0.0.1:5432:5432 postgres:16
docker run -d --name codra-e2e-redis -p 127.0.0.1:6379:6379 redis:7-alpine

# Use only the synthetic values in this file.
cp .env.e2e.example .env.e2e

# Install the pinned browser binary once, then run the browser suite.
npm ci
npx playwright install chromium
npm run test:e2e

# Stop and remove the disposable services when finished.
docker rm -f codra-e2e-postgres codra-e2e-redis 2>/dev/null || true
```

`npm run test:e2e` builds the Node server and dashboard, then Playwright starts the Node server on `http://localhost:3000` automatically. The launcher reads `.env.e2e`, generates a throwaway GitHub App private key for server initialization, disables the background review worker and telemetry, and never needs real GitHub, OAuth, or LLM credentials. The smoke test stubs only `GET /api/auth/session` as signed out. No database migration or seeded application data is needed for this first smoke test; keep `DATABASE_URL` pointed at the disposable database above.

The browser output is written to `test-results/` and `playwright-report/`; both are gitignored. To inspect the HTML report after a run, use `npx playwright show-report`.

---

## Contributing to Documentation

All documentation content for [codra.run/docs](https://codra.run/docs) lives in `docs/*.mdx` in this repository. Even though the website repo is private, **all documentation is 100% open source** and deploys automatically when PRs are merged into `main`.

### MDX Guidelines
- **Files & Routes**: Each file in `docs/*.mdx` maps directly to a route (e.g. `docs/docker.mdx` -> `codra.run/docs/docker`).
- **Headings with IDs**: Use explicit HTML `<h2 id="section-id">Heading</h2>` for major sections to ensure working anchor links and sidebar navigation. Use standard markdown `###` for subheadings.
- **Callouts**: Use `<Note type="info">`, `<Note type="tip">`, or `<Note type="warn">` (standard blockquotes `> ` also render as info callouts).
- **Code Blocks**: Always specify language identifiers on fenced blocks (e.g. `bash`, `ini`, `json`, `yaml`).
- **Links**: Use `<Link to="/docs/target">Text</Link>` for internal doc navigation, and standard markdown `[Text](https://...)` for external links.
- **SEO Metadata**: When creating or significantly updating documentation, update the corresponding route entry in `docs/docs-seo.ts`.

---

## Pull Request Process

Pull requests are reviewed and merged directly into `main`. There is no separate `dev` integration
branch or release-branch promotion step.

1.  **Fork & Branch**: Create a feature branch from `main`.
2.  **Atomic Commits**: Keep your commits focused and descriptive.
3.  **Sync**: Ensure your branch is up to date with `main`.
4.  **Target Branch**: Open pull requests against `main`.
5.  **PR Description**: Use the provided template (if available) or clearly explain the _what_ and _why_ of your changes.
6.  **Checks & CLA**: Ensure the required CI checks pass. An automated check verifies your CLA status; if you haven't signed yet, follow the link in the check output.

---

### Good First Issues

New to Codra? We label issues that are well-scoped, clearly described, and approachable for first-time contributors. Every good-first-issue comes with context: which file or area to look at, what "done" looks like, and why the fix or feature matters.

- Browse issues labelled [**good first issue**](https://github.com/devarshishimpi/codra/labels/good%20first%20issue) for standalone, beginner-friendly tasks.
- Browse [**help wanted**](https://github.com/devarshishimpi/codra/labels/help%20wanted) for issues where maintainer bandwidth is limited and community help is especially appreciated.

If you pick one up, leave a comment so others know it is being worked on. Feel free to ask questions directly in the issue thread — we're happy to help you get started.

---

## Licensing

Codra is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. By contributing, you agree that your work will be licensed under the same terms, plus the additional grants specified in the CLA.
