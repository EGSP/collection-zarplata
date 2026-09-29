/** DSL описания объектов конфигурации: билдеры, описания и схемы входных данных. */
export {
    ActionBuilder,
    ActionInputBuilder,
    catalog,
    document,
    FormBuilder,
    isObjectBuilder,
    movements,
    register,
    TablePartBuilder,
    type ActionHandler,
    type MovementOf,
    type CatalogBuilder,
    type DocumentBuilder,
    type ObjectBuilder,
    type ObjectRecord,
    type PostingHandler,
    type RecordObjectBuilder,
    type RecordOf,
    type RegisterBuilder,
    type TablePartMap,
    type WritePolicy,
} from './builders.js';
export { commitConfiguration } from './commit.js';
export type * from './descriptions.js';
export { FieldFactory, type FieldMap, type FieldsRecord, type ReferenceTarget } from './fields.js';
export { MetadataError, type MetadataProblem } from './metadata.errors.js';
export { loadConfiguration, type ConfigurationModule } from './registry.js';
export { actionInputSchema, fieldSchema, fieldsSchema, inputSchema } from './schema.js';
export { standardFields, type StandardFields } from './standard-fields.js';
