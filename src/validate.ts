import { resolve } from 'path';
import { listMigrationNames, listSeedFiles, readConfig } from './files';
import type { ValidateResult } from './types';

export function validateSeedData(seedDir: string): ValidateResult {
	const config = readConfig(seedDir);
	const migrationsPath = resolve(seedDir, config.migrations);
	const allMigrations = listMigrationNames(migrationsPath);
	const applied = new Set(config.appliedMigrations);
	const pendingMigrations = allMigrations.filter((name) => !applied.has(name));
	const issues: ValidateResult['issues'] = [];

	if(config.appliedMigrations.length === 0 && allMigrations.length > 0) {
		issues.push({
			file: 'seed-sync.config.json',
			message: 'No migrations have been synced yet. Run `sync` to baseline or replay them.',
		});
	}

	for(const name of pendingMigrations) {
		issues.push({
			file: 'seed-sync.config.json',
			message: `Pending migration ${name} has not been applied to seed data.`,
		});
	}

	for(const listed of listSeedFiles(seedDir, config)) {
		if(!listed.maintain) {
			continue;
		}
		if(!listed.file.$prismaJsonSeed.model) {
			issues.push({
				file: listed.filename,
				message: 'Missing $prismaJsonSeed.model.',
			});
		}
		if(!Array.isArray(listed.file.records)) {
			issues.push({
				file: listed.filename,
				message: 'Missing records[].',
			});
		}
	}

	return {
		ok: issues.length === 0,
		issues,
		pendingMigrations,
	};
}
