import { journalColumns } from './20260929_journal_columns.js';
import { removeCatalogCode } from './20261007_remove_catalog_code.js';
import { externalRecordReference } from './20261007_external_record_reference.js';
import { installmentPaymentColumns } from './20261012_installment_payment_columns.js';
import { removeInstallment } from './20261015_remove_installment.js';
import { renameRegisters } from './20261016_rename_registers.js';
import type { SchemaStructure } from '../structure.js';

/** Разрешённые изменения и SQL-команды миграции, построенные по снимку конкретной базы. */
export interface MigrationPlan {
    readonly changes: readonly string[];
    readonly statements: readonly string[];
}

/**
 * Явная миграция для изменений, которые нельзя вывести из нового описания объекта.
 * `changes` перечисляет разрешённые изменения снимка; `statements` выполняются по порядку
 * в общей транзакции. Для переноса данных используйте отдельные SQL-запросы до удаления колонок.
 */
export interface SchemaMigration {
    /** Уникальный идентификатор в возрастающем лексикографическом порядке, например `20260929_rename_field`. */
    readonly id: string;
    /** Часть приложения, изменение которой потребовало миграции. */
    readonly part: 'platform' | 'configuration';
    /** Версия этой части, в релизе которой появилась миграция: `x.y.0`, потому что миграция повышает `x` или `y`. */
    readonly version: string;
    /** Ключи изменений из сообщения об остановке запуска. */
    readonly changes: readonly string[];
    /** SQL-команды без пользовательских значений. */
    readonly statements: readonly string[];
    /**
     * Строит команды для объектов конкретной базы до открытия транзакции миграции.
     * Функция не обращается к базе; полученный план заменяет changes и statements.
     */
    readonly prepare?: (previous: SchemaStructure, desired: SchemaStructure) => MigrationPlan;
}

/**
 * Реестр миграций. Добавляйте сюда импорт нового файла и его значение в порядке `id`.
 * Статический импорт включает миграции и в исполняемый файл без доступа к исходникам.
 */
export const migrations: readonly SchemaMigration[] = [journalColumns, externalRecordReference, removeCatalogCode, installmentPaymentColumns, removeInstallment, renameRegisters];
