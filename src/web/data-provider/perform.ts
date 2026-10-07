/**
 * Вызов единого эндпоинта `POST /api/perform` и соответствие между ресурсами Refine и целями операций.
 *
 * Refine называет ресурс одной строкой, а сервер различает объекты по виду и имени: имена
 * уникальны только внутри вида, и в конфигурации есть, например, справочник и документ `sample`.
 * Поэтому имя ресурса состоит из вида и имени через точку: `catalog.sample`. В таком же виде
 * объект называют ключи прав и сообщения сервера. В именах объектов точки быть не может,
 * поэтому имя ресурса разбирается однозначно.
 */
import { request } from '../common/api';

/** Цель операции: объект конфигурации либо служебная цель платформы, например журнал `{ kind: 'platform', name: 'journal' }`. */
export interface PerformTarget {
    readonly kind: string;
    readonly name: string;
}

/** Операция единого эндпоинта. `payload` можно не указывать, если у действия нет входных данных. */
export interface PerformOperation {
    readonly target: PerformTarget;
    readonly action: string;
    readonly payload?: unknown;
}

/**
 * Выполняет одну операцию от имени вошедшего пользователя и возвращает её результат.
 * Отказ сервера завершается `ApiError`: 400 — неверные данные, 403 — нет права, 404 — нет объекта,
 * действия или записи, 409 — изменение запретила политика.
 */
export function perform<Result>(operation: PerformOperation): Promise<Result> {
    return request<Result>({ method: 'POST', url: '/perform', data: operation });
}

/**
 * Выполняет пакет операций одним запросом и возвращает их результаты в исходном порядке.
 * Сервер выполняет пакет в одной транзакции, поэтому отказ в одной операции завершает
 * `ApiError` весь пакет. Пустой пакет сервер отклоняет.
 */
export function performBatch<Result>(operations: ReadonlyArray<PerformOperation>): Promise<ReadonlyArray<Result>> {
    return request<ReadonlyArray<Result>>({ method: 'POST', url: '/perform', data: operations });
}

/** Имя ресурса Refine для цели операции: `catalog.sample`. */
export function resourceName(target: PerformTarget): string {
    return `${target.kind}.${target.name}`;
}

/** Цель операции по имени ресурса Refine. Имя другого вида — ошибка вызывающего кода. */
export function resourceTarget(resource: string): PerformTarget {
    const [kind, name, ...rest] = resource.split('.');
    if (kind === undefined || kind === '' || name === undefined || name === '' || rest.length > 0) {
        throw new Error(`Имя ресурса «${resource}» должно состоять из вида и имени объекта через точку, например catalog.sample`);
    }
    return { kind, name };
}
