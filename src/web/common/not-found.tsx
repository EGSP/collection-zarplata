import { Result } from 'antd';
import { useTabTitle } from '../tabs/window-tabs';

/** Страница для адреса, которому не соответствует ни один доступный пользователю объект, его форма или страница конфигурации. */
export function NotFoundPage() {
    useTabTitle('Страница не найдена');
    return <Result status="404" title="Страница не найдена" subTitle="Объекта или страницы нет в конфигурации, либо они вам недоступны." />;
}
