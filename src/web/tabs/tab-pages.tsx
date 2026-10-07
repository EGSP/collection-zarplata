import { theme } from 'antd';
import { memo, useMemo, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { HomePage, ObjectPage } from '../application/pages';
import { NotFoundPage } from '../common/not-found';
import { RecordPage } from '../forms/record-page';
import { useWindowTabs, WindowTabScope } from './window-tabs';

/**
 * Страницы открытых вкладок и главный экран. Страницы всех вкладок остаются смонтированными,
 * неактивные скрыты: так вкладка сохраняет несохранённые значения формы, отбор и страницу списка.
 * Если бы страница пересоздавалась при каждом переключении, ввод терялся бы.
 */
export function TabPages() {
    const { tabs, activeId } = useWindowTabs();
    return (
        <>
            {activeId === null && (
                <PageArea visible>
                    <HomePage />
                </PageArea>
            )}
            {tabs.map((tab) => (
                <TabPage key={tab.id} id={tab.id} path={tab.path} search={tab.search} active={tab.id === activeId} />
            ))}
        </>
    );
}

interface TabPageProperties {
    readonly id: number;
    readonly path: string;
    readonly search: string;
    readonly active: boolean;
}

/**
 * Страница одной вкладки. Маршруты получают адрес вкладки, а не адрес браузера: страница скрытой
 * вкладки по-прежнему видит свой адрес и не реагирует на переходы в активной. Заголовок вкладки
 * в свойства не входит, поэтому его смена страницу не перерисовывает.
 */
const TabPage = memo(function TabPage({ id, path, search, active }: TabPageProperties) {
    const location = useMemo(() => ({ pathname: path, search }), [path, search]);
    return (
        <PageArea visible={active}>
            <WindowTabScope id={id} active={active}>
                <Routes location={location}>
                    <Route path=":kind/:name" element={<ObjectPage />} />
                    <Route path=":kind/:name/:guid" element={<RecordPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                </Routes>
            </WindowTabScope>
        </PageArea>
    );
});

/** Область страницы с собственной прокруткой: у каждой вкладки своё положение прокрутки. */
function PageArea({ visible, children }: { readonly visible: boolean; readonly children: ReactNode }) {
    const { token } = theme.useToken();
    return <div style={{ display: visible ? 'block' : 'none', height: '100%', overflowY: 'auto', padding: token.paddingLG }}>{children}</div>;
}
