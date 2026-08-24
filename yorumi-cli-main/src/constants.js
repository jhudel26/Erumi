import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const COLORS = {
    reset: '\\x1b[0m',
    bright: '\\x1b[1m',
    dim: '\\x1b[2m',
    cyan: '\\x1b[36m',
    blue: '\\x1b[34m',
    yellow: '\\x1b[33m',
    green: '\\x1b[32m',
    red: '\\x1b[31m',
};
