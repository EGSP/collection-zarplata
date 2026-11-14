import { Icons } from '../sdk/ds/icons';
import { TabStrip as StripOfTabs, type StripTab } from '../sdk/ds/tab-strip';
import { useWindowTabs } from './window-tabs';

/** Ключ вкладки главного экрана в полосе. Номера остальных вкладок числовые и с ним не совпадают. */
const homeKey = 'home';

/**
 * Полоса вкладок над содержимым страницы на `TabStrip` дизайн-системы. Первой стоит вкладка
 * главного экрана: квадратная, с иконкой и постоянной подсказкой «Главная», она не закрывается.
 * Страницы вкладок полоса не выводит: их показывает `TabPages`, потому что страницы скрытых
 * вкладок должны оставаться смонтированными.
 *
 * Закрытие из полосы и из списка вкладок идёт через `close` набора вкладок, поэтому вопрос
 * о несохранённых изменениях задаётся одинаково.
 */
export function TabStrip() {
    const { tabs, activeId, activate, close } = useWindowTabs();
    const stripTabs: ReadonlyArray<StripTab> = [
        { key: homeKey, title: 'Главная', icon: <Icons.home />, iconOnly: true },
        ...tabs.map((tab) => ({ key: String(tab.id), title: tab.title ?? 'Загрузка…', closable: true })),
    ];
    return (
        <StripOfTabs
            aria-label="Открытые вкладки"
            tabs={stripTabs}
            selectedKey={activeId === null ? homeKey : String(activeId)}
            onSelect={(key) => activate(key === homeKey ? null : Number(key))}
            onClose={(key) => {
                if (key !== homeKey) close(Number(key));
            }}
        />
    );
}
