import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import type { SeedFile, SeedSyncConfig } from './types';

export const CONFIG_FILE = 'seed-sync.config.json';
export const LEGACY_META_FILE = '_meta.json';

const DEFAULT_OMIT = ['id', 'createdAt', 'updatedAt'];
const DEFAULT_PLACEHOLDER = '__SEED_TODO__';

export type ListedSeedFile = {
	filename: string;
	path: string;
	file: SeedFile;
	maintain: boolean;
	skipReason?: string;
};

export function readConfig(seedDir: string): SeedSyncConfig {
	const configPath = join(seedDir, CONFIG_FILE);
	const legacyPath = join(seedDir, LEGACY_META_FILE);
	const configRaw = existsSync(configPath)
		? JSON.parse(readFileSync(configPath, 'utf8')) as Partial<SeedSyncConfig>
		: {};
	const legacyRaw = existsSync(legacyPath)
		? JSON.parse(readFileSync(legacyPath, 'utf8')) as Partial<SeedSyncConfig>
		: {};
	const raw = { ...legacyRaw, ...configRaw };

	return {
		pack: raw.pack ?? 'default',
		schema: raw.schema ?? '../schema.prisma',
		migrations: raw.migrations ?? '../migrations',
		omitFields: raw.omitFields ?? DEFAULT_OMIT,
		placeholder: raw.placeholder ?? DEFAULT_PLACEHOLDER,
		skipFiles: raw.skipFiles ?? [],
		appliedMigrations: raw.appliedMigrations ?? legacyRaw.appliedMigrations ?? [],
	};
}

export function writeConfig(seedDir: string, config: SeedSyncConfig): void {
	writeFileSync(
		join(seedDir, CONFIG_FILE),
		`${JSON.stringify(
			{
				pack: config.pack,
				schema: config.schema,
				migrations: config.migrations,
				omitFields: config.omitFields,
				placeholder: config.placeholder,
				skipFiles: config.skipFiles,
				appliedMigrations: config.appliedMigrations,
			},
			null,
			2,
		)}\n`,
	);
}

export function listSeedFiles(seedDir: string, config: SeedSyncConfig): ListedSeedFile[] {
	return readdirSync(seedDir)
		.filter((name) => name.endsWith('.json') && name !== CONFIG_FILE && name !== LEGACY_META_FILE)
		.sort()
		.map((filename) => {
			const path = join(seedDir, filename);
			const file = JSON.parse(readFileSync(path, 'utf8')) as SeedFile;
			if(!file.$prismaJsonSeed) {
				throw new Error(`${filename} is missing $prismaJsonSeed.`);
			}
			const skipReason = skipReasonFor(filename, file, config);
			return {
				filename,
				path,
				file,
				maintain: skipReason == null,
				skipReason,
			};
		});
}

export function writeSeedFile(path: string, file: SeedFile): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

export function renameSeedFile(listed: ListedSeedFile, nextName: string): void {
	const nextPath = join(dirname(listed.path), nextName);
	renameSync(listed.path, nextPath);
	listed.filename = nextName;
	listed.path = nextPath;
}

export function skipReasonFor(
	filename: string,
	file: SeedFile,
	config: SeedSyncConfig,
): string | undefined {
	if(config.skipFiles.includes(filename) || config.skipFiles.includes(basename(filename))) {
		return `skipped (listed in skipFiles)`;
	}
	if(file.$prismaJsonSeed.maintain === false) {
		return 'skipped (maintain: false)';
	}
	return undefined;
}

export function listMigrationNames(migrationsPath: string): string[] {
	if(!existsSync(migrationsPath)) {
		return [];
	}
	return readdirSync(migrationsPath, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

export function readMigrationSql(migrationsPath: string, name: string): string {
	return readFileSync(join(migrationsPath, name, 'migration.sql'), 'utf8');
}
