/**
 * Представление записи: текст, по которому человек узнаёт запись.
 *
 * Ссылка хранит `guid`, который пользователю ничего не говорит, поэтому везде вместо него
 * выводится представление. Оно вычисляется на клиенте по описанию объекта и записи только
 * здесь: в поле ссылки, в ячейке списка, в колонке регистратора и в заголовке формы запись
 * называется одинаково.
 */
import { useMany } from '@refinedev/core';
import type { ObjectView } from '../../server/ui/descriptions';
import type { ApiError } from '../common/api';
import { resourceName } from '../data-provider/perform';
import type { RecordData } from '../data-provider/records';
import { formatDate } from '../widgets/format';

/**
 * Представление записи справочника или документа. У справочника это наименование, у документа:
 * «<заголовок объекта> № <номер> от <дата>».
 */
export function recordPresentation(object: ObjectView, record: RecordData): string {
    if (object.kind === 'document') {
        const date = record['date'];
        return `${object.title} № ${String(record['number'] ?? '')} от ${typeof date === 'string' ? formatDate(date) : ''}`;
    }
    return String(record['name'] ?? '');
}

/**
 * Заголовок формы записи. У новой записи представления ещё нет. Представление документа уже
 * начинается с заголовка объекта, поэтому второй раз заголовок перед ним не пишется.
 */
export function recordTitle(object: ObjectView, record: RecordData | null): string {
    if (record === null) return `${object.title}: новая запись`;
    return object.kind === 'document' ? recordPresentation(object, record) : `${object.title}: ${recordPresentation(object, record)}`;
}

/**
 * Сколько миллисекунд прочитанная по ссылке запись считается свежей. В этот срок та же запись
 * повторно не запрашивается, даже если ссылка на неё встретилась на другой странице. Изменение
 * записи самим пользователем сбрасывает сохранённые ответы раньше срока, а чужое изменение
 * наименования пользователь увидит не позже чем через этот срок.
 */
const presentationStaleTime = 60_000;

/** Представление записи, на которую ведёт ссылка, и состояние его загрузки. */
export interface ReferencePresentation {
    /** Текст для показа: представление записи, а пока оно загружается или не загрузилось, поясняющий текст. */
    readonly text: string;
    /** Запись прочитана, и `text` содержит её представление. */
    readonly loaded: boolean;
}

/**
 * Читает запись по ссылке и возвращает её представление. Записи всех ссылок страницы читаются
 * одним запросом (`getMany` data provider) и хранятся в общем кеше запросов. При `guid`, равном
 * `null`, запрос не отправляется.
 */
export function useReferencePresentation(object: ObjectView, guid: string | null): ReferencePresentation {
    const { query } = useMany<RecordData, ApiError>({
        resource: resourceName(object),
        ids: guid === null ? [] : [guid],
        queryOptions: {
            enabled: guid !== null,
            staleTime: presentationStaleTime,
            // Общая настройка клиента запросов оставляет на экране прежние данные, пока идёт запрос.
            // Для ссылки это показало бы представление другой записи.
            placeholderData: () => undefined,
        },
        // Ошибку показывает само место ссылки, а уведомление на каждую ячейку списка было бы лишним.
        errorNotification: false,
    });
    const record = query.data?.data[0];
    if (guid === null) return { text: '', loaded: false };
    if (record !== undefined) return { text: recordPresentation(object, record), loaded: true };
    return { text: query.isError ? 'Не удалось прочитать запись' : 'Загрузка…', loaded: false };
}
