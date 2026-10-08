/**
 * Команда открытия формы записи: во вкладке либо в модальном окне поверх страницы.
 *
 * Режим указывает место вызова, а конфигурация объекта задаёт только умолчание для новой записи.
 * Общего состояния «как открывать записи этого объекта» нет: страницы всех вкладок остаются
 * смонтированными, и если бы страница меняла такое состояние при монтировании, результат зависел
 * бы от порядка монтирования.
 *
 * Вкладку определяет адрес, поэтому в режиме вкладки команда только переходит по адресу записи.
 * У окна адреса нет: его показывает ближайшая область окна, которая передаёт сюда свою команду
 * через контекст. Сам компонент окна лежит вне SDK, потому что собран из стандартной формы,
 * а она импортирует SDK.
 */
import { createContext, useCallback, useContext } from 'react';
import { useNavigate } from 'react-router';
import type { RecordOpeningMode } from '../../server/ui/descriptions';
import { newRecordPath, recordPath } from '../common/paths';
import { findObjectView, useMetadata } from '../data-provider/metadata';
import type { PerformTarget } from '../data-provider/perform';

/**
 * Открывает форму записи объекта. `guid`, равный `null`, открывает форму новой записи.
 *
 * Без `mode` новая запись открывается в режиме создания из описания формы объекта, существующая
 * во вкладке. В режиме вкладки команда переходит по адресу записи и возвращает `null`: вкладка
 * о записи не сообщает. В режиме окна результат приходит, когда окно закрыто: `guid` записи,
 * которую в нём записали, либо `null`, если окно закрыто без записи.
 *
 * Режим окна доступен только на странице, показанной в области окна; вне её вызов завершается ошибкой.
 */
export type OpenRecord = (object: PerformTarget, guid: string | null, mode?: RecordOpeningMode) => Promise<string | null>;

/** Команда области окна, которая показывает форму записи в модальном окне и возвращает итог его работы. */
export type OpenRecordDialog = (object: PerformTarget, guid: string | null) => Promise<string | null>;

/** Команда ближайшей области окна, способной показать модальное окно с формой. Вне такой области `null`. */
export const RecordDialogContext = createContext<OpenRecordDialog | null>(null);

/** Команда открытия формы записи. Функция постоянна, пока не изменились описания объектов и область окна. */
export function useOpenRecord(): OpenRecord {
    const navigate = useNavigate();
    const openDialog = useContext(RecordDialogContext);
    const metadata = useMetadata().data;
    return useCallback(
        async (object, guid, mode) => {
            const creationMode = findObjectView(metadata, object)?.form?.creationMode ?? 'tab';
            if ((mode ?? (guid === null ? creationMode : 'tab')) === 'tab') {
                await navigate(guid === null ? newRecordPath(object) : recordPath(object, guid));
                return null;
            }
            if (openDialog === null) throw new Error('Окно с формой записи открывается только со страницы, показанной в области окна');
            return openDialog(object, guid);
        },
        [metadata, navigate, openDialog],
    );
}
