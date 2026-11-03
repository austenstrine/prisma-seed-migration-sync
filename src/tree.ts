export function walkRecords(
	records: Record<string, unknown>[],
	childrenField = 'children',
	visit: (record: Record<string, unknown>) => void,
): void {
	for(const record of records) {
		visit(record);
		const children = record[childrenField];
		if(Array.isArray(children)) {
			walkRecords(children as Record<string, unknown>[], childrenField, visit);
		}
	}
}

export function flattenTree(
	records: Record<string, unknown>[],
	options: {
		identityField: string;
		parentRelation: string;
		childrenField?: string;
	},
): Record<string, unknown>[] {
	const childrenField = options.childrenField ?? 'children';
	const flat: Record<string, unknown>[] = [];

	const walk = (
		nodes: Record<string, unknown>[],
		parentIdentity: unknown,
	) => {
		for(const node of nodes) {
			const children = node[childrenField];
			const copy: Record<string, unknown> = { ...node };
			delete copy[childrenField];
			if(parentIdentity != null) {
				copy[options.parentRelation] = {
					[options.identityField]: parentIdentity,
				};
			}
			flat.push(copy);
			if(Array.isArray(children)) {
				walk(
					children as Record<string, unknown>[],
					node[options.identityField],
				);
			}
		}
	};

	walk(records, null);
	return flat;
}
