import { Alert, App, Checkbox, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { useRef, useState } from 'react';
import type { UserAccount, UserDirectory } from '../../server/users/descriptions';
import { Button, FormStack, Page, useAction, useActionResult, useUnsavedChanges } from '../../web/sdk';

const users = { kind: 'platform', name: 'users' } as const;

interface UserFields {
    readonly name: string;
    readonly pin?: string;
    readonly roles: string[];
    readonly disabled: boolean;
}

/** Список и карточка служебного справочника. PIN хранится только в открытой форме до её закрытия. */
export default function UsersPage() {
    const result = useActionResult<UserDirectory>({ object: users, action: 'list' });
    const action = useAction();
    const { modal } = App.useApp();
    const [form] = Form.useForm<UserFields>();
    // undefined: карточка закрыта; null: создание; запись: изменение существующего пользователя.
    const [editing, setEditing] = useState<UserAccount | null | undefined>(undefined);
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const dirty = useRef(false);
    useUnsavedChanges(dirty);
    const directory = result.data;
    const canWrite = directory?.canWrite === true;
    const roleTitles = new Map(directory?.roles.map((role) => [role.name, role.title]));

    function open(account: UserAccount | null): void {
        form.resetFields();
        form.setFieldsValue({ name: account?.name ?? '', roles: [...(account?.roles ?? [])], disabled: account?.disabledAt != null });
        dirty.current = false;
        setFailure(null);
        setEditing(account);
    }

    function close(): void {
        form.resetFields();
        dirty.current = false;
        setEditing(undefined);
    }

    function cancel(): void {
        if (!dirty.current) close();
        else modal.confirm({ title: 'Закрыть карточку без сохранения?', content: 'Введённые изменения будут потеряны.', okText: 'Закрыть', cancelText: 'Продолжить редактирование', onOk: close });
    }

    async function save(fields: UserFields): Promise<void> {
        setSaving(true);
        setFailure(null);
        try {
            await action({ object: users, action: 'save', payload: {
                ...(editing == null ? {} : { guid: editing.guid }), name: fields.name, roles: fields.roles, disabled: fields.disabled,
                ...(fields.pin === undefined || fields.pin === '' ? {} : { pin: fields.pin }),
            }, successMessage: 'Пользователь записан' });
            close();
        } catch (error) {
            setFailure(error instanceof Error ? error.message : 'Не удалось записать пользователя');
        } finally {
            setSaving(false);
        }
    }

    return <Page title="Пользователи" actions={canWrite && <Button type="primary" onClick={() => open(null)}>Создать</Button>}>
        <Input.Search aria-label="Поиск пользователей" placeholder="Найти пользователя" allowClear value={search} onChange={(event) => setSearch(event.target.value)} />
        {!result.loading && directory === undefined && <Alert type="error" title="Не удалось получить пользователей. Проверьте право чтения и соединение с сервером." />}
        <Table<UserAccount> rowKey="guid" loading={result.loading} dataSource={directory?.items.filter((user) => user.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')))} columns={[
            { title: 'Имя', dataIndex: 'name', render: (_, user) => <Button type="link" onClick={() => open(user)}>{user.name}</Button> },
            { title: 'Роли', render: (_, user) => <Space wrap>{user.roles.map((role) => <Tag key={role}>{roleTitles.get(role) ?? `${role} (удалена из конфигурации)`}</Tag>)}</Space> },
            { title: 'Состояние', render: (_, user) => user.disabledAt === null ? 'Активен' : 'Отключён' },
        ]} />
        <Modal open={editing !== undefined} title={editing == null ? 'Новый пользователь' : editing.name} onCancel={cancel} mask={{ closable: false }} keyboard={!saving}
            closable={!saving} footer={<Space><Button disabled={saving} onClick={cancel}>Закрыть</Button>{canWrite && <Button type="primary" loading={saving} onClick={() => form.submit()}>Записать</Button>}</Space>}>
            <Form form={form} layout="vertical" disabled={!canWrite || saving} onValuesChange={() => { dirty.current = true; }} onFinish={(fields) => { void save(fields); }}>
                <FormStack>
                    {failure !== null && <Alert type="error" title={failure} />}
                    <Form.Item name="name" label="Имя" rules={[{ required: true, whitespace: true, message: 'Укажите имя пользователя' }]}><Input autoComplete="off" /></Form.Item>
                    {canWrite && <Form.Item name="pin" label={editing == null ? 'PIN' : 'Новый PIN'} extra={editing == null ? 'От 4 до 12 цифр' : 'Оставьте пустым, чтобы сохранить прежний PIN'} rules={[
                        { required: editing === null, message: 'Укажите PIN' }, { pattern: /^[0-9]{4,12}$/, message: 'PIN должен содержать от 4 до 12 цифр' },
                    ]}><Input.Password autoComplete="new-password" inputMode="numeric" /></Form.Item>}
                    <Form.Item name="roles" label="Роли"><Select mode="multiple" optionFilterProp="label" options={(directory?.roles ?? []).map((role) => ({ value: role.name, label: `${role.title}${role.all ? ' (полный доступ)' : ''}` }))} /></Form.Item>
                    <Form.Item name="disabled" valuePropName="checked"><Checkbox>Отключён</Checkbox></Form.Item>
                    <Typography.Text type="secondary">Отключённый пользователь не может войти. Смена PIN завершает его прежние сеансы.</Typography.Text>
                </FormStack>
            </Form>
        </Modal>
    </Page>;
}
