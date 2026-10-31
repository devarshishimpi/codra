// docs/docs-seo.ts
// Docs-specific SEO metadata for codra.run/docs/* routes.
// This file is copied to codra-web/src/shared/docs-seo.ts by the CI deploy workflow.

export type DocsSeoSection = {
  heading: string;
  body: string;
  links?: { label: string; href: string }[];
};

export type DocsSeoPage = {
  path: string;
  title: string;
  description: string;
  h1: string;
  sections: DocsSeoSection[];
  noindex?: boolean;
};

export const DOCS_SEO_PAGES: DocsSeoPage[] = [
  {
    path: '/docs',
    title: 'Codra Documentation',
    description:
      'Learn how to self-host, configure, operate, and extend Codra, an open-source pull request review engine supporting Cloudflare Workers, Node.js 24, and Docker.',
    h1: 'Codra documentation',
    sections: [
      {
        heading: 'Why should I choose Codra for code review?',
        body:
          'Codra is engineered for teams who want total ownership of their review engine and AI model choices. It gives you a private job history, full control of your GitHub App, and your choice of deployment runtime: serverless on Cloudflare Workers or self-hosted on Node.js 24 and Docker with BullMQ and Redis.',
        links: [
          { label: 'Installation guide', href: '/docs/installation' },
          { label: 'Deploy to Cloudflare Workers', href: '/docs/cloudflare' },
          { label: 'Deploy with Docker', href: '/docs/docker' },
          { label: 'Deploy on Node.js', href: '/docs/nodejs' },
          { label: 'Local Development', href: '/docs/local-dev' },
          { label: 'Configuration guide', href: '/docs/configuration' },
          { label: 'Providers guide', href: '/docs/providers' },
          { label: 'Operations guide', href: '/docs/operations' },
          { label: 'Contributing guide', href: '/docs/contributing' },
          { label: 'Deploy with Neon', href: '/docs/neon' },
          { label: 'Deploy with Railway', href: '/docs/railway' },
        ],
      },
      {
        heading: 'What topics are covered in the documentation?',
        body:
          'The documentation covers initial installation, environment variable setup, repository review policies, provider management, encrypted API keys, fallback model routing, containerized deployment, and operating across multiple platforms.',
      },
    ],
  },
  {
    path: '/docs/installation',
    title: 'Install Codra | Prerequisites',
    description:
      'Set up the prerequisites to deploy Codra: configure a GitHub App, provision a PostgreSQL database, and choose between Cloudflare Workers, Node.js, or Docker.',
    h1: 'Install Codra',
    sections: [
      {
        heading: 'What are the installation prerequisites for Codra?',
        body:
          'All deployments require a provisioned PostgreSQL 13+ database, a registered GitHub App with PR and check-run permissions, and an encryption key for dashboard-managed provider credentials. Cloudflare Workers deployments require a Cloudflare account; Node.js and Docker deployments require Redis 6+ for BullMQ job queues.',
      },
      {
        heading: 'What are the deployment targets for Codra?',
        body:
          'Codra supports three first-class deployment targets: Cloudflare Workers for edge serverless deployments, Node.js 24 LTS for Linux and bare-metal hosts, and hardened Distroless Docker containers using Docker Compose or official Docker Hub images.',
        links: [
          { label: 'Cloudflare Workers', href: '/docs/cloudflare' },
          { label: 'Docker Deployment', href: '/docs/docker' },
          { label: 'Node.js Deployment', href: '/docs/nodejs' },
          { label: 'Local Development', href: '/docs/local-dev' },
        ],
      },
    ],
  },
  {
    path: '/docs/cloudflare',
    title: 'Deploy Codra to Cloudflare Workers',
    description:
      'Deploy Codra to Cloudflare Workers using the automated setup script or manual wrangler configuration, with Git-triggered auto-deployment.',
    h1: 'Cloudflare Workers deployment',
    sections: [
      {
        heading: 'How do I deploy Codra to Cloudflare Workers?',
        body:
          'Use the automated setup script to configure Cloudflare resources (KV, Queues, Hyperdrive), bind them in your wrangler config, and deploy with npm run deploy.',
        links: [
          { label: 'Installation prerequisites', href: '/docs/installation' },
          { label: 'Configure Codra', href: '/docs/configuration' },
          { label: 'Deploy to Neon', href: '/docs/neon' },
        ],
      },
    ],
  },
  {
    path: '/docs/nodejs',
    title: 'Deploy Codra on Node.js',
    description:
      'Run Codra natively on Node.js 24 LTS with BullMQ and Redis. Configure environment variables, run migrations, and deploy as a systemd service or with PM2.',
    h1: 'Node.js deployment',
    sections: [
      {
        heading: 'How do I run Codra on a Node.js server?',
        body:
          'Provide DATABASE_URL and REDIS_URL along with standard GitHub App credentials, build workspace packages, and launch with npm run deploy:node. Codra natively supports both PKCS#1 and PKCS#8 private keys, provides built-in database DNS retry resilience, and handles graceful shutdowns.',
        links: [
          { label: 'Installation prerequisites', href: '/docs/installation' },
          { label: 'Configure Codra', href: '/docs/configuration' },
          { label: 'Docker deployment', href: '/docs/docker' },
        ],
      },
      {
        heading: 'Can I scale the API and background review workers separately?',
        body:
          'Yes. Use START_WORKER=false to run a dedicated HTTP API server behind your reverse proxy, and START_API=false to run dedicated BullMQ review workers that scale with pull-request volume.',
      },
    ],
  },
  {
    path: '/docs/docker',
    title: 'Deploy Codra with Docker',
    description:
      'Deploy Codra using the official devarshishimpi/codra image or Docker Compose. Hardened Distroless Node.js 24 runtime with non-root security.',
    h1: 'Docker deployment',
    sections: [
      {
        heading: 'How do I run Codra using Docker?',
        body:
          'Pull the official multi-arch image devarshishimpi/codra from Docker Hub or use the repository docker-compose.yml. Codra runs on Google Distroless Node.js 24 as a non-root user, connecting to external PostgreSQL and Redis with built-in container health checks.',
        links: [
          { label: 'Official Docker Hub image', href: 'https://hub.docker.com/r/devarshishimpi/codra' },
          { label: 'Installation prerequisites', href: '/docs/installation' },
          { label: 'Configure Codra', href: '/docs/configuration' },
          { label: 'Node.js deployment', href: '/docs/nodejs' },
        ],
      },
      {
        heading: 'How do I scale Codra in containerized environments?',
        body:
          'Scale your cluster by running separate API and worker containers using START_API and START_WORKER environment flags. Active review jobs complete safely during rolling updates thanks to a 15-second graceful shutdown grace period.',
      },
    ],
  },
  {
    path: '/docs/local-dev',
    title: 'Codra Local Development',
    description:
      'Run Codra locally with Node.js watch mode, Cloudflare Workers via Wrangler, or Docker Compose. Fast local development workflows for all runtimes.',
    h1: 'Local development',
    sections: [
      {
        heading: 'How do I run the Codra development server?',
        body:
          'Choose your workflow: run npm run dev:node for live TypeScript watch mode on Node.js, npm run dev for Cloudflare Workers simulation with Wrangler, or docker compose up -d for containerized testing. All workflows share the same PostgreSQL migrations and database schema.',
        links: [
          { label: 'Installation prerequisites', href: '/docs/installation' },
          { label: 'Configure Codra', href: '/docs/configuration' },
        ],
      },
      {
        heading: 'How do I test GitHub webhooks locally?',
        body:
          'Expose your local development port (3000 for Node/Docker, 8787 for Wrangler) using Cloudflare Quick Tunnels (cloudflared tunnel --url) or ngrok, then set the generated HTTPS URL as your GitHub App webhook endpoint.',
      },
    ],
  },
  {
    path: '/docs/configuration',
    title: 'Configure Codra',
    description:
      'Configure Codra runtime secrets, repository review settings, dashboard-managed providers, fallbacks, and DB-backed model routing.',
    h1: 'Configure Codra',
    sections: [
      {
        heading: 'How do I configure Codra environment variables?',
        body:
          'Codra separates platform runtime secrets (GitHub App credentials, database connections, Redis URLs) from dashboard-managed LLM provider keys. This keeps infrastructure configuration isolated across Cloudflare Workers, Node.js, and Docker.',
      },
      {
        heading: 'How do I manage repository review settings?',
        body:
          'Repository-level settings control your pull request triggers, draft handling, and mention-based review requests. They also define which files are skipped, review budgets, focus categories, and custom rules.',
      },
      {
        heading: 'How does model routing work in Codra?',
        body:
          'Codra builds a resilient, ordered model execution chain from database-backed Codra model identifiers, then maps each route to provider-specific model names configured through the dashboard.',
        links: [
          { label: 'Providers guide', href: '/docs/providers' },
          { label: 'Operations guide', href: '/docs/operations' },
        ],
      },
    ],
  },
  {
    path: '/docs/providers',
    title: 'Codra Providers Guide',
    description:
      'Configure dashboard-managed LLM providers, encrypted provider keys, model catalogs, custom endpoints, and Codra model routing.',
    h1: 'Codra providers',
    sections: [
      {
        heading: 'What types of AI providers does Codra support?',
        body:
          'Codra supports Cloudflare native Workers AI (on Cloudflare Workers), Google Gemini, Anthropic, OpenAI, and OpenRouter across all runtimes. Custom endpoints matching the OpenAI, Anthropic, or Gemini spec formats are also supported.',
        links: [{ label: 'Configuration guide', href: '/docs/configuration' }],
      },
      {
        heading: 'How are provider credentials and catalogs managed?',
        body:
          'Provider API keys are entered in the dashboard, encrypted with LLM_CONFIG_ENCRYPTION_KEY, and stored in PostgreSQL. Keys are never returned in plaintext after saving.',
        links: [
          { label: 'Deploy with Neon', href: '/docs/neon' },
          { label: 'Operations guide', href: '/docs/operations' },
        ],
      },
      {
        heading: 'How do I troubleshoot Codra provider issues?',
        body:
          'If a provider shows no models after syncing, verify the API key has permission to list models. For Cloudflare Workers AI, confirm CF_API_TOKEN has Account > Workers AI: Read permission. If reviews fail with a model error, check that the model ID in your repository config exactly matches the Codra model ID shown in the dashboard.',
        links: [{ label: 'Configuration guide', href: '/docs/configuration' }],
      },
    ],
  },
  {
    path: '/docs/neon',
    title: 'Deploy With Neon',
    description:
      'Set up a serverless Neon PostgreSQL database and connect Codra to it through Cloudflare Hyperdrive or direct connection pooling.',
    h1: 'Deploy Codra with Neon',
    sections: [
      {
        heading: 'How do I set up a Neon PostgreSQL database?',
        body:
          'Create a Neon project and choose a region close to your users. Retrieve the pooled connection string and use it as DATABASE_URL (or NEON_DATABASE_URL) for Codra.',
      },
      {
        heading: 'How do I configure Cloudflare Hyperdrive with Neon?',
        body:
          'For Cloudflare Workers deployments, use Cloudflare Hyperdrive to pool and accelerate database connections. On Node.js and Docker, connect directly using the connection string with pooled mode.',
        links: [
          { label: 'Installation guide', href: '/docs/installation' },
          { label: 'Deploy with Railway', href: '/docs/railway' },
        ],
      },
    ],
  },
  {
    path: '/docs/railway',
    title: 'Deploy With Railway',
    description:
      'Provision a Railway PostgreSQL database and connect Codra to it for production deployments.',
    h1: 'Deploy Codra with Railway',
    sections: [
      {
        heading: 'How do I set up a Railway PostgreSQL database?',
        body:
          'Provision a PostgreSQL service on Railway, then retrieve the public TCP proxy connection string and configure it as DATABASE_URL for Codra.',
      },
      {
        heading: 'How do I configure database pooling with Railway?',
        body:
          'On Cloudflare Workers, use Cloudflare Hyperdrive to accelerate queries. On Node.js and Docker, Codra connects directly using the PostgreSQL connection string.',
        links: [{ label: 'Installation guide', href: '/docs/installation' }],
      },
    ],
  },
  {
    path: '/docs/operations',
    title: 'Codra Operations Guide',
    description:
      'Understand Codra pull request review jobs, mention-triggered reviews, stale job recovery, GitHub output, dashboard usage, and troubleshooting steps.',
    h1: 'Operate Codra',
    sections: [
      {
        heading: 'How does the Codra review lifecycle work?',
        body:
          'Codra creates review jobs from pull request events and mention-triggered issue comments. It fetches diffs, reviews changed files, posts summaries, and updates GitHub checks on completion.',
      },
      {
        heading: 'How do I troubleshoot Codra operational issues?',
        body:
          'The operations guide covers resolving webhook failures, missing jobs, and mention review issues. It details fixing dashboard login problems, BullMQ queue connectivity, Redis TLS configuration, container health checks, and database DNS retries.',
        links: [{ label: 'Contributing guide', href: '/docs/contributing' }],
      },
      {
        heading: 'What does Codra post to GitHub after a review?',
        body:
          'For each completed job, Codra posts a GitHub check run with pass or fail status, a pull request review body with the overall summary, and inline comments on diff positions when GitHub accepts them. If inline comments are rejected, Codra retries with a summary-only review so the PR always receives feedback.',
      },
    ],
  },
  {
    path: '/docs/contributing',
    title: 'Contributing to Codra',
    description:
      'Learn how to contribute to Codra with the recommended GitHub workflow, TypeScript conventions, CLA requirement, and private security reporting policy.',
    h1: 'Contribute to Codra',
    sections: [
      {
        heading: 'What is the standard Codra contribution workflow?',
        body:
          'Fork the repository, create a focused branch, install dependencies, make a tightly scoped change, run typecheck and tests, then open a clear pull request.',
      },
      {
        heading: 'What are the CLA and security reporting requirements?',
        body:
          'All contributors must sign the Codra CLA before their code can merge. Security vulnerabilities must be reported privately, not opened as public issues.',
        links: [{ label: 'Sign the CLA', href: '/cla' }],
      },
      {
        heading: 'What are the engineering conventions for Codra contributions?',
        body:
          'Codra uses strict TypeScript with Zod for runtime data boundaries. Keep changes focused to one logical change per PR, follow Conventional Commits, and add or update tests when behavior changes. Database schema changes require a new migration file in db/migrations/.',
      },
    ],
  },
];
