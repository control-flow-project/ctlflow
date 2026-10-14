import schemaDefinition from '@ctlflow/crossfire-data/sqlite/schema' with { type: 'json' };
export const enrollmentArchiveSchema = schemaDefinition.parts.enrollmentArchiveSchema;

export const enrollmentArchiveGuards = schemaDefinition.parts.enrollmentArchiveGuards;

export const controllerRunGuards = schemaDefinition.parts.controllerRunGuards;

export const nativeStopSchema = schemaDefinition.parts.nativeStopSchema;
