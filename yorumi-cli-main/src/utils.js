import { spawn, spawnSync } from 'node:child_process';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
const rl = createInterface({ input, output });
export const ask = async (question) => (await rl.question(question)).trim();
export const commandExists = (command) => new Promise((resolve) => {
    const checker = platform() === 'win32' ? 'where' : 'which';
    const child = spawn(checker, [command], { stdio: 'ignore', shell: false });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
});
export const tryExternalMenu = async (title, items, render) => {
    const labels = items.map((item, index) => `${index + 1}. ${render(item, index)}`);
    if (await commandExists('fzf')) {
        const result = spawnSync('fzf', ['--prompt', `${title}> `, '--height', '40%', '--border', '--layout=default'], {
            input: labels.join('\n'),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'inherit'],
        });
        const selected = String(result.stdout || '').trim();
        const index = Number(selected.match(/^(\d+)\./)?.[1]) - 1;
        return Number.isInteger(index) && index >= 0 && index < items.length ? items[index] : null;
    }
    if (await commandExists('rofi')) {
        const result = spawnSync('rofi', ['-dmenu', '-i', '-p', title], {
            input: labels.join('\n'),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'inherit'],
        });
        const selected = String(result.stdout || '').trim();
        const index = Number(selected.match(/^(\d+)\./)?.[1]) - 1;
        return Number.isInteger(index) && index >= 0 && index < items.length ? items[index] : null;
    }
    return null;
};
export const chooseFromList = async (title, items, render) => {
    if (items.length === 0)
        throw new Error(`No ${title.toLowerCase()} found.`);
    const externalPick = await tryExternalMenu(title, items, render);
    if (externalPick)
        return externalPick;
    console.log(`\n=== Select ${title} ===`);
    items.forEach((item, i) => {
        console.log(`${i + 1}. ${render(item, i)}`);
    });
    while (true) {
        const answer = await ask(`Select an option (1-${items.length}): `);
        const index = parseInt(answer, 10) - 1;
        if (!isNaN(index) && index >= 0 && index < items.length) {
            return items[index];
        }
        console.log('Invalid selection.');
    }
};
export const selectEpisode = async (episodes, requested) => {
    const sorted = [...episodes].sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber));
    if (requested) {
        const match = sorted.find((episode) => Number(episode.episodeNumber) === requested);
        if (match)
            return match;
        console.log(`Episode ${requested} was not found. Showing episode picker instead.`);
    }
    return chooseFromList('Episode', sorted, (episode) => {
        const title = String(episode.title || '').trim();
        return title && !/^episode\s+\d+(?:\.\d+)?$/i.test(title)
            ? `Episode ${episode.episodeNumber} - ${title}`
            : `Episode ${episode.episodeNumber}`;
    });
};
export const parseEpisodeRange = (range, episodes) => {
    const match = String(range || '').trim().match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (!match)
        throw new Error('Invalid range. Use a format like 1-5.');
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) {
        throw new Error('Invalid range. Start must be lower than or equal to end.');
    }
    const selected = [...episodes]
        .sort((a, b) => Number(a.episodeNumber) - Number(b.episodeNumber))
        .filter((episode) => {
        const number = Number(episode.episodeNumber);
        return Number.isFinite(number) && number >= start && number <= end;
    });
    if (selected.length === 0)
        throw new Error(`No episodes found in range ${range}.`);
    return selected;
};
export const sanitizeFilePart = (value) => String(value || 'anime')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'anime';
export const resolveFfmpegCommand = async () => {
    if (await commandExists('ffmpeg'))
        return 'ffmpeg';
    if (platform() !== 'win32')
        return null;
    const candidates = [
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
    ];
    return candidates.find((candidate) => existsSync(candidate)) || null;
};
export const installFfmpegWithWinget = async (yes) => {
    if (platform() !== 'win32' || !(await commandExists('winget')))
        return false;
    if (!yes) {
        const answer = (await ask('ffmpeg is required for downloads. Install it with winget now? [y/N] ')).toLowerCase();
        if (answer !== 'y' && answer !== 'yes')
            return false;
    }
    console.log('Installing ffmpeg with winget...');
    const result = spawnSync('winget', [
        'install',
        '--id',
        'Gyan.FFmpeg',
        '-e',
        '--accept-package-agreements',
        '--accept-source-agreements',
    ], { stdio: 'inherit' });
    return result.status === 0;
};
export const requireFfmpegCommand = async (yes) => {
    const existing = await resolveFfmpegCommand();
    if (existing)
        return existing;
    const installed = await installFfmpegWithWinget(yes);
    if (installed) {
        const afterInstall = await resolveFfmpegCommand();
        if (afterInstall)
            return afterInstall;
        throw new Error('ffmpeg was installed, but your terminal PATH has not refreshed. Reopen PowerShell and run the download again.');
    }
    throw new Error('ffmpeg was not found. Install it with: winget install --id Gyan.FFmpeg -e');
};
export const getFfmpegHlsExtensionArgs = (ffmpeg) => {
    const help = spawnSync(ffmpeg, ['-hide_banner', '-h', 'demuxer=hls'], {
        encoding: 'utf8',
        stdio: 'pipe',
    });
    const output = `${help.stdout || ''}\n${help.stderr || ''}`;
    if (output.includes('allowed_segment_extensions')) {
        return ['-allowed_segment_extensions', 'ALL', '-extension_picky', '0'];
    }
    return ['-allowed_extensions', 'ALL', '-extension_picky', '0'];
};
export const probeHlsDurationMs = async (url, referer) => {
    try {
        const response = await fetch(url, {
            headers: {
                Referer: referer,
                'User-Agent': 'Mozilla/5.0',
            },
            signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok)
            return 0;
        const playlist = await response.text();
        const seconds = [...playlist.matchAll(/^#EXTINF:([\d.]+)/gim)]
            .reduce((sum, match) => sum + Number(match[1] || 0), 0);
        return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
    }
    catch {
        return 0;
    }
};
export const probeDurationMs = async (ffmpeg, url, referer, hlsExtensionArgs) => {
    if (/\.m3u8(?:[?#]|$)/i.test(url)) {
        const hlsDuration = await probeHlsDurationMs(url, referer);
        if (hlsDuration > 0)
            return hlsDuration;
    }
    const result = spawnSync(ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'info',
        ...hlsExtensionArgs,
        '-headers',
        `Referer: ${referer}\r\nUser-Agent: Mozilla/5.0\r\n`,
        '-i',
        url,
        '-f',
        'null',
        '-',
    ], {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 15_000,
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (!match)
        return 0;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    return Math.round(((hours * 60 * 60) + (minutes * 60) + seconds) * 1000);
};
export const formatClock = (ms) => {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${minutes}:${String(seconds).padStart(2, '0')}`;
};
export const resolveNpmCommand = async () => {
    if (platform() === 'win32') {
        const bundledNpm = join(dirname(process.execPath), 'npm.cmd');
        if (existsSync(bundledNpm))
            return bundledNpm;
    }
    return await commandExists('npm') ? 'npm' : null;
};
export const normalizeAudio = (value) => {
    const lower = String(value || '').toLowerCase();
    if (/(dub|eng|english)/.test(lower))
        return 'dub';
    return 'sub';
};
export const scoreStream = (stream) => {
    const quality = Number(String(stream.quality || '').replace(/[^\d]/g, '')) || 0;
    const subScore = normalizeAudio(stream.audio) === 'sub' ? 10_000 : 0;
    const directScore = stream.directUrl ? 1_000 : 0;
    return subScore + directScore + quality;
};
