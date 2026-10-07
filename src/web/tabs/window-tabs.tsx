/**
 * Вкладки открытых окон: набор вкладок, активная вкладка и их связь с адресом браузера.
 *
 * Вкладку определяет путь адреса: `/catalog/sample` открывает вкладку списка, `/catalog/sample/<guid>`
 * вкладку формы. Поэтому вкладки не нужно открывать отдельной командой: любая ссылка и кнопки
 * браузера «Назад» и «Вперёд» меняют адрес, а набор вкладок выводится из него. Повторный переход
 * по тому же пути находит существующую вкладку и делает её активной.
 *
 * Строка запроса принадлежит вкладке: в ней список хранит сортировку, отбор и страницу. Вкладка
 * помнит свою строку запроса, пока скрыта, и при возврате адрес браузера приводится к ней.
 *
 * Связь работает в обе стороны. Из адреса состояние вычисляется при отрисовке, без эффекта: иначе
 * один кадр показывал бы прежнюю вкладку. Закрытие вкладки и смена её адреса сначала меняют
 * состояние, а адрес браузера приводит к нему отдельный эффект.
 *
 * Набор вкладок живёт в состоянии компонента и между открытиями приложения не запоминается.
 * Компонент стоит под проверкой входа, поэтому при завершении сессии вкладки исчезают вместе с ним,
 * и следующий вошедший пользователь не увидит вкладок предыдущего.
 */
import { App } from 'antd';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { homePath } from '../common/paths';

/** Вкладка открытого списка или формы. Главный экран вкладкой в этом наборе не является. */
export interface WindowTab {
    /** Номер вкладки. Не меняется, когда у вкладки меняется адрес, поэтому страница вкладки не пересоздаётся. */
    readonly id: number;
    /** Путь адреса без строки запроса. По нему вкладка отличается от остальных. */
    readonly path: string;
    /** Строка запроса вместе с `?` либо пустая строка. */
    readonly search: string;
    /** Заголовок, который сообщила страница вкладки. Пока страница его не сообщила, `null`. */
    readonly title: string | null;
}

interface TabsState {
    readonly tabs: ReadonlyArray<WindowTab>;
    /** Номер активной вкладки. При `null` открыт главный экран. */
    readonly activeId: number | null;
    /**
     * Путь, с которого приложение уже уходит: вкладка закрыта или получила другой адрес, а адрес
     * браузера ещё прежний. Без этой отметки прежний адрес открыл бы вкладку заново.
     */
    readonly departed: string | null;
}

const initialState: TabsState = { tabs: [], activeId: null, departed: null };

// Номера выдаются при отрисовке, которую React может повторить. Пропуск номера ничему не мешает:
// от номера требуется только уникальность.
let nextTabId = 1;

/** Путь без косой черты в конце: `/catalog/sample/` и `/catalog/sample` открывают одну вкладку. */
function normalizePath(pathname: string): string {
    const trimmed = pathname.replace(/\/+$/, '');
    return trimmed === '' ? homePath : trimmed;
}

/** Приводит состояние вкладок к адресу браузера. Возвращает прежний объект, если менять нечего. */
function synchronize(state: TabsState, pathname: string, search: string): TabsState {
    const path = normalizePath(pathname);
    if (path === state.departed) return state;
    const settled = state.departed === null ? state : { ...state, departed: null };
    if (path === homePath) return settled.activeId === null ? settled : { ...settled, activeId: null };

    const existing = settled.tabs.find((tab) => tab.path === path);
    if (existing === undefined) {
        const tab: WindowTab = { id: nextTabId++, path, search, title: null };
        // Новая вкладка встаёт сразу за активной: форма оказывается рядом со списком, из которого открыта.
        const position = settled.tabs.findIndex((candidate) => candidate.id === settled.activeId) + 1;
        return { ...settled, tabs: [...settled.tabs.slice(0, position), tab, ...settled.tabs.slice(position)], activeId: tab.id };
    }
    // Строку запроса активной вкладки меняет её список, и вкладка её запоминает. Переход на скрытую
    // вкладку и ссылка без строки запроса состояние списка не несут: вкладка остаётся со своим.
    const nextSearch = existing.id === settled.activeId && search !== '' ? search : existing.search;
    if (existing.id === settled.activeId && nextSearch === existing.search) return settled;
    return {
        ...settled,
        activeId: existing.id,
        tabs: nextSearch === existing.search ? settled.tabs : settled.tabs.map((tab) => (tab === existing ? { ...tab, search: nextSearch } : tab)),
    };
}

/** Убирает вкладку. Если она была активной, активной становится соседняя слева, а без неё главный экран. */
function removeTab(state: TabsState, id: number): TabsState {
    const index = state.tabs.findIndex((tab) => tab.id === id);
    const removed = state.tabs[index];
    if (removed === undefined) return state;
    const tabs = state.tabs.filter((tab) => tab.id !== id);
    if (state.activeId !== id) return { ...state, tabs };
    return { tabs, activeId: state.tabs[index - 1]?.id ?? null, departed: removed.path };
}

/** Меняет путь вкладки. Строка запроса относилась к прежнему пути и сбрасывается. */
function relocateTab(state: TabsState, id: number, path: string): TabsState {
    const relocated = state.tabs.find((tab) => tab.id === id);
    if (relocated === undefined || relocated.path === path) return state;
    const tabs = state.tabs.map((tab) => (tab === relocated ? { ...tab, path, search: '' } : tab));
    return state.activeId === id ? { ...state, tabs, departed: relocated.path } : { ...state, tabs };
}

function retitleTab(state: TabsState, id: number, title: string): TabsState {
    const retitled = state.tabs.find((tab) => tab.id === id);
    if (retitled === undefined || retitled.title === title) return state;
    return { ...state, tabs: state.tabs.map((tab) => (tab === retitled ? { ...tab, title } : tab)) };
}

/** Набор вкладок и действия над ним для полосы вкладок и раскладки. */
export interface WindowTabs {
    readonly tabs: ReadonlyArray<WindowTab>;
    /** Номер активной вкладки. При `null` открыт главный экран. */
    readonly activeId: number | null;
    /** Делает вкладку активной; `null` открывает главный экран. */
    readonly activate: (id: number | null) => void;
    /** Закрывает вкладку. Если на её форме есть несохранённые изменения, сначала спрашивает подтверждение. */
    readonly close: (id: number) => void;
    /** Есть ли несохранённые изменения хотя бы на одной вкладке, в том числе скрытой. */
    readonly hasUnsavedChanges: () => boolean;
}

/** Действия, которые страница выполняет над своей вкладкой. Объект постоянен на всё время работы приложения. */
interface TabActions {
    readonly close: (id: number) => void;
    readonly relocate: (id: number, path: string) => void;
    readonly retitle: (id: number, title: string) => void;
    /** Запоминает проверку несохранённых изменений вкладки. Возвращает функцию, которая её убирает. */
    readonly guard: (id: number, changed: () => boolean) => () => void;
}

const WindowTabsContext = createContext<WindowTabs | null>(null);
const TabActionsContext = createContext<TabActions | null>(null);
const CurrentTabContext = createContext<{ readonly id: number; readonly active: boolean } | null>(null);

/** Хранит вкладки и связывает их с адресом браузера. Должен стоять внутри маршрутизатора и под проверкой входа. */
export function WindowTabsProvider({ children }: { readonly children: ReactNode }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { modal } = App.useApp();

    const [stored, setStored] = useState(initialState);
    const state = synchronize(stored, location.pathname, location.search);
    if (state !== stored) setStored(state);

    const active = state.tabs.find((tab) => tab.id === state.activeId);
    const address = active === undefined ? homePath : active.path + active.search;
    const current = location.pathname + location.search;
    useEffect(() => {
        // Замена записи истории, а не новая запись: адрес закрытой вкладки и адрес новой записи
        // в истории не остаются, и кнопка браузера «Назад» к ним не возвращает.
        if (current !== address) void navigate(address, { replace: true });
    }, [address, current, navigate]);

    const guards = useRef(new Map<number, () => boolean>());
    const hasUnsavedChanges = useCallback(() => Array.from(guards.current.values()).some((changed) => changed()), []);

    useEffect(() => {
        // Закрытие вкладки браузера приложение остановить не может: подтверждение показывает сам браузер.
        // Проверяются все вкладки приложения: несохранённые изменения могут быть на скрытой форме.
        const confirmUnload = (event: BeforeUnloadEvent) => {
            if (hasUnsavedChanges()) event.preventDefault();
        };
        window.addEventListener('beforeunload', confirmUnload);
        return () => window.removeEventListener('beforeunload', confirmUnload);
    }, [hasUnsavedChanges]);

    const actions = useMemo<TabActions>(
        () => ({
            close: (id) => {
                const remove = () => setStored((previous) => removeTab(previous, id));
                if (guards.current.get(id)?.() !== true) return remove();
                modal.confirm({
                    closable: true,
                    title: 'Закрыть форму без сохранения?',
                    content: 'На форме есть несохранённые изменения. Если закрыть вкладку, они будут потеряны.',
                    okText: 'Закрыть без сохранения',
                    cancelText: 'Остаться',
                    onOk: remove,
                });
            },
            relocate: (id, path) => setStored((previous) => relocateTab(previous, id, normalizePath(path))),
            retitle: (id, title) => setStored((previous) => retitleTab(previous, id, title)),
            guard: (id, changed) => {
                guards.current.set(id, changed);
                return () => {
                    // Вкладку могла занять следующая форма: при смене адреса новая форма появляется раньше, чем уходит прежняя.
                    if (guards.current.get(id) === changed) guards.current.delete(id);
                };
            },
        }),
        [modal],
    );

    const value = useMemo<WindowTabs>(
        () => ({
            tabs: state.tabs,
            activeId: state.activeId,
            activate: (id) => {
                const tab = state.tabs.find((candidate) => candidate.id === id);
                void navigate(tab === undefined ? homePath : tab.path + tab.search);
            },
            close: actions.close,
            hasUnsavedChanges,
        }),
        [state, navigate, actions, hasUnsavedChanges],
    );

    return (
        <TabActionsContext.Provider value={actions}>
            <WindowTabsContext.Provider value={value}>{children}</WindowTabsContext.Provider>
        </TabActionsContext.Provider>
    );
}

/** Набор вкладок приложения. Вызывается только под `WindowTabsProvider`. */
export function useWindowTabs(): WindowTabs {
    const tabs = useContext(WindowTabsContext);
    if (tabs === null) throw new Error('Вкладки доступны только внутри WindowTabsProvider');
    return tabs;
}

/** Сообщает странице, в какой вкладке она показана. Оборачивает содержимое одной вкладки. */
export function WindowTabScope({ id, active, children }: { readonly id: number; readonly active: boolean; readonly children: ReactNode }) {
    const scope = useMemo(() => ({ id, active }), [id, active]);
    return <CurrentTabContext.Provider value={scope}>{children}</CurrentTabContext.Provider>;
}

/** Вкладка, в которой показана страница. */
export interface CurrentTab {
    /**
     * Видна ли вкладка пользователю. Страница скрытой вкладки остаётся смонтированной, поэтому
     * всё, что действует на приложение в целом, например сочетания клавиш, она включает только при `true`.
     */
    readonly active: boolean;
    /** Закрывает вкладку с подтверждением, если на её форме есть несохранённые изменения. */
    readonly close: () => void;
    /**
     * Меняет адрес вкладки, не пересоздавая её: так форма новой записи после записи получает адрес
     * существующей. У скрытой вкладки адрес браузера при этом не меняется.
     */
    readonly relocate: (path: string) => void;
}

function useTabScope(): { readonly id: number; readonly active: boolean; readonly actions: TabActions } {
    const scope = useContext(CurrentTabContext);
    const actions = useContext(TabActionsContext);
    if (scope === null || actions === null) throw new Error('Страница должна быть показана во вкладке');
    return { id: scope.id, active: scope.active, actions };
}

/** Вкладка текущей страницы. Вызывается только на странице, показанной во вкладке. */
export function useWindowTab(): CurrentTab {
    const { id, active, actions } = useTabScope();
    return useMemo(() => ({ active, close: () => actions.close(id), relocate: (path) => actions.relocate(id, path) }), [id, active, actions]);
}

/** Задаёт заголовок вкладки текущей страницы. При `null` заголовок не меняется: его задаёт вложенная страница. */
export function useTabTitle(title: string | null): void {
    const { id, actions } = useTabScope();
    useEffect(() => {
        if (title !== null) actions.retitle(id, title);
    }, [id, actions, title]);
}

/**
 * Сообщает вкладке, есть ли на её форме несохранённые изменения. По этому признаку вкладка
 * спрашивает подтверждение перед закрытием, а браузер перед закрытием своей вкладки или окна.
 *
 * Признак передаётся ссылкой, а не значением: форма сбрасывает его сразу после записи и тут же
 * закрывает вкладку, а значение из состояния к этому моменту ещё не обновилось бы.
 */
export function useUnsavedChanges(changed: RefObject<boolean>): void {
    const { id, actions } = useTabScope();
    useEffect(() => actions.guard(id, () => changed.current), [id, actions, changed]);
}
