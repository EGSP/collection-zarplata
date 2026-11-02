import { createStore } from '@tanstack/react-store';
import axios, { type AxiosInstance } from 'axios';
import { applicationVersions, type ApplicationVersions } from '../../server/versions/versions';

/** Константы входят в сборку клиента: первый ответ сервера не определяет версию открытой страницы. */
export const clientVersions: ApplicationVersions = applicationVersions;

/** Отказ относится только к последней паре версий сервера и живёт до перезагрузки вкладки. */
interface VersionUpdate {
    readonly versions: ApplicationVersions;
    readonly dismissed: boolean;
}

export const versionUpdate = createStore<VersionUpdate | null>(null);

function sameVersions(left: ApplicationVersions, right: ApplicationVersions): boolean {
    return left.platform === right.platform && left.configuration === right.configuration;
}

/** Пропущенный или повреждённый заголовок не меняет уже известное состояние. */
function receiveVersions(header: unknown): void {
    if (typeof header !== 'string') return;
    let value: unknown;
    try {
        value = JSON.parse(header);
    } catch {
        return;
    }
    if (typeof value !== 'object' || value === null || !('platform' in value) || !('configuration' in value)) return;
    const { platform, configuration } = value;
    const versionPattern = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
    if (typeof platform !== 'string' || typeof configuration !== 'string' || !versionPattern.test(platform) || !versionPattern.test(configuration)) return;
    const versions = { platform, configuration };
    if (sameVersions(versions, clientVersions)) {
        if (versionUpdate.state !== null) versionUpdate.setState(() => null);
    } else if (versionUpdate.state === null || !sameVersions(versions, versionUpdate.state.versions)) {
        versionUpdate.setState(() => ({ versions, dismissed: false }));
    }
}

/** Ставит перехватчик до обработчика сессии, чтобы даже исходный ответ 401 сообщил версии. */
export function observeApplicationVersions(client: AxiosInstance): void {
    client.interceptors.response.use(
        (response) => {
            receiveVersions(response.headers['x-application-versions']);
            return response;
        },
        (error: unknown) => {
            if (axios.isAxiosError(error)) receiveVersions(error.response?.headers['x-application-versions']);
            return Promise.reject(error);
        },
    );
}

/** Закрытие окна не мешает следующему ответу с другой версией показать его снова. */
export function dismissVersionUpdate(): void {
    versionUpdate.setState((current) => (current === null ? null : { ...current, dismissed: true }));
}

// Открытая проверка не должна подтверждать сессию и запускать обновление токенов.
const versionsClient = axios.create({ baseURL: '/api', timeout: 10_000 });
observeApplicationVersions(versionsClient);
let lastWakeCheck = -Infinity;

/** Общий предел для focus, visibilitychange и online, включая повторное подключение эффектов React. */
export function checkVersionsOnWake(): void {
    const now = performance.now();
    if (now - lastWakeCheck < 60_000) return;
    lastWakeCheck = now;
    // Сетевая ошибка не означает различие версий и не мешает работе страницы.
    void versionsClient.get('/health', { headers: { 'Cache-Control': 'no-cache' } }).catch(() => undefined);
}
