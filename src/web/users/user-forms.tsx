/** Представления пользователей в общем механизме форм объектов ИБ. */
import { useHotkey } from '@tanstack/react-hotkeys';
import { hasOpenDialog, hasOpenPicker } from '../sdk/platform/keyboard';
import { Alert, Checkbox, Form, Input, Select, Space, Tag, Tabs, Typography } from 'antd';
import { useRef, useState } from 'react';
import type { UserAccount, UserDirectory, UserSession } from '../../server/users/descriptions';
import { Button, DataTable, FormStack, Page, useAction, useActionResult, useOpenRecord, useRecordFormContract, useWindowScope, type ListFormProperties, type NewFormProperties, type RecordFormProperties, type RecordData } from '../sdk';

const users = { kind: 'platform', name: 'users' } as const;
interface UserFields {
    readonly name: string;
    readonly pin?: string;
    readonly roles: string[];
    readonly disabled: boolean;
}

/** Список открывает формы через useOpenRecord, как списки справочников и документов. */
export function UserListForm({ object }: ListFormProperties) {
    const result = useActionResult<UserDirectory>({ object, action: 'list' });
    const openRecord = useOpenRecord();
    const [search, setSearch] = useState('');
    const directory = result.data;
    const roleTitles = new Map(directory?.roles.map((role) => [role.name, role.title]));
    return <Page title={object.title} actions={object.form?.actions.some((action) => action.name === 'save') && <Button type="primary" onClick={() => { void openRecord(object, null); }}>Создать</Button>}>
        <Input.Search aria-label="Поиск пользователей" placeholder="Найти пользователя" allowClear value={search} onChange={(event) => setSearch(event.target.value)} />
        {!result.loading && directory === undefined && <Alert type="error" title="Не удалось получить пользователей. Проверьте право чтения и соединение с сервером." />}
        <DataTable<UserAccount> rowKey={(row) => row.guid} loading={result.loading} layouts={{ sm: [['name', 'status'], 'roles'], lg: [] }} pagination={{ pageSize: 10 }} rows={directory?.items.filter((user) => user.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru'))) ?? []} columns={[
            { title: 'Имя', key: 'name', type: 'string', value: (row) => row.name, render: (user) => <Button type="link" onClick={() => { void openRecord(object, user.guid); }}>{user.name}</Button> },
            { title: 'Роли', key: 'roles', type: 'free', size: { minimum: 16, weight: 1 }, render: (user) => <Space wrap>{user.roles.map((role) => <Tag key={role}>{roleTitles.get(role) ?? `${role} (удалена из конфигурации)`}</Tag>)}</Space> },
            { title: 'Состояние', key: 'status', type: 'free', size: { minimum: 16, weight: 1 }, render: (user) => user.disabledAt === null ? 'Активен' : 'Отключён' },
        ]} />
    </Page>;
}

/** Форма новой и существующей записи: контракт отвечает за запись, адрес и несохранённые изменения. */
export function UserRecordForm({ object, view, ...properties }: NewFormProperties | RecordFormProperties) {
    const initialRecord = 'record' in properties ? properties.record : null;
    const [form] = Form.useForm<UserFields>();
    const dirty = useRef(false);
    const root = useRef<HTMLDivElement>(null);
    const pickerEvents = useRef(new WeakSet<Event>());
    const [activeTab, setActiveTab] = useState('account');
    const [failure, setFailure] = useState<string | null>(null);
    const directory = useActionResult<UserDirectory>({ object, action: 'list' }).data;
    const action = useAction();
    const scope = useWindowScope();
    const canWrite = view.actions.some((item) => item.name === 'save');
    const state = useRecordFormContract({
        changed: () => dirty.current,
        save: async (record) => {
            setFailure(null);
            let fields: UserFields;
            try { fields = await form.validateFields(); } catch { return null; }
            try {
                return await action({ object, action: 'save', payload: {
                    ...(record === null ? {} : { guid: record['guid'] }), name: fields.name, roles: fields.roles, disabled: fields.disabled,
                    ...(fields.pin === undefined || fields.pin === '' ? {} : { pin: fields.pin }),
                }, successMessage: 'Пользователь записан' });
            } catch (error) {
                setFailure(error instanceof Error ? error.message : 'Не удалось записать пользователя');
                return null;
            }
        },
        // Сессии выполняют собственные действия отдельно, не записывая несохранённый PIN или роли.
        perform: async () => { throw new Error('Действие формы пользователя не поддерживается'); },
        show: (record) => { form.setFieldsValue(fieldsOf(record)); dirty.current = false; },
    });
    const account = state.record;
    const save = view.actions.find((item) => item.name === 'save');
    const running = state.running !== null;
    const title = account === null ? 'Новый пользователь' : String(account['name']);
    // Скрытые вкладки не получают сочетания; открытый выбор или диалог обрабатывает Escape сам.
    const hotkeyOptions = { ignoreInputs: false, requireReset: true, enabled: scope.active };
    useHotkey('Control+S', (event) => {
        if (!event.isComposing && !hasOpenDialog(root.current) && !state.isRunning() && activeTab === 'account' && save !== undefined) {
            void state.run(save).catch(() => undefined);
        }
    }, hotkeyOptions);
    useHotkey('Escape', (event) => {
        if (event.isComposing || hasOpenDialog(root.current) || pickerEvents.current.has(event) || state.isRunning()) return;
        event.stopPropagation();
        scope.close();
    }, { ...hotkeyOptions, preventDefault: false, stopPropagation: false });
    return <div ref={root} onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && hasOpenPicker(event.target)) pickerEvents.current.add(event.nativeEvent);
    }}><Page title={title} actions={<>
        {save !== undefined && <Button type="primary" loading={running} disabled={activeTab !== 'account'} onClick={() => { void state.run(save).catch(() => undefined); }}>Записать</Button>}
        <Button disabled={running} onClick={scope.close}>Закрыть</Button>
    </>}>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[{
            key: 'account', label: 'Данные пользователя', forceRender: true,
            children: <Form form={form} layout="vertical" disabled={!canWrite || running} initialValues={fieldsOf(initialRecord)} onValuesChange={() => { dirty.current = true; }}>
                <FormStack>
                    {failure !== null && <Alert type="error" title={failure} />}
                    <Form.Item name="name" label="Имя" rules={[{ required: true, whitespace: true, message: 'Укажите имя пользователя' }]}><Input autoComplete="off" /></Form.Item>
                    {canWrite && <Form.Item name="pin" label={account === null ? 'PIN' : 'Новый PIN'} extra={account === null ? 'От 4 до 12 цифр' : 'Оставьте пустым, чтобы сохранить прежний PIN'} rules={[
                        { required: account === null, message: 'Укажите PIN' }, { pattern: /^[0-9]{4,12}$/, message: 'PIN должен содержать от 4 до 12 цифр' },
                    ]}><Input.Password autoComplete="new-password" inputMode="numeric" /></Form.Item>}
                    <Form.Item name="roles" label="Роли"><Select mode="multiple" optionFilterProp="label" options={(directory?.roles ?? []).map((role) => ({ value: role.name, label: `${role.title}${role.all ? ' (полный доступ)' : ''}` }))} /></Form.Item>
                    <Form.Item name="disabled" valuePropName="checked"><Checkbox>Отключён</Checkbox></Form.Item>
                    <Typography.Text type="secondary">Отключённый пользователь не может войти. Смена PIN завершает его прежние сеансы.</Typography.Text>
                </FormStack>
            </Form>,
        }, ...(account === null ? [] : [{ key: 'sessions', label: 'Сессии', children: <UserSessions userGuid={String(account['guid'])} canWrite={canWrite} /> }])]} />
    </Page></div>;
}

/** PIN никогда не читается с сервера и очищается после успешной записи. */
function fieldsOf(record: RecordData | null): UserFields {
    return { name: String(record?.['name'] ?? ''), pin: '', roles: Array.isArray(record?.['roles']) ? record['roles'] as string[] : [], disabled: record?.['disabledAt'] != null };
}

/** Сессии перечитываются при открытии вкладки и после отключения; форма пользователя сохраняет ввод. */
function UserSessions({ userGuid, canWrite }: { readonly userGuid: string; readonly canWrite: boolean }) {
    const result = useActionResult<readonly UserSession[]>({ object: users, action: 'sessions', payload: { guid: userGuid }, refreshInterval: 15000 });
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
        <DataTable<UserSession> rowKey={(row) => row.guid} loading={result.loading} rows={result.data ?? []} columns={[
            // Постоянный UUID позволяет различать сессии и сопоставлять их с записью журнала.
            { key: 'guid', title: 'ID', type: 'string', value: (row) => row.guid, size: { minimum: 36, weight: 1 } },
            { key: 'createdAt', title: 'Вход', type: 'string', value: (row) => date(row.createdAt) },
            { key: 'lastConnectedAt', title: 'Последнее подключение', type: 'string', value: (row) => date(row.lastConnectedAt) },
            { key: 'refreshedAt', title: 'Обновление токена', type: 'string', value: (row) => date(row.refreshedAt) },
            { key: 'actions', title: 'Действия', type: 'free', render: (row) => <Button danger disabled={!canWrite || revoking !== null} loading={revoking === row.guid} onClick={() => { void revoke(row.guid); }}>Отключить</Button> },
        ]} />
    </FormStack>;
}
