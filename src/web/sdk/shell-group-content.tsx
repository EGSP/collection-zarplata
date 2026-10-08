/** Отрисовка клиентских групп из заранее объявленного дерева конфигурации. */
import { Flex } from 'antd';
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { findObjectView, useMetadata } from '../data-provider/metadata';
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
    return (
        <Flex ref={container} data-shell-group={group.name} vertical={group.orientation === 'vertical'} gap="middle" style={{ display: visible ? undefined : 'none' }}>
            {entries.filter((entry) => entry.parent.name === group.name).map(({ content }, index) => {
                if (!('component' in content)) return <ShellGroupContent key={index} group={content} />;
                if (content.requiredObjects?.some((object) => findObjectView(metadata, object) === undefined)) return null;
                const Component = content.component;
                return <div key={index} data-shell-component style={{ display: 'contents' }}><Component /></div>;
            })}
        </Flex>
    );
}
