import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import type { CSSProperties, ReactNode } from 'react';
import { observeApplicationVersions } from '../common/application-versions';

// Публичные сведения нужны до входа и не должны запускать обновление сессии.
const healthClient = axios.create({ baseURL: '/api', timeout: 10_000 });
observeApplicationVersions(healthClient);

/** Общая рамка резервирует место под отметку среды для страницы входа и рабочей области. */
export function ApplicationEnvironment({ children }: { readonly children: ReactNode }) {
    const environment = useQuery({
        queryKey: ['test-environment'],
        // Флаг фиксирован на время запуска; повторное открытие вкладки читает его заново.
        staleTime: Infinity,
        queryFn: async () => {
            const response = await healthClient.get<{ readonly testEnvironment: boolean }>('/health', { headers: { 'Cache-Control': 'no-cache' } });
            return response.data.testEnvironment;
        },
    });
    // До ответа среда неизвестна. Адрес, порт и тип базы не определяют отметку.
    const testEnvironment = environment.data === true;
    const footerHeight = testEnvironment ? 24 : 0;
    const style = {
        '--application-height': `calc(100dvh - ${footerHeight}px)`,
        height: '100dvh', display: 'flex', flexDirection: 'column',
    } as CSSProperties;
    return (
        <div style={style}>
            {/* Прокручивается содержимое над плашкой; сама плашка занимает отдельную строку. */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{children}</div>
            {testEnvironment && <footer aria-label="Среда приложения" style={{
                flex: 'none', height: 24, lineHeight: '24px', textAlign: 'center',
                background: '#ffec3d', color: '#262626', fontSize: 12,
            }}>Тестовая среда</footer>}
        </div>
    );
}
