import { basename } from 'path';
import type { ListedSeedFile } from './files';
import { jsonValueForColumn } from './sql';
import { walkRecords } from './tree';
import type { MigrationChange, SeedEdit } from './types';

export function applyChangeToSeedFile(
	listed: ListedSeedFile,
	change: MigrationChange,
	options: {
		migration: string;
		omitFields: Set<string>;
		placeholder: string;
	},
): SeedEdit[] {
	const model = listed.file.$prismaJsonSeed.model ?? listed.filename;
	const childrenField = listed.file.$prismaJsonSeed.childrenField ?? 'children';
	const records = listed.file.records;
	if(!Array.isArray(records)) {
		return [];
	}

	if(change.kind === 'rename-table') {
		if(listed.file.$prismaJsonSeed.model !== change.from) {
			return [];
		}
		listed.file.$prismaJsonSeed.model = change.to;
		return [{
			file: listed.filename,
			model: change.to,
			migration: options.migration,
			kind: 'rename-model',
			from: change.from,
			to: change.to,
			records: 0,
			detail: `[${options.migration}] renamed model "${change.from}" → "${change.to}"`,
		}];
	}

	if(change.kind === 'drop-table') {
		if(listed.file.$prismaJsonSeed.model !== change.table) {
			return [];
		}
		return [{
			file: listed.filename,
			model,
			migration: options.migration,
			kind: 'skip-change',
			records: 0,
			detail: `[${options.migration}] left ${listed.filename} in place after DROP TABLE "${change.table}"`,
		}];
	}

	if(change.kind === 'rename-enum-value') {
		let count = 0;
		walkRecords(records, childrenField, (record) => {
			count += renameEnumValue(record, childrenField, change.from, change.to);
		});
		if(count === 0) {
			return [];
		}
		return [{
			file: listed.filename,
			model,
			migration: options.migration,
			kind: 'rename-enum-value',
			from: change.from,
			to: change.to,
			records: count,
			detail: `[${options.migration}] renamed enum value "${change.from}" → "${change.to}"`,
		}];
	}

	if(change.kind === 'create-table') {
		if(listed.file.$prismaJsonSeed.model !== change.table) {
			return [];
		}
		const edits: SeedEdit[] = [];
		for(const column of change.columns) {
			edits.push(...addColumn(listed, column, childrenField, options));
		}
		return edits;
	}

	if(change.kind === 'add-column') {
		if(listed.file.$prismaJsonSeed.model !== change.table) {
			return [];
		}
		return addColumn(listed, change.column, childrenField, options);
	}

	if(change.kind === 'drop-column') {
		if(listed.file.$prismaJsonSeed.model !== change.table) {
			return [];
		}
		return removeField(listed, change.column, childrenField, options.migration);
	}

	if(change.kind === 'rename-column') {
		if(listed.file.$prismaJsonSeed.model !== change.table) {
			return [];
		}
		return renameField(listed, change.from, change.to, childrenField, options.migration);
	}

	return [];
}

export function seedFileNameForModel(model: string): string {
	return `${model}.json`;
}

export function suggestedRename(listed: ListedSeedFile, from: string, to: string): string | null {
	if(basename(listed.filename, '.json') === from) {
		return seedFileNameForModel(to);
	}
	return null;
}

export function mergeEdits(edits: SeedEdit[]): SeedEdit[] {
	const grouped = new Map<string, SeedEdit>();
	for(const edit of edits) {
		const key = [
			edit.file,
			edit.kind,
			edit.migration ?? '',
			edit.field ?? '',
			edit.from ?? '',
			edit.to ?? '',
			JSON.stringify(edit.value ?? null),
		].join('|');
		const existing = grouped.get(key);
		if(existing) {
			existing.records += edit.records;
		}
		else {
			grouped.set(key, { ...edit });
		}
	}
	return [...grouped.values()];
}

function addColumn(
	listed: ListedSeedFile,
	column: { name: string; pgType: string; notNull: boolean; defaultValue?: unknown; omitFromSeed: boolean },
	childrenField: string,
	options: { migration: string; omitFields: Set<string>; placeholder: string },
): SeedEdit[] {
	if(column.omitFromSeed || options.omitFields.has(column.name)) {
		return [];
	}

	const value = jsonValueForColumn(column, options.placeholder);
	if(value === undefined) {
		return [];
	}

	let count = 0;
	walkRecords(listed.file.records ?? [], childrenField, (record) => {
		if(column.name in record) {
			return;
		}
		record[column.name] = value;
		count += 1;
	});
	if(count === 0) {
		return [];
	}

	const source = column.defaultValue !== undefined
		? 'migration default'
		: column.notNull
			? 'placeholder; set this value'
			: 'optional';
	return [{
		file: listed.filename,
		model: listed.file.$prismaJsonSeed.model ?? listed.filename,
		migration: options.migration,
		kind: 'add-field',
		field: column.name,
		value,
		records: count,
		detail: `[${options.migration}] added "${column.name}" = ${JSON.stringify(value)} (${source})`,
	}];
}

function removeField(
	listed: ListedSeedFile,
	field: string,
	childrenField: string,
	migration: string,
): SeedEdit[] {
	let count = 0;
	walkRecords(listed.file.records ?? [], childrenField, (record) => {
		if(!(field in record)) {
			return;
		}
		delete record[field];
		count += 1;
	});
	if(count === 0) {
		return [];
	}
	return [{
		file: listed.filename,
		model: listed.file.$prismaJsonSeed.model ?? listed.filename,
		migration,
		kind: 'remove-field',
		field,
		records: count,
		detail: `[${migration}] removed "${field}"`,
	}];
}

function renameField(
	listed: ListedSeedFile,
	from: string,
	to: string,
	childrenField: string,
	migration: string,
): SeedEdit[] {
	const header = listed.file.$prismaJsonSeed;
	if(header.identityField === from) {
		header.identityField = to;
	}

	let count = 0;
	walkRecords(listed.file.records ?? [], childrenField, (record) => {
		if(from in record && !(to in record)) {
			record[to] = record[from];
			delete record[from];
			count += 1;
		}
		renameConnectKey(record, childrenField, from, to);
	});
	if(count === 0) {
		return [];
	}
	return [{
		file: listed.filename,
		model: header.model ?? listed.filename,
		migration,
		kind: 'rename-field',
		from,
		to,
		records: count,
		detail: `[${migration}] renamed "${from}" → "${to}"`,
	}];
}

function renameConnectKey(
	record: Record<string, unknown>,
	childrenField: string,
	from: string,
	to: string,
): void {
	for(const [key, value] of Object.entries(record)) {
		if(key === childrenField || !value || typeof value !== 'object' || Array.isArray(value)) {
			continue;
		}
		const nested = value as Record<string, unknown>;
		if(from in nested && !(to in nested)) {
			nested[to] = nested[from];
			delete nested[from];
		}
	}
}

function renameEnumValue(
	record: Record<string, unknown>,
	childrenField: string,
	from: string,
	to: string,
): number {
	let count = 0;
	for(const [key, value] of Object.entries(record)) {
		if(key === childrenField) {
			continue;
		}
		if(value === from) {
			record[key] = to;
			count += 1;
		}
	}
	return count;
}
