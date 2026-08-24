import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { platform } from 'node:os';
import { resolve, join } from 'node:path';
import { ask, resolveNpmCommand, commandExists } from './utils.js';
import { CLR, ERASE_LINE, fmtLabel, drawBar, animateBar, msgAbove } from './cliUtils.js';

export const getInstallRoot = () => {
  if (platform() === 'win32') {
    return join(process.env.LOCALAPPDATA || process.env.USERPROFILE || '', 'YorumiCLI');
  }

  return join(process.env.XDG_DATA_HOME || join(process.env.HOME || '', '.local', 'share'), 'YorumiCLI');
};

const binPathFromInstallRoot = () => join(resolve(getInstallRoot()), 'bin');

const getWindowsCommandShimPaths = () => {
  if (platform() !== 'win32') return [];

  const npmBin = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '';
  return [
    join(binPathFromInstallRoot(), 'yorumi-cli.cmd'),
    npmBin ? join(npmBin, 'yorumi-cli') : '',
    npmBin ? join(npmBin, 'yorumi-cli.cmd') : '',
    npmBin ? join(npmBin, 'yorumi-cli.ps1') : '',
    npmBin ? join(npmBin, 'node_modules', 'yorumi-cli') : '',
  ].filter(Boolean);
};

const removeKnownCommandShims = () => {
  for (const target of getWindowsCommandShimPaths()) {
    if (!existsSync(target)) continue;

    const stats = lstatSync(target);
    rmSync(target, { recursive: stats.isDirectory() && !stats.isSymbolicLink(), force: true });
  }
};

const removePathLater = (targetPath: string, binPath: string) => {
  if (platform() === 'win32') {
    const quotedPath = `'${targetPath.replace(/'/g, "''")}'`;
    const quotedBinPath = `'${binPath.replace(/'/g, "''")}'`;
    const script = `
Start-Sleep -Milliseconds 800
$target = ${quotedPath}
$binPath = ${quotedBinPath}
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath) {
  $normalizedBin = [System.IO.Path]::GetFullPath($binPath).TrimEnd('\\', '/')
  $nextPath = ($userPath -split ';' | Where-Object {
    if (-not $_.Trim()) { return $false }
    try {
      $entry = [Environment]::ExpandEnvironmentVariables($_.Trim().Trim('"'))
      [System.IO.Path]::GetFullPath($entry).TrimEnd('\\', '/') -ne $normalizedBin
    } catch {
      $true
    }
  }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $nextPath, 'User')
}
Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
`;
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }

  const child = spawn('sh', ['-c', 'sleep 0.8; rm -rf -- "$1"', 'sh', targetPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
};

export const uninstallYorumiCli = async (yes: boolean) => {
  const installRoot = resolve(getInstallRoot());
  const binPath = join(installRoot, 'bin');
  const totalSteps = 3;
  let step = 0;
  let filled = 0;

  console.log(`\n  ${CLR.magenta}yorumi-cli uninstall${CLR.reset}\n`);

  if (!installRoot.endsWith('YorumiCLI')) {
    throw new Error(`Refusing to uninstall unexpected path: ${installRoot}`);
  }

  if (!existsSync(installRoot)) {
    console.log(fmtLabel('warning', CLR.bgYellow, `Yorumi CLI is not installed at ${installRoot}`));
    return;
  }

  if (!yes) {
    const answer = (await ask(`Remove Yorumi CLI from ${installRoot}? Type "yes" to continue: `)).toLowerCase();
    if (answer !== 'yes') {
      console.log(fmtLabel('warning', CLR.bgYellow, 'Uninstall cancelled.'));
      return;
    }
  }

  drawBar(filled, 'Checking installation...');
  step++;
  filled = await animateBar(filled, step, totalSteps, 'Checking installation');
  msgAbove(filled, 'Checking installation', fmtLabel('success', CLR.bgGreen, 'Yorumi CLI installation found'));

  drawBar(filled, 'Starting cleanup helper...');
  removeKnownCommandShims();
  removePathLater(installRoot, binPath);
  step++;
  filled = await animateBar(filled, step, totalSteps, 'Starting cleanup helper');
  msgAbove(filled, 'Starting cleanup helper', fmtLabel('success', CLR.bgGreen, 'Cleanup helper started'));

  step++;
  filled = await animateBar(filled, step, totalSteps, 'Complete');
  process.stdout.write(`\r${ERASE_LINE}`);
  console.log('');
  console.log(fmtLabel('success', CLR.bgGreen, 'Uninstall complete!'));
  console.log(fmtLabel('note', CLR.bgGray, 'Close and reopen your terminal to refresh PATH.'));
  console.log('');
};

export const updateYorumiCli = async () => {
  const installRoot = getInstallRoot();
  const repoDir = join(installRoot, 'repo');

  const totalSteps = 3;
  let step = 0;
  let filled = 0;

  console.log(`\n  ${CLR.magenta}yorumi-cli update${CLR.reset}\n`);

  if (!existsSync(repoDir)) {
    console.log(fmtLabel('error', CLR.bgRed, 'YorumiCLI installation not found at ' + installRoot));
    console.log(fmtLabel('note', CLR.bgGray, 'Please rerun the installer to install the latest version.'));
    return;
  }

  if (!existsSync(join(repoDir, '.git')) || !(await commandExists('git'))) {
    console.log(fmtLabel('warning', CLR.bgYellow, 'This install cannot update with git pull.'));
    console.log(fmtLabel('note', CLR.bgGray, 'Rerun the installer to download the latest version.'));
    return;
  }

  // Step: Pull CLI repo
  drawBar(filled, 'Pulling CLI repository...');
  const repoPull = spawnSync('git', ['pull', '--ff-only'], { cwd: repoDir, encoding: 'utf8', stdio: 'pipe' });
  step++;
  filled = await animateBar(filled, step, totalSteps, 'Pulling CLI repository');
  if (repoPull.error || repoPull.status !== 0) {
    msgAbove(filled, 'Pulling CLI repository', fmtLabel('error', CLR.bgRed, 'Failed to update Yorumi CLI repo.'));
  } else {
    const out = String(repoPull.stdout || '').trim();
    const msg = out.includes('Already up to date') ? 'Yorumi CLI is already up-to-date' : 'CLI repo updated';
    msgAbove(filled, 'Pulling CLI repository', fmtLabel('success', CLR.bgGreen, msg));
  }

  // Step: Install CLI deps
  drawBar(filled, 'Installing CLI dependencies...');
  const npmCommand = await resolveNpmCommand();
  if (!npmCommand) {
    msgAbove(filled, 'Installing CLI dependencies', fmtLabel('error', CLR.bgRed, 'npm was not found.'));
    return;
  }

  spawnSync(npmCommand, ['install', '--loglevel=error'], { cwd: repoDir, stdio: 'pipe' });
  step++;
  filled = await animateBar(filled, step, totalSteps, 'Installing CLI dependencies');
  msgAbove(filled, 'Installing CLI dependencies', fmtLabel('success', CLR.bgGreen, 'CLI dependencies installed'));

  // Done
  step++;
  filled = await animateBar(filled, step, totalSteps, 'Complete');
  process.stdout.write(`\r${ERASE_LINE}`);
  console.log('');
  console.log(fmtLabel('success', CLR.bgGreen, 'Update complete!'));
  console.log('');
};
