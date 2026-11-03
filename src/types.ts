export type SeedFormat = 'table' | 'tree';

export type SeedFileHeader = {
	model?: string;
	format?: SeedFormat;
	maintain?: boolean;
	parentRelation?: string;
	identityField?: string;
	/** Optional compound unique used for upsert, e.g. ["vendorId", "slug"]. */
	identityFields?: string[];
	childrenField?: string;
	/** Lower runs first. Default 100. Use this when FK order differs from filename sort. */
	applyOrder?: number;
};

export type SeedFile = {
	$prismaJsonSeed: SeedFileHeader;
	records?: Record<string, unknown>[];
	[extra: string]: unknown;
};

export type SeedSyncConfig = {
	pack: string;
	schema: string;
	migrations: string;
	omitFields: string[];
	placeholder: string;
	skipFiles: string[];
	appliedMigrations: string[];
};

export type SyncOptions = {
	seedDir: string;
	migrationsPath?: string;
	dryRun?: boolean;
};

export type SeedEdit = {
	file: string;
	model: string;
	migration?: string;
	kind:
		| 'add-field'
		| 'remove-field'
		| 'rename-field'
		| 'rename-model'
		| 'rename-enum-value'
		| 'skip-file'
		| 'skip-change'
		| 'baseline';
	field?: string;
	from?: string;
	to?: string;
	value?: unknown;
	records: number;
	detail: string;
};

export type SyncResult = {
	dryRun: boolean;
	pendingMigrations: string[];
	baselined: boolean;
	appliedMigrations: string[];
	edits: SeedEdit[];
	changedFiles: string[];
	skippedFiles: string[];
	warnings: string[];
};

export type ValidateIssue = {
	file: string;
	message: string;
};

export type ValidateResult = {
	ok: boolean;
	issues: ValidateIssue[];
	pendingMigrations: string[];
};

export type PrismaLike = object;

/** Optional checksum store. Must not be a Postgres table Prisma Migrate does not own. */
export type SeedApplyStore = {
	read(pack: string): Promise<string | null>;
	write(pack: string, checksum: string): Promise<void>;
};

export type ApplyOptions = {
	prisma: PrismaLike;
	seedDir: string;
	force?: boolean;
	store?: SeedApplyStore;
};

export type ApplyResult = {
	skipped: boolean;
	pack: string;
	upserted: number;
};

export type MigrationChange =
	| {
			kind: 'create-table';
			table: string;
			columns: ColumnDef[];
		}
	| {
			kind: 'drop-table';
			table: string;
		}
	| {
			kind: 'rename-table';
			from: string;
			to: string;
		}
	| {
			kind: 'add-column';
			table: string;
			column: ColumnDef;
		}
	| {
			kind: 'drop-column';
			table: string;
			column: string;
		}
	| {
			kind: 'rename-column';
			table: string;
			from: string;
			to: string;
		}
	| {
			kind: 'set-column-default';
			table: string;
			column: string;
			value: unknown;
			omit: boolean;
		}
	| {
			kind: 'rename-enum-value';
			enumName: string;
			from: string;
			to: string;
		};

export type ColumnDef = {
	name: string;
	pgType: string;
	notNull: boolean;
	defaultValue?: unknown;
	omitFromSeed: boolean;
};
