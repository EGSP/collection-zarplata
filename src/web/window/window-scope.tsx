/**
 * Область окна: то, в чём показана страница. Первая реализация области — вкладка.
 *
 * Страница обращается к ближайшей области и не знает, чем та является: сообщает ей заголовок,
 * просит закрыться, узнаёт, видна ли она пользователю, сообщает о несохранённых изменениях
 * и о созданной записи. Поведение страница получает из контекста, а не свойствами: иначе его
 * пришлось бы передавать через каждый компонент между окном и формой, и собственный экран
 * конфигурации зависел бы от того, где он показан.
 *
 * Что значит каждое обращение, решает реализация области. Вкладка по сообщению о созданной записи
 * меняет свой адрес, а область без адреса ничего не делает.
 *
 * Несохранённые изменения область узнаёт через проверки: функции, которые читают признак в момент
 * вызова. Проверок может быть несколько, например форма и редактор рядом с ней. Вложенная область
 * регистрируется в родительской одной проверкой, поэтому родительская считает себя изменённой,
 * пока изменено что-либо внутри вложенной.
 */
import { App } from 'antd';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import type { PerformTarget } from '../data-provider/perform';

/** Область окна, в которой показана страница. */
export interface WindowScope {
    /**
     * Видна ли область пользователю. Страница скрытой вкладки остаётся смонтированной, поэтому
     * всё, что действует на приложение в целом, например сочетания клавиш, она включает только при `true`.
     */
    readonly active: boolean;
    /** Закрывает область. Если в ней есть несохранённые изменения, сначала спрашивает подтверждение. */
    readonly close: () => void;
    /**
     * Сообщает области, что форма создала запись объекта. Вкладка формы новой записи получает
     * после этого адрес существующей записи. Форму область не пересоздаёт и не закрывает.
     */
    readonly recordCreated: (object: PerformTarget, guid: string) => void;
}

/** Область вместе с тем, что страница вызывает только через хуки этого модуля. */
interface WindowScopeValue extends WindowScope {
    readonly retitle: (title: string) => void;
}

/**
 * Регистрирует проверку несохранённых изменений и возвращает функцию, которая её убирает.
 * Каждая регистрация передаёт собственную функцию: по ней проверка и убирается.
 */
export type UnsavedChangesRegistration = (changed: () => boolean) => () => void;

/** Набор проверок несохранённых изменений. */
export interface UnsavedChangesRegistry {
    readonly register: UnsavedChangesRegistration;
    /** Есть ли несохранённые изменения хотя бы у одного участника. Читает признаки в момент вызова. */
    readonly changed: () => boolean;
}

const WindowScopeContext = createContext<WindowScopeValue | null>(null);

/**
 * Ближайший набор проверок несохранённых изменений. Хранится отдельно от области: корневой набор
 * держит приложение, которое областью не является, и по нему спрашивает подтверждение перед выходом.
 */
export const UnsavedChangesContext = createContext<UnsavedChangesRegistration | null>(null);

/**
 * Создаёт набор проверок несохранённых изменений. Проверки хранятся в ссылке, а не в состоянии:
 * их состав на отрисовку не влияет. Обе функции постоянны на всё время жизни компонента.
 */
export function useUnsavedChangesRegistry(): UnsavedChangesRegistry {
    const checks = useRef(new Set<() => boolean>());
    return useMemo(
        () => ({
            register: (changed) => {
                checks.current.add(changed);
                return () => {
                    checks.current.delete(changed);
                };
            },
            changed: () => Array.from(checks.current).some((check) => check()),
        }),
        [],
    );
}

/** Свойства области окна: то, чем реализация отвечает на обращения страницы. */
export interface WindowScopeProviderProperties {
    /** Видна ли область пользователю. Внутри скрытой родительской области вложенная тоже считается скрытой. */
    readonly active: boolean;
    /** Принимает заголовок, который сообщила страница. */
    readonly onTitle: (title: string) => void;
    /** Убирает область с экрана. Подтверждение к этому моменту уже получено, если оно требовалось. */
    readonly onClose: () => void;
    /** Принимает сообщение о созданной записи. */
    readonly onRecordCreated: (object: PerformTarget, guid: string) => void;
    /** Текст вопроса о закрытии с несохранёнными изменениями: он называет то, что закроется. */
    readonly unsavedChangesWarning: string;
    readonly children: ReactNode;
}

/**
 * Создаёт область окна для вложенных страниц. Реализация, например вкладка, оборачивает им своё
 * содержимое и передаёт обработчики. Обработчики должны быть постоянными между отрисовками:
 * от них зависит объект области, который страницы указывают в зависимостях эффектов.
 */
export function WindowScopeProvider({ active, onTitle, onClose, onRecordCreated, unsavedChangesWarning, children }: WindowScopeProviderProperties) {
    const { modal } = App.useApp();
    const parentScope = useContext(WindowScopeContext);
    const parentRegistration = useContext(UnsavedChangesContext);
    const { register, changed } = useUnsavedChangesRegistry();

    // Родительская область узнаёт об изменениях во вложенной как об одном участнике.
    useEffect(() => parentRegistration?.(changed), [parentRegistration, changed]);

    const close = useCallback(() => {
        if (!changed()) return onClose();
        modal.confirm({
            closable: true,
            title: 'Закрыть форму без сохранения?',
            content: unsavedChangesWarning,
            okText: 'Закрыть без сохранения',
            cancelText: 'Остаться',
            onOk: onClose,
        });
    }, [changed, modal, onClose, unsavedChangesWarning]);

    const visible = active && (parentScope?.active ?? true);
    const scope = useMemo<WindowScopeValue>(
        () => ({ active: visible, close, recordCreated: onRecordCreated, retitle: onTitle }),
        [visible, close, onRecordCreated, onTitle],
    );

    return (
        <WindowScopeContext.Provider value={scope}>
            <UnsavedChangesContext.Provider value={register}>{children}</UnsavedChangesContext.Provider>
        </WindowScopeContext.Provider>
    );
}

/** Ближайшая область окна. Вызывается только на странице, показанной в области окна, иначе завершается ошибкой. */
export function useWindowScope(): WindowScope {
    return useScopeValue();
}

function useScopeValue(): WindowScopeValue {
    const scope = useContext(WindowScopeContext);
    if (scope === null) throw new Error('Страница должна быть показана в области окна');
    return scope;
}

/** Задаёт заголовок ближайшей области окна. При `null` заголовок не меняется: его задаёт вложенная страница. */
export function useWindowTitle(title: string | null): void {
    const { retitle } = useScopeValue();
    useEffect(() => {
        if (title !== null) retitle(title);
    }, [retitle, title]);
}

/**
 * Сообщает ближайшей области окна, есть ли на странице несохранённые изменения. По этому признаку
 * область спрашивает подтверждение перед закрытием, а браузер перед закрытием своей вкладки или окна.
 * В одной области хук можно вызвать несколько раз: область изменена, если изменён хотя бы один участник.
 *
 * Признак передаётся ссылкой, а не значением: форма сбрасывает его сразу после записи и тут же
 * закрывает область, а значение из состояния к этому моменту ещё не обновилось бы.
 */
export function useUnsavedChanges(changed: RefObject<boolean>): void {
    const register = useContext(UnsavedChangesContext);
    if (register === null) throw new Error('Страница должна быть показана в области окна');
    useEffect(() => register(() => changed.current), [register, changed]);
}
