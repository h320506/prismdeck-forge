import { cp, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(root, "..");
const dist = path.join(projectRoot, "dist");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(command + " exited with code " + code)));
  });
}

await run(path.join(projectRoot, "node_modules", ".bin", "esbuild"), [
  "app.js", "--bundle", "--minify", "--format=esm", "--target=es2020", "--outfile=app.bundle.js"
]);
await run(path.join(projectRoot, "node_modules", ".bin", "esbuild"), [
  "site.js", "--bundle", "--minify", "--format=esm", "--target=es2020", "--outfile=site.bundle.js"
]);

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of [
  "index.html", "style.css", "workshop.css", "app.bundle.js", "site.bundle.js",
  "card-config.json", "_headers", "_redirects"
]) {
  await cp(path.join(projectRoot, file), path.join(dist, file));
}
await cp(path.join(projectRoot, "assets"), path.join(dist, "assets"), { recursive: true });
console.log("Static site assembled in " + dist);
