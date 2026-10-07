/**
 * Записи объектов на клиенте и их чтение по `guid` общим пакетом.
 *
 * Страница со ссылками показывает вместо каждого `guid` представление записи, поэтому ей нужны
 * десятки записей разных объектов. Действие `list` не отбирает по нескольким значениям сразу,
 * а отдельный запрос на каждую запись был бы слишком частым. Поэтому чтения, начатые за один
 * проход отрисовки, собираются в один пакет действий `get` единого эндпоинта.
 */
import { performBatch, resourceTarget, type PerformOperation } from './perform';

/**
 * Запись объекта в том виде, в каком её отдаёт сервер: значения полей по именам, а у записи,
 * прочитанной действием `get`, ещё и строки табличных частей. У справочников и документов
 * есть `guid` и `deletedAt`, у строк регистра их нет.
 */
export type RecordData = { readonly [field: string]: unknown };

/** Идентификатор записи справочника или документа. У строки регистра его нет, и вызывать функцию для неё нельзя. */
export function recordGuid(record: RecordData): string {
    return String(record['guid']);
}

interface WaitingRead {
    readonly key: string;
    readonly operation: PerformOperation;
    readonly resolve: (record: RecordData) => void;
    readonly reject: (error: unknown) => void;
}

/** Чтения, которые ждут отправки общего пакета. */
let waiting: Array<WaitingRead> = [];

/**
 * Читает запись ресурса по `guid`. Запрос уходит не сразу: чтения, начатые до следующего
 * оборота цикла событий, отправляются одним пакетом. Пакет выполняется целиком или не выполняется
 * вовсе, поэтому отказ в одной записи завершает ошибкой все чтения пакета. Для ссылок это
 * допустимо: записи не удаляются физически, а объекты без права чтения клиент не запрашивает.
 */
export function loadRecord(resource: string, guid: string): Promise<RecordData> {
    return new Promise((resolve, reject) => {
        const operation = { target: resourceTarget(resource), action: 'get', payload: { guid } };
        // Таймер с нулевой задержкой срабатывает после всех эффектов текущей отрисовки: к этому
        // моменту свои чтения успевают начать все ячейки страницы.
        if (waiting.length === 0) setTimeout(sendWaiting, 0);
        waiting.push({ key: `${resource}/${guid}`, operation, resolve, reject });
    });
}

async function sendWaiting(): Promise<void> {
    const reads = waiting;
    waiting = [];
    // Одна и та же запись может понадобиться нескольким ячейкам: в пакет она входит один раз.
    const operations = new Map(reads.map((read) => [read.key, read.operation]));
    try {
        const records = await performBatch<RecordData>([...operations.values()]);
        const byKey = new Map([...operations.keys()].map((key, index) => [key, records[index]]));
        for (const read of reads) {
            const record = byKey.get(read.key);
            if (record === undefined) read.reject(new Error('Сервер вернул не все записи пакета'));
            else read.resolve(record);
        }
    } catch (error) {
        for (const read of reads) read.reject(error);
    }
}
