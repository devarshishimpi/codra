import util from "node:util";
import { exec } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import prompts from "prompts";
import { extractId, spawnAsync, WORKER_DIR } from "./setup-helpers.js";

const execAsync = util.promisify(exec);

// Idempotent provisioning: reuse the binding already in wrangler.jsonc if it resolves,
// otherwise create it and write the id back.

export async function handleKVNamespace(baseBinding, isPreview) {
  let currentBinding = baseBinding;

  while (true) {
    const spinner = ora(
      `Creating ${isPreview ? "preview" : "production"} KV namespace (${currentBinding})...`,
    ).start();
    try {
      const args = ["wrangler", "kv", "namespace", "create", currentBinding];
      if (isPreview) args.push("--preview");
      const { stdout } = await spawnAsync("npx", args);
      spinner.succeed();
      return extractId(stdout);
    } catch (error) {
      const errorMsg = error.stderr || error.message;
      if (errorMsg.includes("already exists")) {
        spinner.warn(
          `${isPreview ? "Preview" : "Production"} KV namespace for "${currentBinding}" already exists.`,
        );

        const { action } = await prompts(
          {
            type: "select",
            name: "action",
            message: `How would you like to handle this existing namespace?`,
            choices: [
              { title: "Auto-fetch existing ID", value: "fetch" },
              { title: "Manually enter ID", value: "manual" },
              { title: "Create new with different name", value: "new" },
              { title: "Skip", value: "skip" },
            ],
          },
          { onCancel: () => process.exit(1) },
        );

        if (action === "fetch") {
          const fetchSpinner = ora(
            "Fetching existing KV namespaces...",
          ).start();
          try {
            const { stdout: listOut } = await execAsync(
              "npx wrangler kv namespace list",
              { cwd: WORKER_DIR },
            );
            fetchSpinner.succeed();

            let searchTitle = isPreview
              ? `${baseBinding}_preview`
              : baseBinding;
            let parsed = null;
            try {
              const jsonStr = listOut.substring(
                listOut.indexOf("["),
                listOut.lastIndexOf("]") + 1,
              );
              parsed = JSON.parse(jsonStr);
            } catch {
              /* not JSON: fall through to the non-parsed path below */
            }

            if (parsed && Array.isArray(parsed)) {
              const found = parsed.find((ns) => ns.title.includes(searchTitle));
              if (found) {
                console.log(chalk.green(`  ✅ Found existing ID: ${found.id}`));
                return found.id;
              }
            }

            console.log(
              chalk.yellow(
                `  ⚠️ Could not automatically find an ID matching ${searchTitle}.`,
              ),
            );
            const { manualId } = await prompts(
              {
                type: "text",
                name: "manualId",
                message: "Enter the KV Namespace ID manually:",
              },
              { onCancel: () => process.exit(1) },
            );
            if (manualId) return manualId;
            return null;
          } catch (e) {
            fetchSpinner.fail("Failed to fetch KV namespaces.");
            const { manualId } = await prompts(
              {
                type: "text",
                name: "manualId",
                message: "Enter the KV Namespace ID manually:",
              },
              { onCancel: () => process.exit(1) },
            );
            if (manualId) return manualId;
            return null;
          }
        } else if (action === "manual") {
          const { manualId } = await prompts(
            {
              type: "text",
              name: "manualId",
              message: "Enter the KV Namespace ID:",
            },
            { onCancel: () => process.exit(1) },
          );
          if (manualId) return manualId;
          return null;
        } else if (action === "new") {
          const { newName } = await prompts(
            {
              type: "text",
              name: "newName",
              message: "Enter a new binding name (e.g. APP_KV_2):",
              initial: `${currentBinding}_2`,
            },
            { onCancel: () => process.exit(1) },
          );
          if (newName) {
            currentBinding = newName;
            continue;
          }
          return null;
        } else {
          return null;
        }
      } else {
        spinner.fail();
        console.error(chalk.red(`\n❌ Error executing KV creation.`));
        console.error(chalk.red(errorMsg));
        if (
          errorMsg.includes("[code: 10000]") ||
          errorMsg.includes("Authentication error")
        ) {
          console.log(
            chalk.yellow(
              "\n💡 Hint: Alternatively, run `npx wrangler login` to use your global Cloudflare session instead.",
            ),
          );
        }
        process.exit(1);
      }
    }
  }
}

export async function handleHyperdrive(dbUrl) {
  let currentBinding = "codra-db";

  while (true) {
    const spinner = ora(`Creating Hyperdrive (${currentBinding})...`).start();
    try {
      const { stdout } = await spawnAsync("npx", [
        "wrangler",
        "hyperdrive",
        "create",
        currentBinding,
        `--connection-string=${dbUrl}`,
      ]);
      spinner.succeed();
      return extractId(stdout);
    } catch (error) {
      const errorMsg = error.stderr || error.message;
      if (
        errorMsg.includes("already exists") ||
        errorMsg.includes("code: 2017")
      ) {
        spinner.warn(`Hyperdrive config "${currentBinding}" already exists.`);

        const { action } = await prompts(
          {
            type: "select",
            name: "action",
            message: `How would you like to handle this existing Hyperdrive?`,
            choices: [
              { title: "Auto-fetch existing ID", value: "fetch" },
              { title: "Manually enter ID", value: "manual" },
              { title: "Create new with different name", value: "new" },
              { title: "Skip", value: "skip" },
            ],
          },
          { onCancel: () => process.exit(1) },
        );

        if (action === "fetch") {
          const fetchSpinner = ora(
            "Fetching existing Hyperdrive configs...",
          ).start();
          try {
            const { stdout: listOut } = await execAsync(
              "npx wrangler hyperdrive list",
              { cwd: WORKER_DIR },
            );
            fetchSpinner.succeed();

            let parsed = null;
            try {
              const jsonStr = listOut.substring(
                listOut.indexOf("["),
                listOut.lastIndexOf("]") + 1,
              );
              parsed = JSON.parse(jsonStr);
            } catch {
              /* not JSON: fall through to the non-parsed path below */
            }

            if (parsed && Array.isArray(parsed)) {
              const found = parsed.find((hd) => hd.name === currentBinding);
              if (found) {
                console.log(chalk.green(`  ✅ Found existing ID: ${found.id}`));
                return found.id;
              }
            } else {
              const lines = listOut.split("\n");
              for (const line of lines) {
                if (line.includes(currentBinding)) {
                  const match = line.match(/[a-f0-9]{32}/);
                  if (match) {
                    console.log(
                      chalk.green(`  ✅ Found existing ID: ${match[0]}`),
                    );
                    return match[0];
                  }
                }
              }
            }

            console.log(
              chalk.yellow(
                `  ⚠️ Could not automatically find an ID matching ${currentBinding}.`,
              ),
            );
            const { manualId } = await prompts(
              {
                type: "text",
                name: "manualId",
                message: "Enter the Hyperdrive ID manually:",
              },
              { onCancel: () => process.exit(1) },
            );
            if (manualId) return manualId;
            return null;
          } catch (e) {
            fetchSpinner.fail("Failed to fetch Hyperdrive configs.");
            const { manualId } = await prompts(
              {
                type: "text",
                name: "manualId",
                message: "Enter the Hyperdrive ID manually:",
              },
              { onCancel: () => process.exit(1) },
            );
            if (manualId) return manualId;
            return null;
          }
        } else if (action === "manual") {
          const { manualId } = await prompts(
            {
              type: "text",
              name: "manualId",
              message: "Enter the Hyperdrive ID:",
            },
            { onCancel: () => process.exit(1) },
          );
          if (manualId) return manualId;
          return null;
        } else if (action === "new") {
          const { newName } = await prompts(
            {
              type: "text",
              name: "newName",
              message: "Enter a new Hyperdrive name (e.g. codra-db-2):",
              initial: `${currentBinding}-2`,
            },
            { onCancel: () => process.exit(1) },
          );
          if (newName) {
            currentBinding = newName;
            continue;
          }
          return null;
        } else {
          return null;
        }
      } else {
        spinner.fail();
        console.error(chalk.red(`\n❌ Error executing Hyperdrive creation.`));
        console.error(chalk.red(errorMsg));
        process.exit(1);
      }
    }
  }
}
