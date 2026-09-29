import { Context } from 'effect';
import type { ObjectDescription, ObjectKind } from './descriptions.js';

/**
 * Описания объектов конфигурации, доступные бизнес-логике через окружение Effect.
 * Диспетчер передаёт сюда экземпляр `MetadataService`, так же как передаёт `Database`,
 * поэтому шаги проведения, обработчики проведения и собственные действия читают
 * метаданные без ссылки на Nest-сервис.
 */
export interface Metadata {
    /** Описания всех объектов конфигурации в порядке файлов реестра. */
    readonly objects: ReadonlyArray<ObjectDescription>;
    /** Описание объекта по виду и имени или `undefined`, если такого объекта нет в конфигурации. */
    find(kind: ObjectKind, name: string): ObjectDescription | undefined;
}

/** Тег для передачи метаданных из Nest-провайдера в окружение бизнес-логики Effect. */
export const Metadata = Context.Service<Metadata>('Metadata');
