import assert from 'assert';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { syncSeedData } from '../src/sync';
import { validateSeedData } from '../src/validate';

function test(name: string, fn: () => void): void {
	fn();
	console.log(`ok ${name}`);
}

function seedDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'seed-sync-'));
	writeFileSync(
		join(dir, 'seed-sync.config.json'),
		JSON.stringify({
			pack: 'test',
			schema: '../schema.prisma',
			migrations: './migrations',
			omitFields: ['id', 'createdAt', 'updatedAt'],
			placeholder: '__SEED_TODO__',
			skipFiles: ['LocalAdmin.json'],
			appliedMigrations: [],
		}, null, 2),
	);
	writeFileSync(
		join(dir, 'CatalogCategory.json'),
		JSON.stringify({
			$prismaJsonSeed: { model: 'CatalogCategory' },
			records: [{ slug: 'wire', name: 'Wire' }],
		}, null, 2),
	);
	writeFileSync(
		join(dir, 'LocalAdmin.json'),
		JSON.stringify({
			$prismaJsonSeed: { model: 'User', maintain: false },
			records: [{ email: 'admin@example.com' }],
		}, null, 2),
	);
	return dir;
}

function writeMigration(dir: string, name: string, sql: string): void {
	const folder = join(dir, 'migrations', name);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'migration.sql'), sql);
}

test('baselines existing migrations instead of replaying them', () => {
	const dir = seedDir();
	writeMigration(dir, '20260101_init', 'CREATE TABLE "CatalogCategory" ("slug" TEXT NOT NULL);');
	const result = syncSeedData({ seedDir: dir });
	assert.equal(result.baselined, true);
	const category = JSON.parse(readFileSync(join(dir, 'CatalogCategory.json'), 'utf8'));
	assert.deepEqual(category.records[0], { slug: 'wire', name: 'Wire' });
	const config = JSON.parse(readFileSync(join(dir, 'seed-sync.config.json'), 'utf8'));
	assert.deepEqual(config.appliedMigrations, ['20260101_init']);
});

test('replays only pending migrations onto opted-in files', () => {
	const dir = seedDir();
	const configPath = join(dir, 'seed-sync.config.json');
	const config = JSON.parse(readFileSync(configPath, 'utf8'));
	config.appliedMigrations = ['20260101_init'];
	writeFileSync(configPath, JSON.stringify(config, null, 2));
	writeMigration(dir, '20260101_init', 'CREATE TABLE "CatalogCategory" ("slug" TEXT NOT NULL);');
	writeMigration(
		dir,
		'20260201_sort',
		'ALTER TABLE "CatalogCategory" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;',
	);
	writeMigration(
		dir,
		'20260301_vendor_flag',
		'ALTER TABLE "Vendor" ADD COLUMN "isSuperVendor" BOOLEAN NOT NULL DEFAULT false;',
	);

	const result = syncSeedData({ seedDir: dir });
	assert.deepEqual(result.pendingMigrations, ['20260201_sort', '20260301_vendor_flag']);
	const category = JSON.parse(readFileSync(join(dir, 'CatalogCategory.json'), 'utf8'));
	assert.equal(category.records[0].sortOrder, 0);
	assert.equal(category.records[0].slug, 'wire');
	const skipped = JSON.parse(readFileSync(join(dir, 'LocalAdmin.json'), 'utf8'));
	assert.equal('isSuperVendor' in (skipped.records?.[0] ?? {}), false);
	const saved = JSON.parse(readFileSync(configPath, 'utf8'));
	assert.deepEqual(saved.appliedMigrations, [
		'20260101_init',
		'20260201_sort',
		'20260301_vendor_flag',
	]);
	assert.ok(result.skippedFiles.includes('LocalAdmin.json'));
});

test('dry-run does not write seed files or the migration ledger', () => {
	const dir = seedDir();
	const configPath = join(dir, 'seed-sync.config.json');
	const config = JSON.parse(readFileSync(configPath, 'utf8'));
	config.appliedMigrations = ['20260101_init'];
	writeFileSync(configPath, JSON.stringify(config, null, 2));
	writeMigration(dir, '20260101_init', 'CREATE TABLE "CatalogCategory" ("slug" TEXT NOT NULL);');
	writeMigration(
		dir,
		'20260201_sort',
		'ALTER TABLE "CatalogCategory" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;',
	);

	const result = syncSeedData({ seedDir: dir, dryRun: true });
	assert.equal(result.dryRun, true);
	const category = JSON.parse(readFileSync(join(dir, 'CatalogCategory.json'), 'utf8'));
	assert.equal('sortOrder' in category.records[0], false);
	const saved = JSON.parse(readFileSync(configPath, 'utf8'));
	assert.deepEqual(saved.appliedMigrations, ['20260101_init']);
});

test('validate fails while migrations are pending', () => {
	const dir = seedDir();
	writeMigration(dir, '20260101_init', 'CREATE TABLE "CatalogCategory" ("slug" TEXT NOT NULL);');
	const before = validateSeedData(dir);
	assert.equal(before.ok, false);
	syncSeedData({ seedDir: dir });
	const after = validateSeedData(dir);
	assert.equal(after.ok, true);
});

console.log('All sync tests passed.');
