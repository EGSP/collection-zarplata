import { Result } from 'antd';

/** Страница для адреса, которому не соответствует ни один доступный пользователю объект или его форма. */
export function NotFoundPage() {
    return <Result status="404" title="Страница не найдена" subTitle="Объекта нет в конфигурации, или он вам недоступен." />;
}
