export const CLR = {
    reset: '\x1b[0m',
    black: '\x1b[30m',
    green: '\x1b[32m',
    magenta: '\x1b[35m',
    bgGreen: '\x1b[42m',
    bgCyan: '\x1b[46m',
    bgYellow: '\x1b[43m',
    bgRed: '\x1b[41m',
    bgGray: '\x1b[100m',
    white: '\x1b[1;37m',
};
export const ERASE_LINE = '\x1b[2K';
export const BAR_WIDTH = 40;
export const fmtLabel = (tag, bg, msg) => `  ${CLR.black}${bg} ${tag} ${CLR.reset}  ${msg}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const drawBar = (filled, text) => {
    const columns = process.stdout.columns || 100;
    const label = ` | ${text}`;
    const barWidth = Math.min(BAR_WIDTH, Math.max(10, columns - label.length - 16));
    const normalizedFilled = Math.max(0, Math.min(barWidth, Math.round((filled / BAR_WIDTH) * barWidth)));
    const pct = Math.floor((Math.max(0, Math.min(BAR_WIDTH, filled)) / BAR_WIDTH) * 100);
    const useAscii = /^(1|true|yes)$/i.test(String(process.env.YORUMI_ASCII_PROGRESS || ''));
    const filledChar = useAscii ? '#' : '█';
    const emptyChar = useAscii ? '-' : '░';
    const bar = filledChar.repeat(normalizedFilled) + emptyChar.repeat(barWidth - normalizedFilled);
    process.stdout.write(`\r${ERASE_LINE}  [${bar}] ${CLR.green}${String(pct).padStart(3)}%${CLR.reset}${label}`);
};
export const msgAbove = (filled, barText, msg) => {
    process.stdout.write(`\r${ERASE_LINE}`);
    console.log(msg);
    drawBar(filled, barText);
};
export const animateBar = async (fromFilled, targetStep, totalSteps, text) => {
    const target = Math.floor(BAR_WIDTH * targetStep / totalSteps);
    let current = fromFilled;
    while (current < target) {
        current++;
        drawBar(current, text);
        await sleep(18);
    }
    return current;
};
