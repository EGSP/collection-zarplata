/** Сессии учётной записи как блок формы конфигурации. */
import { Alert, Space } from 'antd';
import { useState } from 'react';
import type { UserSession } from '../../server/users/descriptions';
import { Button, DataTable, FormStack, useAction, useFunctionResult } from '../../web/sdk';
import { PlatformObjects } from '../../web/sdk';
const users = PlatformObjects.catalog.users;
/** Сессии перечитываются при открытии вкладки и после отключения; форма пользователя сохраняет ввод. */
export function UserSessions({ userGuid, canWrite }: { readonly userGuid: string; readonly canWrite: boolean }) {
    const result = useFunctionResult({ object: users, name: 'sessions', payload: { guid: userGuid }, refreshInterval: 15000 });
    const action = useAction();
    const [revoking, setRevoking] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    async function revoke(sessionGuid: string): Promise<void> {
        setRevoking(sessionGuid);
        setFailure(null);
        try {
            await action({ object: users, action: 'revokeSession', payload: { guid: userGuid, sessionGuid }, successMessage: 'Сессия завершена' });
            await result.refresh();
        } catch (error) {
            setFailure(error instanceof Error ? error.message : 'Не удалось завершить сессию');
        } finally {
            setRevoking(null);
        }
    }
    const date = (value: string) => new Date(value).toLocaleString('ru-RU');
    return <FormStack>
        <Space><Button onClick={() => { void result.refresh(); }} disabled={result.loading}>Обновить</Button></Space>
        {failure !== null && <Alert type="error" title={failure} />}
        {!result.loading && result.data === undefined && <Alert type="error" title="Не удалось получить сессии" />}
        <DataTable<UserSession> rowKey={(row) => row.guid} loading={result.loading} rows={Array.isArray(result.data) ? result.data : []} columns={[
            // Постоянный UUID позволяет различать сессии и сопоставлять их с записью журнала.
            { key: 'guid', title: 'ID', type: 'string', value: (row) => row.guid, size: { minimum: 36, weight: 1 } },
            { key: 'createdAt', title: 'Вход', type: 'string', value: (row) => date(row.createdAt) },
            { key: 'lastConnectedAt', title: 'Последнее подключение', type: 'string', value: (row) => date(row.lastConnectedAt) },
            { key: 'refreshedAt', title: 'Обновление токена', type: 'string', value: (row) => date(row.refreshedAt) },
            { key: 'actions', title: 'Действия', type: 'free', render: (row) => <Button danger disabled={!canWrite || revoking !== null} loading={revoking === row.guid} onClick={() => { void revoke(row.guid); }}>Отключить</Button> },
        ]} />
    </FormStack>;
}
