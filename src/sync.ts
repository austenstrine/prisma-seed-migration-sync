import { resolve } from 'path';
import {
	listMigrationNames,
	listSeedFiles,
	readConfig,
	readMigrationSql,
	renameSeedFile,
	writeConfig,
	writeSeedFile,
	type ListedSeedFile,
} from './files';
import { applyChangeToSeedFile, mergeEdits, suggestedRename } from './reshape';
import { parseMigrationSql } from './sql';
import type { SeedEdit, SyncOptions, SyncResult } from './types';

export function syncSeedData(options: SyncOptions): SyncResult {
	const config = readConfig(options.seedDir);
	const migrationsPath = resolve(options.seedDir, options.migrationsPath ?? config.migrations);
	const allMigrations = listMigrationNames(migrationsPath);
	const applied = new Set(config.appliedMigrations);
	const pendingMigrations = allMigrations.filter((name) => !applied.has(name));
	const listed = listSeedFiles(options.seedDir, config);
	const dryRun = Boolean(options.dryRun);
	const omitFields = new Set(config.omitFields);
	const skippedFiles: string[] = [];
	const warnings: string[] = [];
	const edits: SeedEdit[] = [];

	for(const item of listed) {
		if(!item.maintain) {
			skippedFiles.push(item.filename);
			edits.push({
				file: item.filename,
				model: item.file.$prismaJsonSeed.model ?? item.filename,
				kind: 'skip-file',
				records: 0,
				detail: item.skipReason ?? 'skipped (maintain: false)',
			});
		}
	}

	const maintainable = listed.filter((item) => item.maintain);
	const baselined = config.appliedMigrations.length === 0 && allMigrations.length > 0;

	if(baselined) {
		edits.push({
			file: 'seed-sync.config.json',
			model: '(ledger)',
			kind: 'baseline',
			records: allMigrations.length,
			detail: `baselined ${allMigrations.length} existing migrations (seed files were not replayed)`,
		});
		if(!dryRun) {
			config.appliedMigrations = allMigrations;
			writeConfig(options.seedDir, config);
		}

		return {
			dryRun,
			pendingMigrations: [],
			baselined: true,
			appliedMigrations: allMigrations,
			edits,
			changedFiles: dryRun ? [] : ['seed-sync.config.json'],
			skippedFiles,
			warnings,
		};
	}

	const dirty = new Set<ListedSeedFile>();
	const changedFiles: string[] = [];

	for(const migration of pendingMigrations) {
		const changes = parseMigrationSql(readMigrationSql(migrationsPath, migration));
		for(const change of changes) {
			if(change.kind === 'create-table') {
				const hasFile = maintainable.some(
					(item) => item.file.$prismaJsonSeed.model === change.table,
				);
				if(!hasFile) {
					warnings.push(
						`[${migration}] CREATE TABLE "${change.table}" has no seed data file; skipped (this tool does not generate rows)`,
					);
					continue;
				}
			}

			if(change.kind === 'drop-table') {
				const hit = maintainable.find(
					(item) => item.file.$prismaJsonSeed.model === change.table,
				);
				if(hit) {
					warnings.push(
						`[${migration}] DROP TABLE "${change.table}" did not delete ${hit.filename}`,
					);
				}
			}

			for(const item of maintainable) {
				const fileEdits = applyChangeToSeedFile(item, change, {
					migration,
					omitFields,
					placeholder: config.placeholder,
				});
				if(fileEdits.length === 0) {
					continue;
				}
				edits.push(...fileEdits);
				if(fileEdits.some((edit) => edit.kind !== 'skip-change')) {
					dirty.add(item);
				}
				maybeRenameFile(item, fileEdits, dryRun);
			}
		}
	}

	const nextApplied = [...config.appliedMigrations, ...pendingMigrations];
	if(!dryRun) {
		for(const item of dirty) {
			writeSeedFile(item.path, item.file);
			changedFiles.push(item.filename);
		}
		if(pendingMigrations.length > 0) {
			config.appliedMigrations = nextApplied;
			writeConfig(options.seedDir, config);
			changedFiles.push('seed-sync.config.json');
		}
	}
	else {
		changedFiles.push(...[...dirty].map((item) => item.filename));
		if(pendingMigrations.length > 0) {
			changedFiles.push('seed-sync.config.json');
		}
	}

	return {
		dryRun,
		pendingMigrations,
		baselined: false,
		appliedMigrations: dryRun ? config.appliedMigrations : nextApplied,
		edits: mergeEdits(edits),
		changedFiles,
		skippedFiles,
		warnings,
	};
}

export function formatSyncSummary(result: SyncResult): string {
	const lines: string[] = [
		'Prisma Seed Migration Sync',
		result.dryRun ? 'Mode: dry-run (no files written)' : 'Mode: write',
		'',
	];

	if(result.baselined) {
		lines.push(
			result.dryRun
				? `Would baseline ${result.appliedMigrations.length} migrations already on disk.`
				: `Baselined ${result.appliedMigrations.length} migrations. Future syncs will replay only new migrations.`,
			'',
		);
	}
	else if(result.pendingMigrations.length > 0) {
		lines.push('Pending migrations:');
		for(const name of result.pendingMigrations) {
			lines.push(`  - ${name}`);
		}
		lines.push('');
	}
	else {
		lines.push('No pending migrations. Seed data is already synced.');
		lines.push('');
	}

	if(result.skippedFiles.length > 0) {
		lines.push('Skipped:');
		for(const file of result.skippedFiles) {
			const skip = result.edits.find((edit) => edit.file === file && edit.kind === 'skip-file');
			lines.push(`  - ${file}${skip ? ` — ${skip.detail}` : ''}`);
		}
		lines.push('');
	}

	const fileEdits = result.edits.filter((edit) => edit.kind !== 'skip-file');
	if(fileEdits.length === 0 && !result.baselined) {
		lines.push('No seed record shapes needed to change.');
	}
	else {
		let currentFile = '';
		for(const edit of fileEdits) {
			if(edit.file !== currentFile) {
				currentFile = edit.file;
				lines.push(`${edit.file}${edit.model ? ` (${edit.model})` : ''}`);
			}
			const count = edit.records > 0
				? ` [${edit.records === 1 ? '1 record' : `${edit.records} records`}]`
				: '';
			lines.push(`  ${edit.detail}${count}`);
		}
	}

	if(result.warnings.length > 0) {
		lines.push('', 'Warnings:');
		for(const warning of result.warnings) {
			lines.push(`  - ${warning}`);
		}
	}

	return lines.join('\n');
}

function maybeRenameFile(
	item: ListedSeedFile,
	fileEdits: SeedEdit[],
	dryRun: boolean,
): void {
	const renamed = fileEdits.find((edit) => edit.kind === 'rename-model' && edit.from && edit.to);
	if(!renamed?.from || !renamed.to) {
		return;
	}
	const nextName = suggestedRename(item, renamed.from, renamed.to);
	if(!nextName || nextName === item.filename) {
		return;
	}
	if(!dryRun) {
		renameSeedFile(item, nextName);
	}
	else {
		item.filename = nextName;
	}
}
