/**
 * Управление кнопками стандартного списка из компонентов его группы. Каждый экземпляр
 * списка имеет собственный провайдер; запреты компонентов объединяются и снимаются
 * при размонтировании. Права и команды открытия записей этот механизм не меняет.
 */
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

/** Ограничения показа действий списка. Имена действий совпадают с именами в описании формы. */
export interface ListControls {
    readonly hideCreate?: boolean;
    readonly hiddenRowActions?: ReadonlyArray<string>;
}

/** Объединённые ограничения ближайшего списка и регистрация ограничений компонента. */
interface ListControlsScope {
    readonly hideCreate: boolean;
    readonly hiddenRowActions: ReadonlyArray<string>;
    readonly register: (controls: ListControls) => () => void;
}

const ListControlsContext = createContext<ListControlsScope | null>(null);

/** Изолирует ограничения одного списка от соседних смонтированных вкладок. */
export function ListControlsProvider({ children }: { readonly children: ReactNode }) {
    const [contributions, setContributions] = useState<ReadonlyMap<symbol, ListControls>>(new Map());
    const register = useCallback((controls: ListControls) => {
        const key = Symbol();
        setContributions((current) => new Map(current).set(key, controls));
        return () => setContributions((current) => {
            const next = new Map(current);
            next.delete(key);
            return next;
        });
    }, []);
    const value = useMemo(() => ({
        hideCreate: [...contributions.values()].some((controls) => controls.hideCreate === true),
        hiddenRowActions: [...new Set([...contributions.values()].flatMap((controls) => controls.hiddenRowActions ?? []))],
        register,
    }), [contributions, register]);
    return <ListControlsContext.Provider value={value}>{children}</ListControlsContext.Provider>;
}

/**
 * Скрывает действия ближайшего стандартного списка до показа кадра. Вне списка,
 * например на главном экране, ничего не делает. При изменении настроек или удалении
 * компонента его ограничения снимаются; ограничения других компонентов сохраняются.
 */
export function useListControls({ hideCreate = false, hiddenRowActions = [] }: ListControls): void {
    const register = useContext(ListControlsContext)?.register;
    const actions = JSON.stringify([...new Set(hiddenRowActions)].sort());
    useLayoutEffect(() => register?.({ hideCreate, hiddenRowActions: JSON.parse(actions) as string[] }), [register, hideCreate, actions]);
}

/** Ограничения для каркаса стандартного списка. Вне провайдера ограничения отсутствуют. */
export function useListControlsState() {
    return useContext(ListControlsContext);
}
