/**
 * Подсказки записей для полей выбора: единственное место, где задано, какие записи и каким
 * запросом предлагаются пользователю.
 *
 * Поле ссылки предлагает записи одного объекта, составное поле записи всех своих целей. Правила
 * у них общие: помеченные на удаление записи не предлагаются, порядок задаёт сортировка объекта
 * по умолчанию, текст ищется в представлении записи, а число подсказок ограничено. Поэтому запрос
 * строит этот хук, а поле ввода передаёт только объекты и введённый текст.
 *
 * Подсказки всех объектов читаются одним запросом к единому эндпоинту: пакетом действий `list`,
 * по одному на объект. Хук Refine `useList` для этого не подходит: число объектов заранее
 * неизвестно, а вызывать хук в цикле нельзя.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ObjectReferenceValue } from '../../server/metadata/descriptions';
import type { ObjectView } from '../../server/ui/descriptions';
import type { ReferencePresentations } from '../../server/ui/reference-presentation';
import { useDebounced } from '../common/debounced';
import { findObjectView, useMetadata } from '../data-provider/metadata';
import { performBatch, resourceName } from '../data-provider/perform';
import { recordGuid, type RecordData } from '../data-provider/records';
import { listRecordPresentation, noAccessText } from './presentation';

/** Сколько записей каждого объекта предлагается на выбор. Остальные пользователь находит, уточняя текст. */
const suggestionCount = 20;

/** Задержка поиска после ввода, в миллисекундах: запрос уходит, когда пользователь перестал печатать. */
const searchDelay = 300;

/** Страница действия `list` в том виде, в каком её отдаёт сервер. */
interface SuggestionPage {
    readonly items: ReadonlyArray<RecordData>;
    readonly presentations: ReferencePresentations;
}

/** Предложенная запись: полная ссылка на неё и текст, которым она показана. */
export interface RecordSuggestion {
    /** Ключ, уникальный среди подсказок всех объектов: вид, имя объекта и `guid` через косую черту. */
    readonly key: string;
    readonly reference: ObjectReferenceValue;
    readonly label: string;
}

/** Подсказки одного объекта в порядке его сортировки по умолчанию. */
export interface RecordSuggestionGroup {
    readonly object: ObjectView;
    readonly suggestions: ReadonlyArray<RecordSuggestion>;
}

/** Ключ подсказки по ссылке на запись. */
export function recordSuggestionKey(reference: ObjectReferenceValue): string {
    return `${reference.kind}/${reference.name}/${reference.guid}`;
}

/**
 * Читает подсказки записей перечисленных объектов по введённому тексту. Объекты должны быть
 * доступны пользователю для чтения: пакет выполняется целиком, и отказ по одному объекту оставил бы
 * без подсказок все остальные. Пока `enabled` ложно, запросы не отправляются: форма с десятком
 * полей выбора не должна читать записи, пока ни один список не открыт. При каждом включении
 * подсказки читаются заново, поэтому только что созданная запись сразу доступна для выбора.
 *
 * Группы возвращаются в порядке объектов, в том числе пустые. Массив `objects` должен сохранять
 * ссылку между отрисовками, иначе группы пересоздаются при каждой из них.
 */
export function useRecordSuggestions(objects: ReadonlyArray<ObjectView>, search: string, enabled: boolean): { readonly groups: ReadonlyArray<RecordSuggestionGroup>; readonly loading: boolean } {
    const metadata = useMetadata().data;
    const searched = useDebounced(search.trim(), searchDelay);
    const { data: pages, isFetching } = useQuery({
        queryKey: ['recordSuggestions', objects.map(resourceName), searched],
        queryFn: () => performBatch<SuggestionPage>(objects.map((object) => ({
            target: { kind: object.kind, name: object.name },
            action: 'list',
            payload: {
                // Помеченную на удаление запись выбрать заново нельзя. Уже сделанная ссылка на неё остаётся в силе.
                filter: object.list.deletionMark ? [{ field: 'deletedAt', operator: 'equals', value: null }] : [],
                sort: object.list.defaultSort,
                // Составное представление может использовать строки и ссылки; его отбирает сервер до выбора страницы.
                ...(searched === '' ? {} : { presentation: searched }),
                page: 1,
                pageSize: suggestionCount,
            },
        }))),
        enabled: enabled && objects.length > 0,
        staleTime: 0,
    });
    const groups = useMemo(() => objects.map((object, index): RecordSuggestionGroup => {
        // Без права читать целевой объект представления по ссылке сервер текста не даёт.
        const presentable = object.presentation === null || findObjectView(metadata, object.presentation.target) !== undefined;
        return {
            object,
            suggestions: (pages?.[index]?.items ?? []).map((record) => {
                const reference: ObjectReferenceValue = { kind: object.kind === 'document' ? 'document' : 'catalog', name: object.name, guid: recordGuid(record) };
                return { key: recordSuggestionKey(reference), reference, label: presentable ? listRecordPresentation(object, record, pages?.[index]?.presentations) : noAccessText };
            }),
        };
    }), [objects, pages, metadata]);
    return { groups, loading: isFetching };
}
