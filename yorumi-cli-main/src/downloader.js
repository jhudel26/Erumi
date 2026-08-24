import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getStreamReferer } from './player.js';
import { requireFfmpegCommand, getFfmpegHlsExtensionArgs, probeDurationMs, formatClock, sanitizeFilePart } from './utils.js';
import { CLR, ERASE_LINE, fmtLabel, drawBar } from './cliUtils.js';
const BAR_WIDTH = 40;
export const downloadEpisode = async (url, outputPath, referer, overwrite, label, copyAudio) => {
    const ffmpeg = await requireFfmpegCommand(overwrite);
    const isHls = /\.m3u8(?:[?#]|$)/i.test(url);
    const hlsExtensionArgs = isHls ? getFfmpegHlsExtensionArgs(ffmpeg) : [];
    const durationMs = await probeDurationMs(ffmpeg, url, referer, hlsExtensionArgs);
    if (existsSync(outputPath) && !overwrite) {
        throw new Error(`Output already exists: ${outputPath}. Re-run with --yes to overwrite.`);
    }
    const args = [
        overwrite ? '-y' : '-n',
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostats',
        '-progress',
        'pipe:1',
        ...hlsExtensionArgs,
        '-headers',
        `Referer: ${referer}\r\nUser-Agent: Mozilla/5.0\r\n`,
        '-i',
        url,
        '-c:v',
        'copy',
        '-c:a',
        copyAudio ? 'copy' : 'aac',
        ...(copyAudio ? ['-bsf:a', 'aac_adtstoasc'] : ['-b:a', '192k', '-ac', '2']),
        '-movflags',
        '+faststart',
        outputPath,
    ];
    await new Promise((resolveDownload, reject) => {
        let lastPercent = 0;
        let lastOutTimeMs = 0;
        let lastRenderAt = 0;
        let lastRenderedText = '';
        let progressBuffer = '';
        const startedAt = Date.now();
        const renderProgress = (percent, outTimeMs, force = false) => {
            lastOutTimeMs = Math.max(lastOutTimeMs, outTimeMs);
            const elapsed = formatClock(Date.now() - startedAt);
            const mediaTime = lastOutTimeMs > 0 ? ` | media ${formatClock(lastOutTimeMs)}` : '';
            const now = Date.now();
            if (durationMs > 0) {
                lastPercent = Math.max(lastPercent, Math.min(100, Math.floor(percent)));
                const filled = Math.min(BAR_WIDTH, Math.floor((lastPercent / 100) * BAR_WIDTH));
                const text = `${label} ${lastPercent}% | elapsed ${elapsed}${mediaTime}`;
                if (!force && text === lastRenderedText && now - lastRenderAt < 500)
                    return;
                lastRenderedText = text;
                lastRenderAt = now;
                drawBar(filled, text);
                return;
            }
            const pulse = Math.floor(((Date.now() - startedAt) / 250) % BAR_WIDTH) + 1;
            const text = `${label} downloading | elapsed ${elapsed}${mediaTime}`;
            if (!force && text === lastRenderedText && now - lastRenderAt < 500)
                return;
            lastRenderedText = text;
            lastRenderAt = now;
            drawBar(pulse, text);
        };
        const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        const progressTimer = setInterval(() => {
            if (durationMs > 0) {
                renderProgress((lastOutTimeMs / durationMs) * 100, lastOutTimeMs);
                return;
            }
            const elapsedMs = Date.now() - startedAt;
            const syntheticPercent = Math.min(99, Math.floor(elapsedMs / 1000) % 100);
            renderProgress(Math.max(lastPercent, syntheticPercent), lastOutTimeMs);
        }, 250);
        renderProgress(0, 0, true);
        child.stdout?.on('data', (chunk) => {
            progressBuffer += chunk.toString();
            const lines = progressBuffer.split(/\r?\n/);
            progressBuffer = lines.pop() || '';
            for (const line of lines) {
                const [key, rawValue] = line.split('=');
                if (key !== 'out_time_ms' && key !== 'out_time_us')
                    continue;
                const value = Number(rawValue);
                if (!Number.isFinite(value))
                    continue;
                const outTimeMs = value / 1000;
                const percent = durationMs > 0 ? (outTimeMs / durationMs) * 100 : lastPercent;
                renderProgress(percent, outTimeMs);
            }
        });
        let errorOutput = '';
        child.stderr?.on('data', (chunk) => {
            errorOutput += chunk.toString();
        });
        child.once('error', reject);
        child.once('exit', (code) => {
            clearInterval(progressTimer);
            if (code === 0) {
                drawBar(BAR_WIDTH, `${label} 100% | saved`);
                process.stdout.write(`\r${ERASE_LINE}`);
                console.log(fmtLabel('success', CLR.bgGreen, `${label} saved`));
                resolveDownload();
                return;
            }
            process.stdout.write(`\r${ERASE_LINE}`);
            if (errorOutput.trim())
                console.error(errorOutput.trim());
            const signedCode = typeof code === 'number' && code > 0x7fffffff ? code - 0x100000000 : code;
            reject(new Error(`ffmpeg exited with code ${signedCode ?? code}.`));
        });
    });
};
export const downloadEpisodes = async (anime, episodes, resolved, outputDir, overwrite, copyAudio) => {
    const targetDir = resolve(outputDir);
    mkdirSync(targetDir, { recursive: true });
    for (let index = 0; index < resolved.length; index += 1) {
        const episode = episodes[index];
        const playable = resolved[index];
        const referer = getStreamReferer(playable.stream);
        const fileName = `${sanitizeFilePart(anime.title)} - E${String(episode.episodeNumber).padStart(2, '0')}.mp4`;
        const outputPath = join(targetDir, fileName);
        console.log(`Downloading episode ${episode.episodeNumber} to ${outputPath}`);
        await downloadEpisode(playable.url, outputPath, referer, overwrite, `Episode ${episode.episodeNumber}`, copyAudio);
    }
    console.log('Download complete.');
};
