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
 * Для страницы вкладка служит областью окна: страница сообщает ей заголовок, несохранённые изменения
 * и созданную запись и просит закрыться, не зная, что показана именно во вкладке.
 *
 * Набор вкладок живёт в состоянии компонента и между открытиями приложения не запоминается.
 * Компонент стоит под проверкой входа, поэтому при завершении сессии вкладки исчезают вместе с ним,
 * и следующий вошедший пользователь не увидит вкладок предыдущего.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { homePath, newRecordPath, recordPath } from '../common/paths';
import type { PerformTarget } from '../data-provider/perform';
import { UnsavedChangesContext, useUnsavedChangesRegistry, useWindowScope, WindowScopeProvider } from '../window/window-scope';

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

/**
 * Меняет путь вкладки с `from` на `path`. Вкладка с другим путём не меняется.
 * Строка запроса относилась к прежнему пути и сбрасывается.
 */
function relocateTab(state: TabsState, id: number, from: string, path: string): TabsState {
    const relocated = state.tabs.find((tab) => tab.id === id);
    if (relocated === undefined || relocated.path !== from || from === path) return state;
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

/** Действия, которыми область окна вкладки меняет набор вкладок. Объект постоянен на всё время работы приложения. */
interface TabActions {
    /** Убирает вкладку без вопросов: подтверждение спрашивает область окна вкладки. */
    readonly remove: (id: number) => void;
    /** Переводит вкладку с адреса формы новой записи объекта на адрес созданной записи. */
    readonly recordCreated: (id: number, object: PerformTarget, guid: string) => void;
    readonly retitle: (id: number, title: string) => void;
    /**
     * Запоминает команду закрытия вкладки с подтверждением: ею пользуется крестик в полосе вкладок,
     * который стоит вне области окна. Возвращает функцию, которая команду убирает.
     */
    readonly attach: (id: number, close: () => void) => () => void;
}

const WindowTabsContext = createContext<WindowTabs | null>(null);
const TabActionsContext = createContext<TabActions | null>(null);

/** Хранит вкладки и связывает их с адресом браузера. Должен стоять внутри маршрутизатора и под проверкой входа. */
export function WindowTabsProvider({ children }: { readonly children: ReactNode }) {
    const location = useLocation();
    const navigate = useNavigate();

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

    // Корневой набор проверок: область окна каждой вкладки регистрируется в нём одним участником.
    const { register, changed: hasUnsavedChanges } = useUnsavedChangesRegistry();
    const closers = useRef(new Map<number, () => void>());

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
            remove: (id) => setStored((previous) => removeTab(previous, id)),
            // Адрес меняет только вкладка формы новой записи этого объекта. Запись может создать
            // и форма на другой странице, например на странице конфигурации: её адрес остаётся прежним.
            recordCreated: (id, object, guid) =>
                setStored((previous) => relocateTab(previous, id, normalizePath(newRecordPath(object)), normalizePath(recordPath(object, guid)))),
            retitle: (id, title) => setStored((previous) => retitleTab(previous, id, title)),
            attach: (id, close) => {
                closers.current.set(id, close);
                return () => {
                    // Команду могла заменить следующая: эффект с новой командой выполняется раньше очистки прежнего.
                    if (closers.current.get(id) === close) closers.current.delete(id);
                };
            },
        }),
        [],
    );
    const close = useCallback(
        (id: number) => {
            const closer = closers.current.get(id);
            // Команды нет, пока страница вкладки не смонтирована: несохранённых изменений у неё тоже нет.
            if (closer === undefined) actions.remove(id);
            else closer();
        },
        [actions],
    );

    const value = useMemo<WindowTabs>(
        () => ({
            tabs: state.tabs,
            activeId: state.activeId,
            activate: (id) => {
                const tab = state.tabs.find((candidate) => candidate.id === id);
                void navigate(tab === undefined ? homePath : tab.path + tab.search);
            },
            close,
            hasUnsavedChanges,
        }),
        [state, navigate, close, hasUnsavedChanges],
    );

    return (
        <TabActionsContext.Provider value={actions}>
            <UnsavedChangesContext.Provider value={register}>
                <WindowTabsContext.Provider value={value}>{children}</WindowTabsContext.Provider>
            </UnsavedChangesContext.Provider>
        </TabActionsContext.Provider>
    );
}

/** Набор вкладок приложения. Вызывается только под `WindowTabsProvider`. */
export function useWindowTabs(): WindowTabs {
    const tabs = useContext(WindowTabsContext);
    if (tabs === null) throw new Error('Вкладки доступны только внутри WindowTabsProvider');
    return tabs;
}

/**
 * Область окна вкладки. Оборачивает содержимое одной вкладки: страница внутри обращается к области
 * и не знает о вкладке. Заголовок области становится заголовком вкладки, закрытие убирает вкладку,
 * а сообщение о созданной записи меняет её адрес.
 */
export function WindowTabScope({ id, active, children }: { readonly id: number; readonly active: boolean; readonly children: ReactNode }) {
    const actions = useContext(TabActionsContext);
    if (actions === null) throw new Error('Вкладки доступны только внутри WindowTabsProvider');
    const retitle = useCallback((title: string) => actions.retitle(id, title), [actions, id]);
    const remove = useCallback(() => actions.remove(id), [actions, id]);
    const recordCreated = useCallback((object: PerformTarget, guid: string) => actions.recordCreated(id, object, guid), [actions, id]);
    return (
        <WindowScopeProvider
            active={active}
            onTitle={retitle}
            onClose={remove}
            onRecordCreated={recordCreated}
            unsavedChangesWarning="На форме есть несохранённые изменения. Если закрыть вкладку, они будут потеряны."
        >
            <TabCloser id={id} actions={actions} />
            {children}
        </WindowScopeProvider>
    );
}

/** Передаёт набору вкладок команду закрытия области: так крестик вкладки спрашивает то же подтверждение, что и страница. */
function TabCloser({ id, actions }: { readonly id: number; readonly actions: TabActions }) {
    const { close } = useWindowScope();
    useEffect(() => actions.attach(id, close), [actions, id, close]);
    return null;
}
