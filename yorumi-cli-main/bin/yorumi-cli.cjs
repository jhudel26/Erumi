#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

const root = resolve(dirname(fileURLToPath(pathToFileURL(__filename))), '..');
const tsxCli = resolve(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const entry = resolve(root, 'src', 'index.ts');

if (!existsSync(tsxCli)) {
  console.error('Yorumi CLI could not find its runtime dependency:');
  console.error(`  ${tsxCli}`);
  console.error('');
  console.error('Re-run the installer so it can install CLI dependencies:');
  console.error('  iwr -useb https://raw.githubusercontent.com/davenarchives/yorumi-cli/main/install.ps1 | iex');
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
