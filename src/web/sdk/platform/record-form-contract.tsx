/**
 * Контракт формы записи с областью окна, в которой она показана.
 *
 * Область окна закрывает вкладку или модальное окно, спрашивает о несохранённых изменениях и после
 * записи меняет адрес вкладки, закрывает окно и отдаёт запись открывшему его коду. Для этого ей нужно
 * знать, есть ли на форме несохранённые изменения и когда форма записала или создала запись.
 *
 * Добровольные вызовы вроде `useUnsavedChanges` и `recordWritten` собственная форма может забыть,
 * и компилятор этого не заметит. Поэтому форма записи объявляет обработчики контракта хуком
 * `useRecordFormContract`, а выполнение действий и сообщения области берёт на себя хук:
 *
 * - пропущенный обработчик — ошибка проверки типов;
 * - форма, которая вовсе не вызвала хук, показывается областью как ошибка вместо формы;
 * - о записи, созданной записи и закрытии после действия область узнаёт от хука, а не от формы.
 *
 * Стандартная форма построена на этом же контракте через `useRecordForm`, поэтому поведение
 * собственной и стандартной форм в области окна одинаково.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { FormAction } from '../../../server/ui/descriptions';
import type { PerformTarget } from '../../data-provider/perform';
import { recordGuid, type RecordData } from '../../data-provider/records';
import { UnsavedChangesContext, useWindowScope } from '../../window/window-scope';
import type { FormElementComponent } from './form-data';
import type { FormValues } from './record-values';

/** Итог действия над записанной записью. */
export interface RecordFormOutcome {
    /** Запись в новом состоянии, если действие её вернуло или форма перечитала её; иначе `null`. */
    readonly record: RecordData | null;
    /** Результат действия: у стандартного это запись, у собственного ответ его обработчика. */
    readonly result: unknown;
}

/**
 * Обработчики, которые форма записи обязана предоставить области окна. Все обязательны: форма
 * без любого из них не проходит проверку типов.
 */
export interface RecordFormHandlers {
    /** Есть ли на форме несохранённые изменения. По нему область спрашивает подтверждение перед закрытием. */
    readonly changed: () => boolean;
    /**
     * Проверяет и записывает введённые значения поверх `record`, у новой записи `record` равен `null`.
     * Возвращает запись от сервера либо `null`, если запись не состоялась: ошибки форма уже показала.
     *
     * С `post` запись записывается и проводится одним запросом (стандартное действие `post`):
     * при отказе проведения запись не создаётся. Сервер возвращает проведённый документ.
     */
    readonly save: (record: RecordData | null, post?: FormAction) => Promise<RecordData | null>;
    /**
     * Выполняет действие, кроме записи, над записанной записью `record`. Записывать несохранённые
     * изменения не нужно: хук делает это до вызова. Отказ сервера завершает вызов ошибкой.
     */
    readonly perform: (action: FormAction, input: FormValues | null, record: RecordData) => Promise<RecordFormOutcome>;
    /**
     * Показывает запись, которую вернул сервер после записи или действия: форма заменяет ею значения
     * полей и сбрасывает признак несохранённых изменений.
     */
    readonly show: (record: RecordData) => void;
}

/**
 * Входные данные действия формы: значения либо функция, которая строит их по записанной записи.
 * Функция нужна новой записи: её `guid`, который требуется собственному действию, появляется
 * только после записи, которую `run` выполняет перед действием.
 *
 * ```ts
 * state.run(sell, (saved) => ({ sale: saved['guid'], person }));
 * ```
 */
export type RecordFormActionInput = FormValues | ((record: RecordData) => FormValues) | null;

/** Параметры выполнения действия формы. */
export interface RecordFormRunOptions {
    /** Закрыть область после успешного действия. При ошибке область остаётся открытой. */
    readonly close?: boolean;
    /**
     * Новый документ записывается и проводится одним запросом, когда выполняется стандартное
     * действие `post`: при отказе проведения запись не создаётся и форма остаётся с введёнными
     * значениями. Без параметра сначала создаётся запись, а затем проводится отдельным запросом,
     * и после отказа остаётся непроведённый документ. Для записанного документа не действует.
     */
    readonly atomic?: boolean;
}

/** То, что хук контракта возвращает форме. */
export interface RecordFormController {
    /** Записанное состояние: запись в том виде, в каком её последним вернул сервер. У новой записи `null`. */
    readonly record: RecordData | null;
    /** Имя действия, которое сейчас выполняется; на это время кнопки действий недоступны. */
    readonly running: string | null;
    /** Выполняется ли действие. Читается по ссылке, поэтому верен и в том же кадре, что и вызов `run`. */
    readonly isRunning: () => boolean;
    /**
     * Выполняет действие формы. Стандартная запись записывает форму. Перед любым другим действием
     * новая запись и несохранённые изменения записываются отдельным запросом: действие применяется
     * к записанной записи. Об изменённой и созданной записи хук сообщает области окна сам.
     * Возвращает результат действия; если действие не выполнено, завершается ошибкой.
     */
    readonly run: (action: FormAction, input?: RecordFormActionInput, options?: RecordFormRunOptions) => Promise<unknown>;
    /**
     * Показывает запись, прочитанную формой заново после изменения вне её: делает её записанным
     * состоянием и передаёт обработчику `show`.
     */
    readonly show: (record: RecordData) => void;
}

/** То, что область окна передаёт форме записи через контекст. */
export interface RecordFormHostValue {
    /** Объект формы: о его записи хук сообщает области. */
    readonly object: PerformTarget;
    /** Запись, с которой открыта форма; у формы новой записи `null`. */
    readonly record: RecordData | null;
    /** Компонент собственного элемента конфигурации по имени: его выводят группы полей формы. */
    readonly elements: (name: string) => FormElementComponent | undefined;
    /** Отмечает, что форма подключила контракт. Возвращает отмену отметки. */
    readonly register: () => () => void;
}

/**
 * Контекст формы записи. Его ставит область окна вокруг компонента формы, стандартного
 * или собственного. В точку входа SDK не входит: форма пользуется им через хуки.
 */
export const RecordFormHostContext = createContext<RecordFormHostValue | null>(null);

/** Контекст формы записи; вне формы записи завершается ошибкой. */
export function useRecordFormHost(): RecordFormHostValue {
    const host = useContext(RecordFormHostContext);
    if (host === null) throw new Error('Контракт формы записи доступен только компоненту формы записи или новой записи');
    return host;
}

/**
 * Подключает форму записи к области окна. Вызывается один раз в компоненте формы записи
 * или новой записи; без вызова область показывает ошибку вместо формы.
 *
 * Обработчики читаются в момент вызова, поэтому форма может создавать их заново при каждой отрисовке.
 */
export function useRecordFormContract(handlers: RecordFormHandlers): RecordFormController {
    const host = useRecordFormHost();
    const scope = useWindowScope();
    const registerUnsaved = useContext(UnsavedChangesContext);
    const current = useRef(handlers);
    current.current = handlers;

    const [record, setRecord] = useState(host.record);
    // Ссылка нужна действию: состояние обновится только после отрисовки, а действие читает запись сразу.
    const recordRef = useRef(host.record);
    const [running, setRunning] = useState<string | null>(null);
    // Состояние React обновится позже; ссылка блокирует повторное нажатие в том же кадре.
    const executing = useRef(false);

    const { register } = host;
    useEffect(() => register(), [register]);
    useEffect(() => registerUnsaved?.(() => current.current.changed()), [registerUnsaved]);

    const accept = (next: RecordData) => {
        recordRef.current = next;
        setRecord(next);
        current.current.show(next);
    };

    const run = async (action: FormAction, input: RecordFormActionInput = null, options: RecordFormRunOptions = {}): Promise<unknown> => {
        if (executing.current) throw new Error('Действие уже выполняется');
        executing.current = true;
        const created = recordRef.current === null;
        let completed = false;
        /** Изменило ли действие запись на сервере. Запись перед отклонённым действием тоже считается. */
        let written = false;
        const isSave = action.standard && action.name === 'save';
        let result: unknown;
        setRunning(action.name);
        try {
            let saved = recordRef.current;
            const atomic = options.atomic === true && saved === null && action.standard && action.name === 'post';
            if (atomic) {
                saved = await current.current.save(null, action);
                if (saved === null) throw new Error('Запись не сохранена');
                accept(saved);
                written = true;
                result = saved;
            } else if (isSave || saved === null || current.current.changed()) {
                saved = await current.current.save(saved);
                if (saved === null) throw new Error('Запись не сохранена');
                accept(saved);
                written = true;
            }
            if (atomic) {
                // Запись уже проведена запросом на запись.
            } else if (isSave) {
                result = saved;
            } else {
                const outcome = await current.current.perform(action, typeof input === 'function' ? input(saved) : input, saved);
                written = true;
                if (outcome.record !== null) accept(outcome.record);
                result = outcome.result;
            }
            completed = true;
        } finally {
            executing.current = false;
            setRunning(null);
            const last = recordRef.current;
            // Сообщение идёт раньше закрытия: область, которая отдаёт запись открывшему её коду,
            // должна знать о записи к моменту, когда закрывается.
            if (written && last !== null) scope.recordWritten(host.object, recordGuid(last));
            // Что делать с созданной записью, решает область: вкладка переходит на адрес записи,
            // а модальное окно закрывается.
            if (completed && options.close === true) scope.close();
            else if (created && last !== null) scope.recordCreated(host.object, recordGuid(last));
        }
        return result;
    };

    const isRunning = useCallback(() => executing.current, []);
    return { record, running, isRunning, run, show: accept };
}
