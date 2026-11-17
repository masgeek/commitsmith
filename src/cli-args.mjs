import { fileConfig } from './config.mjs';

export const args = process.argv.slice(2);
export const initMode = args[0] === 'init';
export const shouldCommit = args.includes('--commit') || args.includes('-y');
export const autoYes = args.includes('-y');
export const splitMode = args.includes('--split');
export const splitHunksMode = args.includes('--split-hunks');
export const groupMode = args.includes('--group');
export const dryRun = args.includes('--dry-run');
export const checkMode = args.includes('--check');
export const noGroupDetection = args.includes('--no-group-detection');
export const breakingDetectionEnabled = !args.includes('--no-breaking-detection') && fileConfig.breakingDetection !== false;
export const helpRequested = args.includes('--help') || args.includes('-h');
