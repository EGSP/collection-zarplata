import { Result } from 'antd';
import { useTabTitle } from '../tabs/window-tabs';

/** Страница для адреса, которому не соответствует ни один доступный пользователю объект или его форма. */
export function NotFoundPage() {
    useTabTitle('Страница не найдена');
    return <Result status="404" title="Страница не найдена" subTitle="Объекта нет в конфигурации, или он вам недоступен." />;
}
