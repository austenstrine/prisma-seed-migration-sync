import assert from 'assert';
import { jsonValueForColumn, parseMigrationSql, splitStatements } from '../src/sql';

function test(name: string, fn: () => void): void {
	fn();
	console.log(`ok ${name}`);
}

test('splits statements without breaking quoted semicolons', () => {
	const parts = splitStatements(`
		ALTER TABLE "Foo" ADD COLUMN "note" TEXT DEFAULT 'a; b';
		ALTER TABLE "Foo" DROP COLUMN "note";
	`);
	assert.equal(parts.length, 2);
});

test('parses ADD COLUMN with default', () => {
	const changes = parseMigrationSql(
		'ALTER TABLE "Vendor" ADD COLUMN "isSuperVendor" BOOLEAN NOT NULL DEFAULT false;',
	);
	assert.equal(changes.length, 1);
	assert.deepEqual(changes[0], {
		kind: 'add-column',
		table: 'Vendor',
		column: {
			name: 'isSuperVendor',
			pgType: 'BOOLEAN',
			notNull: true,
			defaultValue: false,
			omitFromSeed: false,
		},
	});
});

test('parses RENAME TABLE', () => {
	const changes = parseMigrationSql(
		'ALTER TABLE "MarketplaceOrder" RENAME TO "PlaceEtMarqueOrder";',
	);
	assert.deepEqual(changes[0], {
		kind: 'rename-table',
		from: 'MarketplaceOrder',
		to: 'PlaceEtMarqueOrder',
	});
});

test('parses RENAME COLUMN', () => {
	const changes = parseMigrationSql(
		'ALTER TABLE "CatalogProduct" RENAME COLUMN "sku" TO "legacySku";',
	);
	assert.deepEqual(changes[0], {
		kind: 'rename-column',
		table: 'CatalogProduct',
		from: 'sku',
		to: 'legacySku',
	});
});

test('parses CREATE TABLE columns and skips constraints', () => {
	const changes = parseMigrationSql(`
		CREATE TABLE "CatalogCategory" (
			"id" TEXT NOT NULL,
			"slug" TEXT NOT NULL,
			"name" TEXT NOT NULL,
			"parentId" TEXT,
			"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
			CONSTRAINT "CatalogCategory_pkey" PRIMARY KEY ("id")
		);
	`);
	assert.equal(changes[0]?.kind, 'create-table');
	if(changes[0]?.kind !== 'create-table') {
		throw new Error('expected create-table');
	}
	assert.equal(changes[0].table, 'CatalogCategory');
	assert.equal(changes[0].columns.length, 5);
	const createdAt = changes[0].columns.find((column) => column.name === 'createdAt');
	assert.equal(createdAt?.omitFromSeed, true);
});

test('json defaults', () => {
	assert.equal(
		jsonValueForColumn({
			name: 'active',
			pgType: 'BOOLEAN',
			notNull: true,
			defaultValue: true,
			omitFromSeed: false,
		}),
		true,
	);
	assert.equal(
		jsonValueForColumn({
			name: 'id',
			pgType: 'TEXT',
			notNull: true,
			omitFromSeed: true,
		}),
		undefined,
	);
	assert.equal(
		jsonValueForColumn({
			name: 'title',
			pgType: 'TEXT',
			notNull: true,
			omitFromSeed: false,
		}),
		'__SEED_TODO__',
	);
});

console.log('All sql tests passed.');
