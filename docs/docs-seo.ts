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
      'Learn how to self-host, configure, operate, and extend Codra, an open-source pull request review engine for Cloudflare Workers.',
    h1: 'Codra documentation',
    sections: [
      {
        heading: 'Why should I choose Codra for code review?',
        body:
          'Codra is engineered for teams who want total ownership of their review engine and AI model choices. It gives you a private job history, full control of your GitHub App, and your own Cloudflare Worker and PostgreSQL database.',
        links: [
          { label: 'Installation guide', href: '/docs/installation' },
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
          'The documentation covers initial installation, environment variable setup, repository review policies, provider management, encrypted API keys, fallback model routing, and deploying across multiple hosting platforms.',
      },
    ],
  },
  {
    path: '/docs/installation',
    title: 'Install Codra | Prerequisites',
    description:
      'Set up the prerequisites to deploy Codra: clone the repository, configure a GitHub App, and provision a PostgreSQL database.',
    h1: 'Install Codra',
    sections: [
      {
        heading: 'What are the installation prerequisites for Codra?',
        body:
          'You need a provisioned PostgreSQL database, a registered GitHub App, and an encryption key for dashboard-managed provider credentials.',
      },
      {
        heading: 'What are the deployment targets for Codra?',
        body:
          'Once the prerequisites are complete, you can deploy Codra to Cloudflare Workers (the primary serverless target), run it on a Node.js server, or run it via Docker Compose.',
        links: [
          { label: 'Cloudflare Workers', href: '/docs/cloudflare' },
          { label: 'Node.js', href: '/docs/nodejs' },
          { label: 'Docker', href: '/docs/docker' },
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
      }
    ],
  },
  {
    path: '/docs/nodejs',
    title: 'Deploy Codra on Node.js',
    description:
      'Run Codra on a Node.js server with BullMQ and Redis. Configure environment variables and deploy with a single command.',
    h1: 'Node.js deployment',
    sections: [
      {
        heading: 'How do I run Codra on a Node.js server?',
        body:
          'Provide a REDIS_URL along with the standard database and GitHub App credentials, then build and start the server. You can also run the API and background workers as separate processes for independent scaling.',
        links: [
          { label: 'Installation prerequisites', href: '/docs/installation' },
          { label: 'Configure Codra', href: '/docs/configuration' },
        ],
      }
    ],
  },
  {
    path: '/docs/docker',
    title: 'Deploy Codra with Docker',
    description:
      'Run Codra with Docker Compose for local development or self-hosted deployments. Build and publish custom images to Docker Hub.',
    h1: 'Docker deployment',
    sections: [
      {
        heading: 'How do I run Codra using Docker?',
        body:
          'Use the provided docker-compose.yml to run PostgreSQL, Redis, and the Codra worker together locally. For production, you can build a custom image or pull a published image from Docker Hub.',
        links: [
          { label: 'Installation prerequisites', href: '/docs/installation' },
          { label: 'Configure Codra', href: '/docs/configuration' },
        ],
      }
    ],
  },
  {
    path: '/docs/local-dev',
    title: 'Codra Local Development',
    description:
      'Run Codra locally with wrangler dev. Set up .dev.vars, run migrations, and start the development server.',
    h1: 'Local development',
    sections: [
      {
        heading: 'How do I run the Codra development server?',
        body:
          'Copy the example environment variables, set up your secrets, run migrations, and start the parallel development server. The dashboard and API run together locally via wrangler dev.',
        links: [
          { label: 'Installation prerequisites', href: '/docs/installation' },
          { label: 'Configure Codra', href: '/docs/configuration' },
        ],
      }
    ],
  },
  {
    path: '/docs/configuration',
    title: 'Configure Codra',
    description:
      'Configure Codra Worker secrets, repository review settings, dashboard-managed providers, fallbacks, and DB-backed model routing.',
    h1: 'Configure Codra',
    sections: [
      {
        heading: 'How do I configure Codra environment variables?',
        body:
          'Codra separates core platform secrets (GitHub credentials, Cloudflare API keys) from dashboard-managed LLM provider credentials. This ensures infrastructure variables stay isolated and secure across your production deployment.',
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
          'Codra supports Cloudflare native Workers AI, Google Gemini, Anthropic, OpenAI, and OpenRouter. Custom endpoints matching the OpenAI, Anthropic, or Gemini spec formats are also supported.',
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
      'Set up a serverless Neon PostgreSQL database and connect Codra to it through Cloudflare Hyperdrive for production deployments.',
    h1: 'Deploy Codra with Neon',
    sections: [
      {
        heading: 'How do I set up a Neon PostgreSQL database?',
        body:
          'Create a Neon project and choose a region close to your users. Retrieve the pooled connection string and use it as NEON_DATABASE_URL for Codra.',
      },
      {
        heading: 'How do I configure Cloudflare Hyperdrive with Neon?',
        body:
          'Use Cloudflare Hyperdrive to pool and accelerate database connections from the Worker runtime. After configuring the pool, bind the Hyperdrive ID in your wrangler config to finalize the connection.',
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
      'Provision a Railway PostgreSQL database and connect Codra to it through Cloudflare Hyperdrive for production deployments.',
    h1: 'Deploy Codra with Railway',
    sections: [
      {
        heading: 'How do I set up a Railway PostgreSQL database?',
        body:
          'Provision a PostgreSQL service on Railway, then retrieve the public TCP proxy connection string and configure it as DATABASE_URL for Codra.',
      },
      {
        heading: 'How do I configure Cloudflare Hyperdrive with Railway?',
        body:
          'Use Cloudflare Hyperdrive to pool and accelerate database connections from your Worker runtime. Once configured, bind the generated Hyperdrive ID into your wrangler config.',
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
          'The operations guide covers resolving webhook failures, missing jobs, and mention review issues. It details fixing dashboard login problems, repository sync errors, provider call failures, and dead-letter queue access.',
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
