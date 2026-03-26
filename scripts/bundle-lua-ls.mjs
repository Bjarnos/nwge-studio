#!/usr/bin/env node

import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const resourcesDir = path.join(projectRoot, "src-tauri", "resources", "lua-language-server");
const defaultVersion = "3.17.1";

function fail(message) {
  console.error(`[bundle-lua-ls] ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`[bundle-lua-ls] ${message}`);
}

function releaseAsset(platform, arch, version) {
  if (platform === "win32") {
    if (arch === "x64" || arch === "arm64") {
      return {
        fileName: `lua-language-server-${version}-win32-${arch}.zip`,
        binaryName: "lua-language-server.exe",
        archiveType: "zip",
      };
    }
  }

  if (platform === "darwin") {
    if (arch === "x64" || arch === "arm64") {
      return {
        fileName: `lua-language-server-${version}-darwin-${arch}.tar.gz`,
        binaryName: "lua-language-server",
        archiveType: "tar.gz",
      };
    }
  }

  if (platform === "linux") {
    if (arch === "x64" || arch === "arm64") {
      return {
        fileName: `lua-language-server-${version}-linux-${arch}.tar.gz`,
        binaryName: "lua-language-server",
        archiveType: "tar.gz",
      };
    }
  }

  fail(`Unsupported LuaLS target: ${platform}/${arch}`);
}

function bundledBinaryPath(binaryName) {
  return path.join(resourcesDir, "bin", binaryName);
}

function hasUsableExistingBundle(binaryName) {
  const binaryPath = bundledBinaryPath(binaryName);
  const mainLuaPath = path.join(resourcesDir, "main.lua");
  const scriptDir = path.join(resourcesDir, "script");
  return existsSync(binaryPath) && existsSync(mainLuaPath) && existsSync(scriptDir);
}

function readBundleMarker() {
  const markerPath = path.join(resourcesDir, ".nwge-bundle.json");
  if (!existsSync(markerPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    return null;
  }
}

function execOrFail(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
  });

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": `nwge-studio-lua-ls-bundler/${defaultVersion} (${process.platform}; ${process.arch}; cpus=${cpus().length})`,
    },
  });

  if (!response.ok || !response.body) {
    fail(`Download failed: ${response.status} ${response.statusText}`);
  }

  await pipeline(response.body, createWriteStream(destinationPath));
}

async function main() {
  const version = process.env.LUALSE_VERSION || defaultVersion;
  const platform = process.platform;
  const arch = process.arch;
  const asset = releaseAsset(platform, arch, version);
  const releaseUrl =
    process.env.LUALSE_URL ||
    `https://github.com/LuaLS/lua-language-server/releases/download/${version}/${asset.fileName}`;
  const dryRun = process.argv.includes("--dry-run");
  const forceDownload = process.env.CI === "true" || process.env.NWGE_FORCE_LUA_LS_DOWNLOAD === "1";

  info(`target=${platform}/${arch} asset=${asset.fileName}`);
  info(`url=${releaseUrl}`);

  if (dryRun) {
    return;
  }

  const marker = readBundleMarker();
  if (
    !forceDownload &&
    marker?.version === version &&
    marker?.platform === platform &&
    marker?.arch === arch &&
    marker?.asset === asset.fileName &&
    hasUsableExistingBundle(asset.binaryName)
  ) {
    info(`existing ${platform} LuaLS bundle matches ${version}, skipping download`);
    return;
  }

  if (!forceDownload && hasUsableExistingBundle(asset.binaryName)) {
    info(`existing ${platform} LuaLS bundle detected, skipping download`);
    return;
  }

  const tempDir = path.join(projectRoot, "src-tauri", "target", "lua-ls-download");
  mkdirSync(tempDir, { recursive: true });
  const archivePath = path.join(tempDir, asset.fileName);

  rmSync(resourcesDir, { recursive: true, force: true });
  mkdirSync(resourcesDir, { recursive: true });

  info("downloading release archive");
  await downloadFile(releaseUrl, archivePath);

  info("extracting release archive");
  if (asset.archiveType === "tar.gz") {
    execOrFail("tar", ["-xzf", archivePath, "-C", resourcesDir]);
  } else if (asset.archiveType === "zip") {
    if (platform !== "win32") {
      fail("ZIP extraction is only configured for Windows builds.");
    }
    execOrFail("powershell", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${resourcesDir.replace(/'/g, "''")}' -Force`,
    ]);
  }

  if (platform !== "win32") {
    execOrFail("chmod", ["+x", bundledBinaryPath(asset.binaryName)]);
  } else if (!existsSync(bundledBinaryPath(asset.binaryName))) {
    fail(`Expected Windows LuaLS binary was not extracted to ${bundledBinaryPath(asset.binaryName)}`);
  }

  const markerPath = path.join(resourcesDir, ".nwge-bundle.json");
  writeFileSync(
    markerPath,
    JSON.stringify(
      {
        version,
        platform,
        arch,
        asset: asset.fileName,
      },
      null,
      2,
    ) + "\n",
  );

  const size = statSync(bundledBinaryPath(asset.binaryName)).size;
  info(`bundled ${asset.binaryName} (${size} bytes)`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack || error.message : String(error));
});
