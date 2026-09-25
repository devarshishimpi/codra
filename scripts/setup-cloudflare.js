import { exec } from "node:child_process";
import util from "node:util";
import fs from "node:fs";
import os from "node:os";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";

const execAsync = util.promisify(exec);

import {
  WRANGLER_JSONC_PATH,
  WORKER_DIR,
  getEnvVars,
  setSecret,
} from "./setup-helpers.js";
import { handleHyperdrive, handleKVNamespace } from "./setup-provisioning.js";

async function main() {
  console.clear();
  console.log(chalk.blue.bold("\n☁️  Codra Cloudflare Setup\n"));
  console.log(
    chalk.gray(
      "This script will automatically configure your Cloudflare resources.\n",
    ),
  );

  const env = getEnvVars();

  const authSpinner = ora("Checking Cloudflare authentication...").start();
  let globallyAuthenticated = true;
  try {
    const { stdout, stderr } = await execAsync("npx wrangler whoami", {
      cwd: WORKER_DIR,
    });
    const output = (stdout + (stderr || "")).toLowerCase();

    // Wrangler sometimes exits with 0 even when not logged in
    if (
      output.includes("not logged in") ||
      output.includes("non-interactive environment") ||
      output.includes("you are not authenticated")
    ) {
      throw new Error("Not logged in");
    }
    authSpinner.succeed("Authenticated with Cloudflare.");
  } catch (error) {
    globallyAuthenticated = false;
    authSpinner.warn("Cloudflare is not authenticated in wrangler.");
  }

  if (!globallyAuthenticated) {
    console.error(chalk.red("\n❌ You are not logged into Cloudflare."));
    console.log(
      chalk.yellow(
        "Please run `npx wrangler login` in your terminal and try again.",
      ),
    );
    process.exit(1);
  }

  console.log(chalk.cyan.bold("📦 KV Namespaces"));
  const kvId = await handleKVNamespace("codra-review", false);
  if (!kvId) console.log(chalk.yellow("  ⚠️ Could not extract KV ID."));

  const kvPreviewId = await handleKVNamespace("codra-review", true);
  if (!kvPreviewId)
    console.log(chalk.yellow("  ⚠️ Could not extract preview KV ID."));
  console.log("");

  console.log(chalk.cyan.bold("📨 Queues"));
  const jobsSpinner = ora("Creating jobs queue (codra-review-jobs)...").start();
  try {
    await execAsync("npx wrangler queues create codra-review-jobs", {
      cwd: WORKER_DIR,
    });
    jobsSpinner.succeed();
  } catch (e) {
    if (
      e.stderr &&
      (e.stderr.includes("already taken") ||
        e.stderr.includes("already exists"))
    ) {
      jobsSpinner.succeed("Jobs queue (codra-review-jobs) already exists.");
    } else {
      jobsSpinner.fail();
      console.error(chalk.yellow("  ⚠️ " + (e.stderr || e.message)));
    }
  }

  console.log("");

  console.log(chalk.cyan.bold("🗄️  Hyperdrive"));
  console.log(chalk.gray(`  (Using default from .dev.vars if available)`));
  const { dbUrl } = await prompts(
    {
      type: "text",
      name: "dbUrl",
      message: "Enter your Database Connection String for Hyperdrive:",
      initial:
        env.DATABASE_URL || "postgres://user:password@hostname:5432/codra",
    },
    {
      onCancel: () => {
        console.log(chalk.red("\n🛑 Setup aborted."));
        process.exit(1);
      },
    },
  );

  if (!dbUrl) {
    console.log(
      chalk.red("❌ Database URL is required for Hyperdrive. Exiting."),
    );
    process.exit(1);
  }

  const hyperdriveId = await handleHyperdrive(dbUrl);
  console.log("");

  console.log(chalk.cyan.bold("🌐 Domain Configuration"));
  const { domainChoice } = await prompts(
    {
      type: "select",
      name: "domainChoice",
      message: "Where would you like to deploy this application?",
      choices: [
        {
          title: "Use a workers.dev subdomain (Free & Easy)",
          value: "workers_dev",
        },
        { title: "Use a Custom Domain", value: "custom_domain" },
      ],
    },
    { onCancel: () => process.exit(1) },
  );

  let appUrl;
  let routesConfigStr;

  if (domainChoice === "workers_dev") {
    routesConfigStr = `"workers_dev": true`;
    const { workersDev } = await prompts(
      {
        type: "text",
        name: "workersDev",
        message:
          "What will be your workers.dev app URL? (e.g. https://codra.username.workers.dev):",
        initial: "https://codra.<username>.workers.dev",
      },
      { onCancel: () => process.exit(1) },
    );
    appUrl = workersDev.replace(/\/$/, "");
  } else {
    const { customDomain } = await prompts(
      {
        type: "text",
        name: "customDomain",
        message: "Enter your custom domain:",
        initial: "app.codra.devarshi.dev",
      },
      { onCancel: () => process.exit(1) },
    );

    appUrl = `https://${customDomain}`;
    routesConfigStr = `"routes": [
    {
      "pattern": "${customDomain}",
      "custom_domain": true
    }
  ]`;
  }
  console.log("");

  console.log(chalk.cyan.bold("📝 Application Variables"));
  const { botUsername } = await prompts(
    {
      type: "text",
      name: "botUsername",
      message: "Enter your GitHub Bot Username:",
      initial: "codra-app",
    },
    { onCancel: () => process.exit(1) },
  );

  const { githubAppSlug } = await prompts(
    {
      type: "text",
      name: "githubAppSlug",
      message: "Enter your GitHub App Slug:",
      initial: "codra-app-personal",
    },
    { onCancel: () => process.exit(1) },
  );

  const { allowedUsers } = await prompts(
    {
      type: "text",
      name: "allowedUsers",
      message:
        "Enter comma-separated GitHub usernames allowed to access the dashboard:",
      initial: "devarshishimpi",
    },
    { onCancel: () => process.exit(1) },
  );
  console.log("");

  console.log(chalk.cyan.bold("⚙️  Configuration"));
  const configSpinner = ora("Updating wrangler.jsonc...").start();
  let wranglerConfig = fs.readFileSync(WRANGLER_JSONC_PATH, "utf-8");
  let configChanged;

  // JSON.stringify escapes backslashes/quotes/control chars correctly; strip the quotes it adds.
  const escapeJson = (str) => JSON.stringify(String(str)).slice(1, -1);

  const routeRegex =
    /"routes"\s*:\s*\[[\s\S]*?\]|"workers_dev"\s*:\s*(true|false)/;
  wranglerConfig = wranglerConfig.replace(routeRegex, routesConfigStr);

  const appUrlRegex = /"APP_URL":\s*"[^"]+"/;
  wranglerConfig = wranglerConfig.replace(
    appUrlRegex,
    `"APP_URL": "${escapeJson(appUrl)}"`,
  );

  const callbackUrlRegex = /"AUTH_CALLBACK_URL":\s*"[^"]+"/;
  wranglerConfig = wranglerConfig.replace(
    callbackUrlRegex,
    `"AUTH_CALLBACK_URL": "${escapeJson(appUrl)}/auth/github/callback"`,
  );

  const botUsernameRegex = /"BOT_USERNAME":\s*"[^"]+"/;
  wranglerConfig = wranglerConfig.replace(
    botUsernameRegex,
    `"BOT_USERNAME": "${escapeJson(botUsername)}"`,
  );

  const githubAppSlugRegex = /"GITHUB_APP_SLUG":\s*"[^"]+"/;
  wranglerConfig = wranglerConfig.replace(
    githubAppSlugRegex,
    `"GITHUB_APP_SLUG": "${escapeJson(githubAppSlug)}"`,
  );

  const allowedUsersRegex = /"DASHBOARD_ALLOWED_USERS":\s*"[^"]+"/;
  wranglerConfig = wranglerConfig.replace(
    allowedUsersRegex,
    `"DASHBOARD_ALLOWED_USERS": "${escapeJson(allowedUsers)}"`,
  );

  configChanged = true;

  if (kvId && kvPreviewId) {
    wranglerConfig = wranglerConfig.replace(
      /"binding":\s*"APP_KV",\s*"id":\s*"[^"]+",\s*"preview_id":\s*"[^"]+"/,
      `"binding": "APP_KV",${os.EOL}      "id": "${kvId}",${os.EOL}      "preview_id": "${kvPreviewId}"`,
    );
    configChanged = true;
  }

  if (hyperdriveId) {
    wranglerConfig = wranglerConfig.replace(
      /"binding":\s*"HYPERDRIVE",\s*"id":\s*"[^"]+"/,
      `"binding": "HYPERDRIVE",${os.EOL}      "id": "${hyperdriveId}"`,
    );
    configChanged = true;
  }

  if (configChanged) {
    fs.writeFileSync(WRANGLER_JSONC_PATH, wranglerConfig, "utf-8");
    configSpinner.succeed("Updated wrangler.jsonc with new resource IDs.");
  } else {
    configSpinner.warn(
      "No IDs were successfully extracted. wrangler.jsonc was not modified.",
    );
  }
  console.log("");

  console.log(chalk.cyan.bold("🔐 Secrets"));
  const requiredSecrets = [
    "APP_PRIVATE_KEY",
    "GITHUB_APP_ID",
    "GITHUB_APP_WEBHOOK_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "LLM_CONFIG_ENCRYPTION_KEY",
    "CF_API_TOKEN",
    "CF_ACCOUNT_ID",
  ];

  const { confirmSecrets } = await prompts(
    {
      type: "confirm",
      name: "confirmSecrets",
      message:
        "Would you like to interactively configure the required Cloudflare secrets now?",
      initial: true,
    },
    {
      onCancel: () => {
        console.log(chalk.red("\n🛑 Setup aborted."));
        process.exit(1);
      },
    },
  );

  if (confirmSecrets) {
    console.log("");
    for (const secretName of requiredSecrets) {
      let initialVal = env[secretName] || "";

      const { secretValue } = await prompts(
        {
          type: "text",
          name: "secretValue",
          message: `Value for ${secretName}:`,
          initial: initialVal || undefined,
          style: secretName === "APP_PRIVATE_KEY" ? "default" : "password",
        },
        {
          onCancel: () => {
            console.log(chalk.red("\n🛑 Setup aborted."));
            process.exit(1);
          },
        },
      );

      if (secretValue) {
        const spinner = ora(`Setting secret ${secretName}...`).start();
        try {
          await setSecret(secretName, secretValue);
          spinner.succeed();
        } catch (e) {
          spinner.fail();
          console.error(
            chalk.red(`  ❌ Failed to set secret ${secretName}: ${e.message}`),
          );
        }
      } else {
        console.log(chalk.yellow(`  ⏭️ Skipped ${secretName}`));
      }
    }
  }

  console.log(
    chalk.green.bold("\n============================================="),
  );
  console.log(chalk.green.bold("🎉 Cloudflare Setup Successfully Completed!"));
  console.log(
    chalk.green.bold("=============================================\n"),
  );
  console.log(
    chalk.white("You are all set. Run ") +
      chalk.cyan("npm run deploy") +
      chalk.white(" to deploy Codra to Cloudflare.\n"),
  );
}

main().catch((error) => {
  console.error(chalk.red("\n❌ An unexpected error occurred:"));
  console.error(error);
  process.exit(1);
});
