import type { ColumnDef, MigrationChange } from './types';

type Token =
	| { type: 'word'; value: string }
	| { type: 'ident'; value: string }
	| { type: 'string'; value: string }
	| { type: 'number'; value: string }
	| { type: 'punct'; value: string };

const GENERATED_DEFAULTS = new Set([
	'uuid()',
	'gen_random_uuid()',
	'current_timestamp',
	'now()',
]);

export function parseMigrationSql(sql: string): MigrationChange[] {
	const statements = splitStatements(sql);
	const changes: MigrationChange[] = [];

	for(const statement of statements) {
		const parsed = parseStatement(statement);
		if(parsed) {
			changes.push(parsed);
		}
	}

	return changes;
}

export function splitStatements(sql: string): string[] {
	const tokens = tokenize(sql);
	const statements: string[] = [];
	let current: Token[] = [];

	for(const token of tokens) {
		if(token.type === 'punct' && token.value === ';') {
			const text = tokensToSql(current).trim();
			if(text) {
				statements.push(text);
			}
			current = [];
			continue;
		}
		current.push(token);
	}

	const trailing = tokensToSql(current).trim();
	if(trailing) {
		statements.push(trailing);
	}

	return statements;
}

function parseStatement(statement: string): MigrationChange | null {
	const tokens = tokenize(statement);
	if(tokens.length === 0) {
		return null;
	}

	const words = tokens
		.filter((token) => token.type === 'word' || token.type === 'ident')
		.map((token) => token.value);

	const head = words.slice(0, 3).map((word) => word.toUpperCase());

	if(head[0] === 'CREATE' && head[1] === 'TABLE') {
		return parseCreateTable(tokens);
	}

	if(head[0] === 'DROP' && head[1] === 'TABLE') {
		const table = firstIdentAfter(tokens, 'TABLE');
		return table
			? { kind: 'drop-table', table }
			: null;
	}

	if(head[0] === 'ALTER' && head[1] === 'TABLE') {
		return parseAlterTable(tokens);
	}

	if(head[0] === 'ALTER' && head[1] === 'TYPE') {
		return parseAlterType(tokens);
	}

	return null;
}

function parseCreateTable(tokens: Token[]): MigrationChange | null {
	const table = firstIdentAfter(tokens, 'TABLE');
	if(!table) {
		return null;
	}

	const open = tokens.findIndex((token) => token.type === 'punct' && token.value === '(');
	if(open < 0) {
		return { kind: 'create-table', table, columns: [] };
	}

	const inner = sliceParens(tokens, open);
	const columns: ColumnDef[] = [];
	for(const part of splitTopLevel(inner, ',')) {
		if(part.length === 0) {
			continue;
		}
		if(part[0]?.type === 'word' && part[0].value.toUpperCase() === 'CONSTRAINT') {
			continue;
		}
		if(part[0]?.type !== 'ident') {
			continue;
		}
		columns.push(parseColumnDef(part));
	}

	return { kind: 'create-table', table, columns };
}

function parseAlterTable(tokens: Token[]): MigrationChange | null {
	const table = firstIdentAfter(tokens, 'TABLE');
	if(!table) {
		return null;
	}

	const tableWordIndex = tokens.findIndex(
		(token) => token.type === 'word' && token.value.toUpperCase() === 'TABLE',
	);
	const actionIndex = tableWordIndex >= 0 ? tableWordIndex + 2 : -1;
	if(actionIndex < 0 || actionIndex >= tokens.length) {
		return null;
	}

	const action = tokens[actionIndex].value.toUpperCase();
	const rest = tokens.slice(actionIndex + 1);

	if(action === 'ADD' && isWord(rest[0], 'COLUMN')) {
		return {
			kind: 'add-column',
			table,
			column: parseColumnDef(rest.slice(1)),
		};
	}

	if(action === 'DROP' && isWord(rest[0], 'COLUMN')) {
		const column = identValue(rest[1]);
		return column
			? { kind: 'drop-column', table, column }
			: null;
	}

	if(action === 'RENAME' && isWord(rest[0], 'COLUMN')) {
		const from = identValue(rest[1]);
		const to = identValue(rest[3]);
		return from && to
			? { kind: 'rename-column', table, from, to }
			: null;
	}

	if(action === 'RENAME' && isWord(rest[0], 'TO')) {
		const to = identValue(rest[1]);
		return to
			? { kind: 'rename-table', from: table, to }
			: null;
	}

	if(action === 'ALTER' && isWord(rest[0], 'COLUMN')) {
		const column = identValue(rest[1]);
		if(!column) {
			return null;
		}
		if(isWord(rest[2], 'SET') && isWord(rest[3], 'DEFAULT')) {
			const parsed = parseDefaultTokens(rest.slice(4));
			return {
				kind: 'set-column-default',
				table,
				column,
				value: parsed.value,
				omit: parsed.omit,
			};
		}
	}

	return null;
}

function parseAlterType(tokens: Token[]): MigrationChange | null {
	const enumName = firstIdentAfter(tokens, 'TYPE');
	if(!enumName) {
		return null;
	}

	if(indexOfSequence(tokens, ['RENAME', 'VALUE']) >= 0) {
		const strings = tokens.filter((token) => token.type === 'string');
		if(strings.length >= 2) {
			return {
				kind: 'rename-enum-value',
				enumName,
				from: strings[0].value,
				to: strings[1].value,
			};
		}
	}

	return null;
}

function parseColumnDef(tokens: Token[]): ColumnDef {
	const name = identValue(tokens[0]) ?? 'unknown';
	let notNull = false;
	let defaultValue: unknown;
	let omitFromSeed = false;
	const typeTokens: string[] = [];

	let i = 1;
	while(i < tokens.length) {
		const token = tokens[i];
		if(token.type === 'word' && token.value.toUpperCase() === 'NOT' && isWord(tokens[i + 1], 'NULL')) {
			notNull = true;
			i += 2;
			continue;
		}
		if(token.type === 'word' && token.value.toUpperCase() === 'DEFAULT') {
			const parsed = parseDefaultTokens(tokens.slice(i + 1));
			defaultValue = parsed.value;
			omitFromSeed = parsed.omit;
			break;
		}
		if(token.type === 'word' && ['NULL', 'PRIMARY', 'UNIQUE', 'REFERENCES', 'CONSTRAINT'].includes(token.value.toUpperCase())) {
			break;
		}
		if(token.type === 'punct' && token.value === ',') {
			break;
		}
		typeTokens.push(token.type === 'ident' ? token.value : token.value);
		i += 1;
	}

	return {
		name,
		pgType: typeTokens.join(' '),
		notNull,
		defaultValue,
		omitFromSeed,
	};
}

function parseDefaultTokens(tokens: Token[]): { value: unknown; omit: boolean } {
	if(tokens.length === 0) {
		return { value: null, omit: false };
	}

	const first = tokens[0];
	if(first.type === 'string') {
		return { value: first.value, omit: false };
	}
	if(first.type === 'number') {
		return { value: Number(first.value), omit: false };
	}
	if(first.type === 'word') {
		const upper = first.value.toUpperCase();
		if(upper === 'TRUE') {
			return { value: true, omit: false };
		}
		if(upper === 'FALSE') {
			return { value: false, omit: false };
		}
		if(upper === 'NULL') {
			return { value: null, omit: false };
		}
		if(upper === 'CURRENT_TIMESTAMP' || upper === 'NOW') {
			return { value: null, omit: true };
		}
		if(upper === 'ARRAY') {
			return { value: [], omit: false };
		}
	}

	const rendered = tokensToSql(tokens).trim().toLowerCase();
	if(GENERATED_DEFAULTS.has(rendered) || rendered.startsWith('uuid(') || rendered.startsWith('gen_random_uuid(')) {
		return { value: null, omit: true };
	}

	return { value: null, omit: false };
}

function tokenize(sql: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while(i < sql.length) {
		const char = sql[i];

		if(char === '-' && sql[i + 1] === '-') {
			i += 2;
			while(i < sql.length && sql[i] !== '\n') {
				i += 1;
			}
			continue;
		}

		if(char === '/' && sql[i + 1] === '*') {
			i += 2;
			while(i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
				i += 1;
			}
			i += 2;
			continue;
		}

		if(/\s/.test(char)) {
			i += 1;
			continue;
		}

		if(char === '\'') {
			let value = '';
			i += 1;
			while(i < sql.length) {
				if(sql[i] === '\'' && sql[i + 1] === '\'') {
					value += '\'';
					i += 2;
					continue;
				}
				if(sql[i] === '\'') {
					i += 1;
					break;
				}
				value += sql[i];
				i += 1;
			}
			tokens.push({ type: 'string', value });
			continue;
		}

		if(char === '"') {
			let value = '';
			i += 1;
			while(i < sql.length) {
				if(sql[i] === '"' && sql[i + 1] === '"') {
					value += '"';
					i += 2;
					continue;
				}
				if(sql[i] === '"') {
					i += 1;
					break;
				}
				value += sql[i];
				i += 1;
			}
			tokens.push({ type: 'ident', value });
			continue;
		}

		if(/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
			let value = '';
			while(i < sql.length && /[0-9.eE+-]/.test(sql[i])) {
				value += sql[i];
				i += 1;
			}
			tokens.push({ type: 'number', value });
			continue;
		}

		if(/[A-Za-z_]/.test(char)) {
			let value = '';
			while(i < sql.length && /[A-Za-z0-9_]/.test(sql[i])) {
				value += sql[i];
				i += 1;
			}
			tokens.push({ type: 'word', value });
			continue;
		}

		tokens.push({ type: 'punct', value: char });
		i += 1;
	}

	return tokens;
}

function tokensToSql(tokens: Token[]): string {
	return tokens
		.map((token) => {
			if(token.type === 'ident') {
				return `"${token.value}"`;
			}
			if(token.type === 'string') {
				return `'${token.value.replace(/'/g, '\'\'')}'`;
			}
			return token.value;
		})
		.join(' ');
}

function firstIdentAfter(tokens: Token[], word: string): string | null {
	const index = tokens.findIndex(
		(token) => token.type === 'word' && token.value.toUpperCase() === word,
	);
	if(index < 0) {
		return null;
	}
	return identValue(tokens[index + 1]);
}

function identValue(token: Token | undefined): string | null {
	if(!token) {
		return null;
	}
	if(token.type === 'ident' || token.type === 'word') {
		return token.value;
	}
	return null;
}

function isWord(token: Token | undefined, value: string): boolean {
	return Boolean(token && token.type === 'word' && token.value.toUpperCase() === value.toUpperCase());
}

function indexOfAnyWord(tokens: Token[], words: string[]): number {
	const wanted = new Set(words.map((word) => word.toUpperCase()));
	return tokens.findIndex(
		(token) => token.type === 'word' && wanted.has(token.value.toUpperCase()),
	);
}

function indexOfSequence(tokens: Token[], sequence: string[]): number {
	for(let i = 0; i <= tokens.length - sequence.length; i += 1) {
		const matches = sequence.every((word, offset) => isWord(tokens[i + offset], word));
		if(matches) {
			return i;
		}
	}
	return -1;
}

function sliceParens(tokens: Token[], openIndex: number): Token[] {
	let depth = 0;
	for(let i = openIndex; i < tokens.length; i += 1) {
		const token = tokens[i];
		if(token.type === 'punct' && token.value === '(') {
			depth += 1;
		}
		else if(token.type === 'punct' && token.value === ')') {
			depth -= 1;
			if(depth === 0) {
				return tokens.slice(openIndex + 1, i);
			}
		}
	}
	return tokens.slice(openIndex + 1);
}

function splitTopLevel(tokens: Token[], separator: string): Token[][] {
	const parts: Token[][] = [];
	let current: Token[] = [];
	let depth = 0;

	for(const token of tokens) {
		if(token.type === 'punct' && token.value === '(') {
			depth += 1;
		}
		else if(token.type === 'punct' && token.value === ')') {
			depth -= 1;
		}

		if(depth === 0 && token.type === 'punct' && token.value === separator) {
			parts.push(current);
			current = [];
			continue;
		}

		current.push(token);
	}

	if(current.length > 0) {
		parts.push(current);
	}

	return parts;
}

export function jsonValueForColumn(
	column: ColumnDef,
	placeholder = '__SEED_TODO__',
): unknown {
	if(column.omitFromSeed) {
		return undefined;
	}
	if(column.defaultValue !== undefined) {
		return column.defaultValue;
	}
	if(!column.notNull) {
		return null;
	}

	const pgType = column.pgType.toUpperCase();
	if(pgType.includes('[]')) {
		return [];
	}

	return placeholder;
}
