/**
 * Команда открытия формы записи: во вкладке либо в модальном окне поверх страницы.
 *
 * Режим указывает место вызова, а конфигурация объекта задаёт только умолчание для новой записи.
 * Общего состояния «как открывать записи этого объекта» нет: страницы всех вкладок остаются
 * смонтированными, и если бы страница меняла такое состояние при монтировании, результат зависел
 * бы от порядка монтирования.
 *
 * Существующую запись перед открытием разрешает серверное правило; затем вкладку определяет адрес.
 * У окна адреса нет: его показывает ближайшая область окна, которая передаёт сюда свою команду
 * через контекст. Сам компонент окна лежит вне SDK, потому что собран из стандартной формы,
 * а она импортирует SDK.
 */
import { createContext, useCallback, useContext } from 'react';
import { App } from 'antd';
import { useNavigate } from 'react-router';
import type { RecordOpeningMode } from '../../server/ui/descriptions';
import { newRecordDraftPath, newRecordPath, recordPath } from '../common/paths';
import { findObjectView, useMetadata } from '../data-provider/metadata';
import type { PerformTarget } from '../data-provider/perform';
import type { FormValues } from './record-values';
import { resolveRecordOpening } from '../data-provider/record-opening';

/**
 * Открывает форму записи объекта. `guid`, равный `null`, открывает форму новой записи.
 *
 * Без `mode` новая запись открывается в режиме создания из описания формы объекта, существующая
 * во вкладке. В режиме вкладки команда переходит по адресу записи и возвращает `null`: вкладка
 * о записи не сообщает. В режиме окна результат приходит, когда окно закрыто: `guid` записи,
 * которую в нём записали, либо `null`, если окно закрыто без записи.
 *
 * Режим окна доступен только на странице, показанной в области окна; вне её вызов завершается ошибкой.
 *
 * `options` задают значения новой записи и ширину модального окна.
 */
export type OpenRecord = (object: PerformTarget, guid: string | null, mode?: RecordOpeningMode, options?: OpenRecordOptions) => Promise<string | null>;

/** Настройки выбора записи и её формы во вкладке или модальном окне. */
export interface OpenRecordOptions {
    /** Открыть исходную запись без правила конфигурации. Права чтения проверяются сервером. */
    readonly original?: boolean | undefined;
    /**
     * Значения новой записи поверх значений по умолчанию, например основание и товары продажи
     * из отвеса. Записываются и значения полей, которых на форме нет. У существующей записи
     * значения не учитываются.
     *
     * Вкладка со значениями открывается по адресу черновика (`newRecordDraftPath`): значения
     * остаются в памяти клиента под ключом из адреса. После перезагрузки страницы их нет,
     * и по такому адресу открывается пустая форма новой записи.
     */
    readonly initial?: FormValues | undefined;
    /**
     * Ширина модального окна в пикселях вместо обычных 720. Нужна широкой форме, например продаже
     * с таблицей товаров. Окно не шире области, в которой показано. Вкладка ширину не учитывает.
     */
    readonly width?: number | undefined;
}

/**
 * Команда области окна, которая показывает форму записи в модальном окне и возвращает итог его работы.
 * `initial` — значения новой записи поверх значений по умолчанию; у существующей записи не учитываются.
 * `width` — ширина окна вместо обычной.
 */
export type OpenRecordDialog = (object: PerformTarget, guid: string | null, initial?: FormValues, width?: number) => Promise<string | null>;

/** Значения черновиков новых записей по ключам из адресов вкладок. */
const drafts = new Map<string, FormValues>();

/**
 * Значения черновика по ключу из адреса вкладки. Ключ не удаляется при чтении: страница вкладки
 * может смонтироваться заново, а значений немного.
 */
export function draftValues(key: string): FormValues | undefined {
    return drafts.get(key);
}

/** Команда ближайшей области окна, способной показать модальное окно с формой. Вне такой области `null`. */
export const RecordDialogContext = createContext<OpenRecordDialog | null>(null);

/** Команда открытия формы записи. Функция постоянна, пока не изменились описания объектов и область окна. */
export function useOpenRecord(): OpenRecord {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const openDialog = useContext(RecordDialogContext);
    const metadata = useMetadata().data;
    return useCallback(
        async (object, guid, mode, options) => {
            // Создание не участвует в выборе цели. Существующая запись разрешается одинаково
            // для вкладки и окна; отказ показывается до перехода и не открывает исходную форму.
            if (guid !== null) {
                try {
                    const reference = await resolveRecordOpening(object, guid, options?.original);
                    object = reference;
                    guid = reference.guid;
                } catch (error) {
                    void message.error(error instanceof Error ? error.message : 'Не удалось открыть запись');
                    return null;
                }
            }
            const creationMode = findObjectView(metadata, object)?.form?.creationMode ?? 'tab';
            if ((mode ?? (guid === null ? creationMode : 'tab')) === 'tab') {
                if (guid === null && options?.initial !== undefined) {
                    const key = crypto.randomUUID();
                    drafts.set(key, options.initial);
                    await navigate(newRecordDraftPath(object, key));
                    return null;
                }
                await navigate(guid === null ? newRecordPath(object) : recordPath(object, guid, options?.original));
                return null;
            }
            if (openDialog === null) throw new Error('Окно с формой записи открывается только со страницы, показанной в области окна');
            return openDialog(object, guid, options?.initial, options?.width);
        },
        [metadata, navigate, openDialog, message],
    );
}
