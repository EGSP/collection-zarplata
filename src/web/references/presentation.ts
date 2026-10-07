/**
 * Представление записи: текст, по которому человек узнаёт запись.
 *
 * Ссылка хранит `guid`, который пользователю ничего не говорит, поэтому везде вместо него
 * выводится представление. Общий формат используется сервером и клиентом; в списке
 * сервер передаёт актуальные представления вместе со страницей, а вне списка клиент читает запись.
 */
import { useMany } from '@refinedev/core';
import type { ObjectView } from '../../server/ui/descriptions';
import type { ApiError } from '../common/api';
import { resourceName } from '../data-provider/perform';
import type { RecordData } from '../data-provider/records';
import { createContext, useContext } from 'react';
import { recordPresentation as formatPresentation, referenceKey, type ReferencePresentations } from '../../server/ui/reference-presentation';

/** Представления текущей страницы; вне списка ссылки используют обычное чтение записи. */
export const ListPresentationsContext = createContext<ReferencePresentations | undefined>(undefined);

/**
 * Представление записи справочника или документа. У справочника это наименование, у документа:
 * «<заголовок объекта> № <номер> от <дата>».
 */
export function recordPresentation(object: ObjectView, record: RecordData): string {
    return formatPresentation({ kind: object.kind === 'document' ? 'document' : 'catalog', name: object.name, title: object.title }, record);
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
 * наименования вне списка пользователь увидит не позже чем через этот срок.
 * Список получает представления с сервера при каждом чтении страницы.
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
 * `null`, запрос не отправляется. В списке приоритет имеют представления его страницы:
 * они уже учитывают права и состояние данных на момент серверного поиска.
 */
export function useReferencePresentation(object: ObjectView, guid: string | null): ReferencePresentation {
    const presentations = useContext(ListPresentationsContext);
    const key = guid === null ? null : referenceKey({ kind: object.kind === 'document' ? 'document' : 'catalog', name: object.name, guid });
    const fromList = key !== null && presentations !== undefined && Object.hasOwn(presentations, key);
    const { query } = useMany<RecordData, ApiError>({
        resource: resourceName(object),
        ids: guid === null ? [] : [guid],
        queryOptions: {
            enabled: guid !== null && !fromList,
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
    if (key !== null && presentations !== undefined && fromList) {
        const text = presentations[key];
        return { text: text ?? 'Запись недоступна', loaded: text !== null && text !== undefined };
    }
    if (record !== undefined) return { text: recordPresentation(object, record), loaded: true };
    return { text: query.isError ? 'Не удалось прочитать запись' : 'Загрузка…', loaded: false };
}
