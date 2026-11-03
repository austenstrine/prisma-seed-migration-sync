import { readFileSync } from 'fs';
import { getDMMF } from '@prisma/internals';

export type ModelField = {
	name: string;
	kind: 'scalar' | 'object' | 'enum' | 'unsupported';
	type: string;
	isRequired: boolean;
	isList: boolean;
	isId: boolean;
	isUnique: boolean;
	hasDefault: boolean;
	isUpdatedAt: boolean;
	generatedDefault: boolean;
	defaultValue?: unknown;
	relationName?: string;
	relationFromFields: string[];
};

export type ModelInfo = {
	name: string;
	dbName: string;
	fields: ModelField[];
	uniqueFields: string[][];
};

export type SchemaInfo = {
	models: ModelInfo[];
};

export async function loadSchema(schemaPath: string): Promise<SchemaInfo> {
	const datamodel = readFileSync(schemaPath, 'utf8');
	const dmmf = await getDMMF({ datamodel });

	return {
		models: dmmf.datamodel.models.map((model) => ({
			name: model.name,
			dbName: model.dbName ?? model.name,
			uniqueFields: [
				...model.fields.filter((field) => field.isUnique).map((field) => [field.name]),
				...((model.uniqueFields as string[][] | undefined) ?? []),
			],
			fields: model.fields.map((field) => {
				const defaults = readDefault(field.hasDefaultValue, field.default);
				return {
					name: field.name,
					kind: field.kind as ModelField['kind'],
					type: field.type,
					isRequired: Boolean(field.isRequired),
					isList: Boolean(field.isList),
					isId: Boolean(field.isId),
					isUnique: Boolean(field.isUnique),
					hasDefault: Boolean(field.hasDefaultValue),
					isUpdatedAt: Boolean(field.isUpdatedAt),
					generatedDefault: defaults.generated,
					defaultValue: defaults.value,
					relationName: field.relationName,
					relationFromFields: [...(field.relationFromFields ?? [])],
				};
			}),
		})),
	};
}

export function findModel(schema: SchemaInfo, nameOrTable: string): ModelInfo | undefined {
	return schema.models.find(
		(model) => model.name === nameOrTable || model.dbName === nameOrTable,
	);
}

export function identityField(model: ModelInfo, configured?: string): string | null {
	if(configured && model.fields.some((field) => field.name === configured)) {
		return configured;
	}

	const uniqueScalar = model.fields.find(
		(field) =>
			!field.isId
			&& field.kind === 'scalar'
			&& model.uniqueFields.some((group) => group.length === 1 && group[0] === field.name),
	);
	if(uniqueScalar) {
		return uniqueScalar.name;
	}

	const idField = model.fields.find((field) => field.isId);
	return idField?.name ?? null;
}

function readDefault(
	hasDefault: boolean,
	raw: unknown,
): { generated: boolean; value?: unknown } {
	if(!hasDefault || raw == null) {
		return { generated: false };
	}

	if(typeof raw === 'object' && !Array.isArray(raw) && 'name' in raw) {
		const name = String((raw as { name: string }).name);
		if(
			['uuid', 'cuid', 'ulid', 'now', 'autoincrement', 'dbgenerated', 'auto'].includes(name)
		) {
			return { generated: true };
		}
		return { generated: true };
	}

	return { generated: false, value: raw };
}
