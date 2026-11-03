import assert from 'assert';
import { applyChangeToSeedFile, mergeEdits } from '../src/reshape';
import type { ListedSeedFile } from '../src/files';
import type { SeedFile } from '../src/types';

function test(name: string, fn: () => void): void {
	fn();
	console.log(`ok ${name}`);
}

function listed(file: SeedFile): ListedSeedFile {
	return {
		filename: 'CatalogCategory.json',
		path: 'CatalogCategory.json',
		file,
		maintain: true,
	};
}

const options = {
	migration: '20261020_add_sort',
	omitFields: new Set(['id', 'createdAt', 'updatedAt']),
	placeholder: '__SEED_TODO__',
};

test('adds a column from ADD COLUMN using the migration default', () => {
	const item = listed({
		$prismaJsonSeed: { model: 'CatalogCategory' },
		records: [{ slug: 'wire', name: 'Wire' }],
	});
	const edits = applyChangeToSeedFile(
		item,
		{
			kind: 'add-column',
			table: 'CatalogCategory',
			column: {
				name: 'sortOrder',
				pgType: 'INTEGER',
				notNull: true,
				defaultValue: 0,
				omitFromSeed: false,
			},
		},
		options,
	);
	assert.equal(item.file.records?.[0].sortOrder, 0);
	assert.equal(item.file.records?.[0].slug, 'wire');
	assert.equal(edits[0]?.kind, 'add-field');
});

test('uses a placeholder when a required column has no default', () => {
	const item = listed({
		$prismaJsonSeed: { model: 'CatalogCategory' },
		records: [{ slug: 'wire' }],
	});
	applyChangeToSeedFile(
		item,
		{
			kind: 'add-column',
			table: 'CatalogCategory',
			column: {
				name: 'name',
				pgType: 'TEXT',
				notNull: true,
				omitFromSeed: false,
			},
		},
		options,
	);
	assert.equal(item.file.records?.[0].name, '__SEED_TODO__');
});

test('does not invent rows for CREATE TABLE when this file is a different model', () => {
	const item = listed({
		$prismaJsonSeed: { model: 'CatalogCategory' },
		records: [{ slug: 'wire' }],
	});
	const edits = applyChangeToSeedFile(
		item,
		{ kind: 'create-table', table: 'Vendor', columns: [] },
		options,
	);
	assert.equal(edits.length, 0);
	assert.deepEqual(item.file.records, [{ slug: 'wire' }]);
});

test('renames and removes fields from pending migrations', () => {
	const item = listed({
		$prismaJsonSeed: { model: 'CatalogCategory', identityField: 'key' },
		records: [{ key: 'wire', name: 'Wire', legacy: true }],
	});
	applyChangeToSeedFile(
		item,
		{ kind: 'rename-column', table: 'CatalogCategory', from: 'key', to: 'slug' },
		options,
	);
	applyChangeToSeedFile(
		item,
		{ kind: 'drop-column', table: 'CatalogCategory', column: 'legacy' },
		options,
	);
	assert.equal(item.file.records?.[0].slug, 'wire');
	assert.equal('key' in (item.file.records?.[0] ?? {}), false);
	assert.equal('legacy' in (item.file.records?.[0] ?? {}), false);
	assert.equal(item.file.$prismaJsonSeed.identityField, 'slug');
});

test('keeps nested children and updates simple parent connect keys', () => {
	const item = listed({
		$prismaJsonSeed: { model: 'CatalogCategory', childrenField: 'children' },
		records: [{
			key: 'electrical',
			name: 'Electrical',
			children: [{
				key: 'wire',
				name: 'Wire',
				parent: { key: 'electrical' },
			}],
		}],
	});
	applyChangeToSeedFile(
		item,
		{ kind: 'rename-column', table: 'CatalogCategory', from: 'key', to: 'slug' },
		options,
	);
	const child = (item.file.records?.[0].children as Record<string, unknown>[])[0];
	assert.equal(child.slug, 'wire');
	assert.deepEqual(child.parent, { slug: 'electrical' });
});

test('skips omitted generated columns', () => {
	const item = listed({
		$prismaJsonSeed: { model: 'CatalogCategory' },
		records: [{ slug: 'wire' }],
	});
	const edits = applyChangeToSeedFile(
		item,
		{
			kind: 'add-column',
			table: 'CatalogCategory',
			column: {
				name: 'id',
				pgType: 'TEXT',
				notNull: true,
				omitFromSeed: true,
			},
		},
		options,
	);
	assert.equal(edits.length, 0);
	assert.equal('id' in (item.file.records?.[0] ?? {}), false);
});

test('does not touch a file for a different model', () => {
	const item = listed({
		$prismaJsonSeed: { model: 'Project' },
		records: [{ slug: 'demo' }],
	});
	const edits = applyChangeToSeedFile(
		item,
		{
			kind: 'add-column',
			table: 'CatalogCategory',
			column: {
				name: 'sortOrder',
				pgType: 'INTEGER',
				notNull: true,
				defaultValue: 0,
				omitFromSeed: false,
			},
		},
		options,
	);
	assert.equal(edits.length, 0);
	assert.equal('sortOrder' in (item.file.records?.[0] ?? {}), false);
});

test('merges per-record edits', () => {
	const merged = mergeEdits([
		{
			file: 'A.json',
			model: 'A',
			kind: 'add-field',
			field: 'sortOrder',
			value: 0,
			records: 1,
			detail: 'added',
		},
		{
			file: 'A.json',
			model: 'A',
			kind: 'add-field',
			field: 'sortOrder',
			value: 0,
			records: 1,
			detail: 'added',
		},
	]);
	assert.equal(merged.length, 1);
	assert.equal(merged[0].records, 2);
});

console.log('All reshape tests passed.');
