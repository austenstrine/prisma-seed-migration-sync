#!/usr/bin/env node

import { resolve } from 'path';
import { formatSyncSummary, syncSeedData } from './sync';
import { validateSeedData } from './validate';

function hasFlag(name: string): boolean {
	return process.argv.includes(name);
}

function arg(name: string, fallback: string): string {
	const index = process.argv.indexOf(name);
	if(index >= 0 && process.argv[index + 1]) {
		return process.argv[index + 1];
	}
	return fallback;
}

async function main(): Promise<void> {
	const command = process.argv[2];
	const seedDir = resolve(arg('--dir', 'prisma/seed-data'));

	if(command === 'sync') {
		const result = syncSeedData({
			seedDir,
			dryRun: hasFlag('--dry-run') || hasFlag('-n'),
		});
		console.log(formatSyncSummary(result));
		return;
	}

	if(command === 'validate') {
		const result = validateSeedData(seedDir);
		if(!result.ok) {
			for(const issue of result.issues) {
				console.error(`${issue.file}: ${issue.message}`);
			}
			process.exit(1);
		}
		console.log('Seed data is synced with Prisma migrations.');
		return;
	}

	console.error(
		'Usage: prisma-seed-migration-sync <sync|validate> [--dir prisma/seed-data] [--dry-run]',
	);
	process.exit(1);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
