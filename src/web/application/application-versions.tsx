import { useQuery } from '@tanstack/react-query';
import { Typography } from 'antd';
import type { ApplicationVersions } from '../../server/versions/versions';

/** Запрашивает версии у сервера: открытая страница может оставаться от прошлой сборки. */
async function fetchVersions(): Promise<ApplicationVersions> {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error('Сервер не сообщил версии');
    return ((await response.json()) as { readonly versions: ApplicationVersions }).versions;
}

/**
 * Подпись с версиями платформы и конфигурации. Маршрут не требует входа, поэтому подпись работает
 * и на экране входа. Пока версии неизвестны, подпись не выводится: на работу приложения они не влияют.
 */
export function ApplicationVersionsText() {
    const { data } = useQuery({ queryKey: ['application-versions'], queryFn: fetchVersions, staleTime: Infinity });
    if (data === undefined) return null;
    return (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Платформа {data.platform} · Конфигурация {data.configuration}
        </Typography.Text>
    );
}
