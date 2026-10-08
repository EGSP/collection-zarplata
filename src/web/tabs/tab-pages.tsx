import { theme } from 'antd';
import { memo, useMemo, useState, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { ConfigurationPage } from '../application/configuration-pages';
import { HomePage, ObjectPage } from '../application/pages';
import { NotFoundPage } from '../common/not-found';
import { pageSegment } from '../common/paths';
import { RecordDialogHost, RecordDialogLayerContext } from '../forms/record-dialog';
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
 *
 * Модальные окна с формами записей, открытые со страницы, показывает поставщик внутри области
 * вкладки: так окно принадлежит вкладке, скрывается вместе с ней и учитывается при её закрытии.
 */
const TabPage = memo(function TabPage({ id, path, search, active }: TabPageProperties) {
    const location = useMemo(() => ({ pathname: path, search }), [path, search]);
    return (
        <PageArea visible={active}>
            <WindowTabScope id={id} active={active}>
                <RecordDialogHost>
                    <Routes location={location}>
                        {/* Постоянная часть адреса точнее параметра, поэтому этот маршрут выбирается раньше списка объекта. */}
                        <Route path={`${pageSegment}/:name`} element={<ConfigurationPage />} />
                        <Route path=":kind/:name" element={<ObjectPage />} />
                        <Route path=":kind/:name/:guid" element={<RecordPage />} />
                        <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                </RecordDialogHost>
            </WindowTabScope>
        </PageArea>
    );
});

/**
 * Область страницы с собственной прокруткой: у каждой вкладки своё положение прокрутки.
 *
 * Рядом с прокручиваемой частью лежит слой модальных окон страницы. Окно с формой записи выводится
 * в него, а не поверх всего приложения: затемнение закрывает только страницу, поэтому полоса
 * вкладок и список подсистем остаются доступны, пока окно открыто. Слой не прокручивается вместе
 * со страницей, иначе окно уезжало бы при прокрутке списка под ним.
 */
function PageArea({ visible, children }: { readonly visible: boolean; readonly children: ReactNode }) {
    const { token } = theme.useToken();
    const [layer, setLayer] = useState<HTMLElement | null>(null);
    return (
        <div style={{ display: visible ? 'block' : 'none', height: '100%', position: 'relative' }}>
            <div style={{ height: '100%', overflowY: 'auto', padding: token.paddingLG }}>
                <RecordDialogLayerContext.Provider value={layer}>{children}</RecordDialogLayerContext.Provider>
            </div>
            <div ref={setLayer} />
        </div>
    );
}
