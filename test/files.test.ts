import assert from 'assert';
import { skipReasonFor } from '../src/files';
import type { SeedFile, SeedSyncConfig } from '../src/types';

function test(name: string, fn: () => void): void {
	fn();
	console.log(`ok ${name}`);
}

const config: SeedSyncConfig = {
	pack: 'test',
	schema: '../schema.prisma',
	migrations: '../migrations',
	omitFields: ['id'],
	placeholder: '__SEED_TODO__',
	skipFiles: ['Secrets.json'],
	appliedMigrations: [],
};

test('files are maintained unless the user opts out', () => {
	const file: SeedFile = {
		$prismaJsonSeed: { model: 'Project' },
	};
	assert.equal(skipReasonFor('Project.json', file, config), undefined);
	assert.equal(skipReasonFor('Secrets.json', file, config), 'skipped (listed in skipFiles)');
});

test('maintain: false opts a file out without any skipFiles entry', () => {
	const file: SeedFile = {
		$prismaJsonSeed: { model: 'Vendor', maintain: false },
	};
	assert.equal(
		skipReasonFor('Vendor.json', file, { ...config, skipFiles: [] }),
		'skipped (maintain: false)',
	);
});

test('maintain defaults to true', () => {
	const file: SeedFile = {
		$prismaJsonSeed: { model: 'Project' },
	};
	const maintain = file.$prismaJsonSeed.maintain ?? skipReasonFor('Project.json', file, {
		...config,
		skipFiles: [],
	}) == null;
	assert.equal(maintain, true);
});

console.log('All files tests passed.');
