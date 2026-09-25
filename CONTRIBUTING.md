# Contributing to Codra

Thank you for your interest in contributing to Codra! We are building a high-performance, intelligent PR review engine for the Cloudflare ecosystem, and we value contributions that align with our goals of precision and reliability.

---

## ⚖️ Contributor License Agreement (CLA)

Before we can merge your pull request, you must sign our Contributor License Agreement. This is a quick process that takes about 10 seconds and ensures that your contributions can be included under our dual-licensing model (AGPL-3.0 for the core).

- **How to sign:** Visit [codra.run/cla](https://codra.run/cla) or follow the link provided by the automated GitHub check on your PR.

---

## 📦 Repository Layout

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

## 🛠️ Local Development Setup

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

## 🧪 Testing

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

---

## 🚀 Pull Request Process

Contributions are merged into `dev` first and reach `main` when a release is cut, so `main` always
reflects what is deployed and published. Pull requests opened against `main` will be asked to
retarget to `dev`.

1.  **Fork & Branch**: Create a feature branch from `dev`.
2.  **Atomic Commits**: Keep your commits focused and descriptive.
3.  **Sync**: Ensure your branch is up to date with `dev`.
4.  **Target Branch**: Open pull requests against `dev`.
5.  **PR Description**: Use the provided template (if available) or clearly explain the _what_ and _why_ of your changes.
6.  **CLA Check**: Once you open the PR, an automated check will verify your CLA status. If you haven't signed yet, follow the link in the check output.

---

## 📜 Licensing

Codra is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. By contributing, you agree that your work will be licensed under the same terms, plus the additional grants specified in the CLA.
