import { Result } from 'antd';
import { useWindowTitle } from '../window/window-scope';

/** Страница для адреса, которому не соответствует ни один доступный пользователю объект, его форма или страница конфигурации. */
export function NotFoundPage() {
    useWindowTitle('Страница не найдена');
    return <Result status="404" title="Страница не найдена" subTitle="Объекта или страницы нет в конфигурации, либо они вам недоступны." />;
}
