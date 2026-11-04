/** Редактор сохраняет один уровень узла; итог и источник рассчитывает сервер. */
import { Alert, Card, Flex, Radio, Select, Spin, Typography } from 'antd';
import { useState } from 'react';
import { useAction, useActionResult } from '../../web/sdk';
interface SettingNode { readonly kind: string; readonly name: string; readonly path: string; readonly title: string; readonly call: boolean; readonly selected: string; readonly effective: { readonly level: string; readonly source: string } }
interface Settings { readonly subjects: readonly { readonly subjectKind: string; readonly subject: string; readonly title: string }[]; readonly subjectKind: string; readonly subject: string; readonly editable: boolean; readonly nodes: readonly SettingNode[] }
const target = { kind: 'platform', name: 'authorization' } as const;
const labels: Record<string, string> = { inherit: 'Наследовать', deny: 'Запрет', read: 'Чтение', edit: 'Редактирование', allow: 'Разрешить вызов', full: 'Полный доступ' };
export function AccessSettings() {
    const [subject, setSubject] = useState<{ subjectKind: string; subject: string }>();
    const [object, setObject] = useState<string>();
    const [saving, setSaving] = useState(false);
    const [path, setPath] = useState('');
    const query = useActionResult<Settings>({ object: target, action: 'settings', payload: subject ?? {} });
    const run = useAction();
    const data = query.data;
    if (data === undefined) return query.loading ? <Spin /> : <Alert type="error" title="Не удалось получить настройки доступа" />;
    const objects = data.nodes.filter(node => node.path === '');
    const selected = object ?? `${objects[0]?.kind}.${objects[0]?.name}`;
    const nodes = data.nodes.filter(node => `${node.kind}.${node.name}` === selected);
    const node = nodes.find(node => node.path === path) ?? nodes[0];
    const change = async (node: SettingNode, level: string) => {
        setSaving(true);
        try { await run({ object: target, action: 'saveSettings', payload: { subjectKind: data.subjectKind, subject: data.subject, kind: node.kind, name: node.name, path: node.path, level }, successMessage: 'Доступ изменён' }); }
        catch { /* Текст серверного отказа показывает общий хук действий. */ }
        finally { setSaving(false); }
    };
    return <Card title="Настройки доступа" size="small"><Flex vertical gap="middle">
        <Select aria-label="Роль или пользователь" value={`${data.subjectKind}:${data.subject}`} options={data.subjects.map(subject => ({ value: `${subject.subjectKind}:${subject.subject}`, label: subject.title }))} onChange={value => { const separator = value.indexOf(':'); setSubject({ subjectKind: value.slice(0, separator), subject: value.slice(separator + 1) }); }} />
        <Select aria-label="Объект доступа" value={selected} options={objects.map(node => ({ value: `${node.kind}.${node.name}`, label: node.title }))} onChange={value => { setObject(value); setPath(''); }} />
        <Select aria-label="Узел доступа" value={node?.path ?? ''} showSearch optionFilterProp="label" options={nodes.map(node => ({ value: node.path, label: `${node.path.startsWith('groups.') ? 'Группа: ' : node.path.startsWith('fields.') ? 'Поле: ' : ''}${node.title}` }))} onChange={value => setPath(value)} />
        {node !== undefined && <Flex key={node.path} vertical gap="small">
            <Typography.Text strong>{node.title}</Typography.Text>
            <Radio.Group aria-label={`Доступ: ${node.title}`} disabled={!data.editable || saving} value={node.selected} options={(node.call ? ['inherit', 'deny', 'allow'] : node.path === '' ? ['inherit', 'deny', 'read', 'edit', 'full'] : ['inherit', 'deny', 'read', 'edit']).map(value => ({ value, label: labels[value] }))} onChange={event => { void change(node, String(event.target.value)); }} />
            <Typography.Text type="secondary">Итог: {labels[node.effective.level] ?? node.effective.level}. Источник: {node.effective.source}.</Typography.Text>
        </Flex>}
    </Flex></Card>;
}
