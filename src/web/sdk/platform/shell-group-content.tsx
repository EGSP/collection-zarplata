/** Отрисовка клиентских групп из заранее объявленного дерева конфигурации. */
import { Flex } from 'antd';
import { createContext, useContext, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { findObjectView, useMetadata } from '../../data-provider/metadata';
import { Column, Grid, type ColumnCount } from '../ds/grid';
import type { ShellGroup, ShellGroupEntry } from './shell-groups';

const ShellGroupsContext = createContext<ReadonlyArray<ShellGroupEntry>>([]);

/** Подключает заранее проверенный состав групп ко всем экранам клиента, включая собственные. */
export function ShellGroupsProvider({ entries, children }: { readonly entries: ReadonlyArray<ShellGroupEntry>; readonly children: ReactNode }) {
    return <ShellGroupsContext.Provider value={entries}>{children}</ShellGroupsContext.Provider>;
}

/**
 * Выводит компоненты и вложенные группы в порядке добавления. Компоненты без нужных
 * описаний объектов не монтируются, поэтому их хуки не отправляют запрещённые запросы.
 * Фактическое содержимое учитывается и при `null` из компонента: пустая группа не занимает
 * места, а главный экран узнаёт, есть ли выведенные компоненты.
 */
export function ShellGroupContent({ group, onContent }: { readonly group: ShellGroup; readonly onContent?: (visible: boolean) => void }) {
    const entries = useContext(ShellGroupsContext);
    const metadata = useMetadata().data;
    const container = useRef<HTMLDivElement>(null);
    const [visible, setVisible] = useState(false);
    useLayoutEffect(() => {
        const element = container.current;
        if (element === null) return;
        const update = () => {
            const populated = [...element.querySelectorAll('[data-shell-component]')].some((node) => node.childNodes.length > 0);
            setVisible(populated);
            onContent?.(populated);
        };
        update();
        const observer = new MutationObserver(update);
        observer.observe(element, { childList: true, subtree: true, characterData: true });
        return () => observer.disconnect();
    }, [onContent]);
    const contents = entries.filter((entry) => entry.parent.name === group.name).map(({ content }, index) => {
        if (!('component' in content)) {
            const nested = <ShellGroupContent key={index} group={content} />;
            // Вложенная группа в сетке занимает всю строку: у неё своя раскладка.
            return group.orientation === 'grid' ? <Column key={index}>{nested}</Column> : nested;
        }
        if (content.requiredObjects?.some((object) => findObjectView(metadata, object) === undefined)) return null;
        return group.orientation === 'grid'
            ? <GridCell key={index} component={content.component} />
            : <div key={index} data-shell-component style={{ display: 'contents' }}><content.component /></div>;
    });
    if (group.orientation === 'grid') {
        return (
            <div ref={container} data-shell-group={group.name} hidden={!visible}>
                <Grid>{contents}</Grid>
            </div>
        );
    }
    return (
        <Flex ref={container} data-shell-group={group.name} vertical={group.orientation === 'vertical'} gap="middle" style={{ display: visible ? undefined : 'none' }}>
            {contents}
        </Flex>
    );
}

/**
 * Ширина ячейки сетки в колонках: на узком контейнере ячейка на всю строку, на среднем
 * две ячейки в строке, начиная с `lg` — четыре.
 */
const gridCellSpan: ColumnCount = { md: 4 };

/**
 * Ячейка сетки с компонентом. Компонент может вернуть `null`, и тогда ячейка скрывается:
 * пустая колонка заняла бы место в строке, и соседние компоненты стояли бы с пропуском.
 */
function GridCell({ component: Component }: { readonly component: ComponentType }) {
    const content = useRef<HTMLDivElement>(null);
    const [empty, setEmpty] = useState(false);
    useLayoutEffect(() => {
        const element = content.current;
        if (element === null) return;
        const update = () => setEmpty(element.childNodes.length === 0);
        update();
        const observer = new MutationObserver(update);
        observer.observe(element, { childList: true });
        return () => observer.disconnect();
    }, []);
    return (
        <Column span={gridCellSpan} hidden={empty}>
            <div ref={content} data-shell-component>
                <Component />
            </div>
        </Column>
    );
}
