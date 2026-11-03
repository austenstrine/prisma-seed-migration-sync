import assert from 'assert';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { applySeedDataIfNeeded, seedPackChecksum } from '../src/apply';

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
	return Promise.resolve(fn()).then(() => {
		console.log(`ok ${name}`);
	});
}

function seedDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'seed-apply-'));
	writeFileSync(
		join(dir, 'seed-sync.config.json'),
		JSON.stringify({
			pack: 'test',
			schema: '../schema.prisma',
			migrations: './migrations',
			omitFields: ['id'],
			placeholder: '__SEED_TODO__',
			skipFiles: [],
			appliedMigrations: [],
		}),
	);
	writeFileSync(
		join(dir, 'Vendor.json'),
		JSON.stringify({
			$prismaJsonSeed: { model: 'Vendor', identityField: 'slug' },
			records: [{ slug: 'demo-supply', name: 'Demo Supply Co.' }],
		}),
	);
	return dir;
}

async function main(): Promise<void> {
	await test('skips upserts when the store checksum matches', async () => {
		const dir = seedDir();
		const { pack, checksum } = seedPackChecksum(dir);
		let writes = 0;
		const result = await applySeedDataIfNeeded({
			prisma: {},
			seedDir: dir,
			store: {
				read: async () => checksum,
				write: async () => {
					writes += 1;
				},
			},
		});
		assert.equal(result.skipped, true);
		assert.equal(result.pack, pack);
		assert.equal(result.upserted, 0);
		assert.equal(writes, 0);
	});

	await test('does not skip without a store', async () => {
		const dir = seedDir();
		try {
			await applySeedDataIfNeeded({
				prisma: {},
				seedDir: dir,
			});
			assert.fail('expected apply to load schema');
		} catch (error) {
			assert.ok(error instanceof Error);
			assert.equal(
				error.message.includes('schema.prisma') || error.message.includes('ENOENT'),
				true,
				error.message,
			);
		}
	});
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
