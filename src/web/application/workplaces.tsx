/**
 * Рабочие места в боковой панели: страницы, которые схема оболочки перечисляет в `workplaces`.
 * Они стоят над подсистемами и открываются одним нажатием, без окна подсистемы: это экраны,
 * с которыми пользователь работает каждый день.
 */
import { Menu } from 'antd';
import { useLocation, useNavigate } from 'react-router';
import { pagePath } from '../common/paths';
import { useMetadata } from '../data-provider/metadata';
import { Icons } from '../sdk/ds/icons';

/**
 * Меню рабочих мест, доступных пользователю. Сервер уже убрал из схемы страницы без права
 * на открытие, а здесь пропускается только страница без описания. Пункт открытой страницы
 * подсвечен. После перехода вызывается `onNavigate`: выдвижная панель по нему закрывается.
 *
 * Возвращает `null`, если рабочих мест нет: тогда оболочка не ставит и разделитель под меню.
 */
export function WorkplaceMenu({ onNavigate }: { readonly onNavigate: () => void }) {
    const metadata = useMetadata().data;
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const items = (metadata?.shell.workplaces ?? []).flatMap((name) => {
        const page = metadata?.pages.find((candidate) => candidate.name === name);
        if (page === undefined) return [];
        // Страница без собственной иконки получает значок вида `page`, как в окне подсистемы.
        const PageIcon = Icons[page.icon ?? 'page'];
        return [{ key: pagePath(page.name), icon: <PageIcon />, label: page.title }];
    });
    if (items.length === 0) return null;
    return (
        <Menu
            mode="inline"
            style={{ borderInlineEnd: 'none' }}
            selectedKeys={[pathname]}
            items={items}
            onClick={({ key }) => {
                void navigate(key);
                onNavigate();
            }}
        />
    );
}
