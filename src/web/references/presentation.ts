/**
 * Представление записи: текст, по которому человек узнаёт запись.
 *
 * Ссылка хранит `guid`, который пользователю ничего не говорит, поэтому везде вместо него
 * выводится представление. Общий формат используется сервером и клиентом; в списке
 * сервер передаёт актуальные представления вместе со страницей, а вне списка клиент читает запись.
 *
 * Справочник с представлением по ссылке называется представлением другой записи. Вне списка
 * клиент читает её вторым чтением тем же общим пакетом `get`: цепочек нет, поэтому чтений
 * не больше двух, и каждое объединяет все ссылки страницы.
 */
import { useMany } from '@refinedev/core';
import type { ObjectView } from '../../server/ui/descriptions';
import type { ApiError } from '../common/api';
import { useObjectView } from '../data-provider/metadata';
import { resourceName } from '../data-provider/perform';
import type { RecordData } from '../data-provider/records';
import { createContext, useContext } from 'react';
import {
    presentationSource,
    recordPresentation as formatPresentation,
    referenceKey,
    type ReferencePresentations,
} from '../../server/ui/reference-presentation';

/** Представления текущей страницы; вне списка ссылки используют обычное чтение записи. */
export const ListPresentationsContext = createContext<ReferencePresentations | undefined>(undefined);

/** Текст на месте представления, для которого нужен объект, недоступный пользователю для чтения. */
export const noAccessText = 'Нет доступа';

/** Текст на месте представления, которого сервер не дал: записи нет либо она недоступна. */
const unavailableText = 'Запись недоступна';

/**
 * Собственное представление записи справочника или документа. У справочника это наименование,
 * у документа: «<заголовок объекта> № <номер> от <дата>». Представление по ссылке функция
 * не учитывает: целевой записи у неё нет. Текст, которым запись показана пользователю,
 * возвращает `useRecordPresentation`.
 */
export function recordPresentation(object: ObjectView, record: RecordData): string {
    return formatPresentation({ kind: object.kind === 'document' ? 'document' : 'catalog', name: object.name, title: object.title }, record);
}

/**
 * Заголовок формы записи по её представлению. У новой записи представления ещё нет, и вместо него
 * передаётся `null`. Представление документа уже начинается с заголовка объекта, поэтому второй
 * раз заголовок перед ним не пишется.
 */
export function recordTitle(object: ObjectView, presentation: string | null): string {
    if (presentation === null) return `${object.title}: новая запись`;
    return object.kind === 'document' ? presentation : `${object.title}: ${presentation}`;
}

/**
 * Представление записи из страницы списка её объекта: подпись записи в списке выбора. Собственное
 * представление строится из записи. Представление по ссылке берётся из представлений страницы:
 * поле-источник входит в колонки списка, поэтому сервер уже прочитал целевые записи пакетом.
 */
export function listRecordPresentation(object: ObjectView, record: RecordData, presentations: ReferencePresentations | undefined): string {
    if (object.presentation === null) return recordPresentation(object, record);
    const source = presentationSource(object.presentation, record);
    return (source === null ? null : presentations?.[referenceKey(source)]) ?? unavailableText;
}

/**
 * Сколько миллисекунд прочитанная по ссылке запись считается свежей. В этот срок та же запись
 * повторно не запрашивается, даже если ссылка на неё встретилась на другой странице. Изменение
 * записи самим пользователем сбрасывает сохранённые ответы раньше срока, а чужое изменение
 * наименования вне списка пользователь увидит не позже чем через этот срок.
 * Список получает представления с сервера при каждом чтении страницы.
 */
const presentationStaleTime = 60_000;

/** Представление записи и состояние его загрузки. */
export interface ReferencePresentation {
    /** Текст для показа: представление записи, а пока оно загружается или не загрузилось, поясняющий текст. */
    readonly text: string;
    /** Запись прочитана, и `text` содержит её представление. */
    readonly loaded: boolean;
}

/**
 * Читает запись объекта по `guid` общим пакетом (`getMany` data provider) и хранит её в общем
 * кеше запросов. При `guid`, равном `null`, запрос не отправляется.
 */
function useRecordRead(object: ObjectView, guid: string | null) {
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
    return { record: guid === null ? undefined : query.data?.data[0], failed: query.isError };
}

/**
 * Представление уже прочитанной записи: так называется запись в заголовке своей формы и вкладки.
 * Собственное представление строится сразу. Для справочника с представлением по ссылке хук
 * читает целевую запись; пока она не прочитана, `text` содержит поясняющий текст. Если целевой
 * объект пользователю недоступен, запись не запрашивается и возвращается «Нет доступа».
 * При `record`, равном `null`, возвращает пустой текст.
 */
export function useRecordPresentation(object: ObjectView, record: RecordData | null): ReferencePresentation {
    const targetObject = useObjectView(object.presentation?.target ?? null);
    const source = record === null ? null : presentationSource(object.presentation, record);
    // Хук чтения вызывается всегда; без целевого объекта чтение отключено, и ресурс значения не имеет.
    const target = useRecordRead(targetObject ?? object, targetObject === undefined ? null : source?.guid ?? null);
    if (record === null) return { text: '', loaded: false };
    if (object.presentation === null) return { text: recordPresentation(object, record), loaded: true };
    if (targetObject === undefined) return { text: noAccessText, loaded: false };
    if (source === null) return { text: unavailableText, loaded: false };
    if (target.record !== undefined) return { text: recordPresentation(targetObject, target.record), loaded: true };
    return { text: target.failed ? 'Не удалось прочитать запись' : 'Загрузка…', loaded: false };
}

/**
 * Читает запись по ссылке и возвращает её представление. Записи всех ссылок страницы читаются
 * одним запросом и хранятся в общем кеше запросов. При `guid`, равном `null`, запрос
 * не отправляется. В списке приоритет имеют представления его страницы: они уже учитывают права
 * и состояние данных на момент серверного поиска. Если запись называется по ссылке на объект,
 * который пользователю недоступен, возвращается «Нет доступа», как у ссылки на недоступный объект.
 */
export function useReferencePresentation(object: ObjectView, guid: string | null): ReferencePresentation {
    const presentations = useContext(ListPresentationsContext);
    const targetObject = useObjectView(object.presentation?.target ?? null);
    const accessible = object.presentation === null || targetObject !== undefined;
    const key = guid === null ? null : referenceKey({ kind: object.kind === 'document' ? 'document' : 'catalog', name: object.name, guid });
    const fromList = key !== null && presentations !== undefined && Object.hasOwn(presentations, key);
    const own = useRecordRead(object, fromList || !accessible ? null : guid);
    const presentation = useRecordPresentation(object, own.record ?? null);
    if (guid === null) return { text: '', loaded: false };
    if (!accessible) return { text: noAccessText, loaded: false };
    if (key !== null && presentations !== undefined && fromList) {
        const text = presentations[key];
        return { text: text ?? unavailableText, loaded: text !== null && text !== undefined };
    }
    if (own.record !== undefined) return presentation;
    return { text: own.failed ? 'Не удалось прочитать запись' : 'Загрузка…', loaded: false };
}
