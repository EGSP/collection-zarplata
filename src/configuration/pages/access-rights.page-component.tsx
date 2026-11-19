import { DownOutlined } from '@ant-design/icons';
import { Alert, Card, Dropdown, Empty, Flex, Input, Select, Spin, Tooltip, Tree, Typography } from 'antd';
import type { TreeProps } from 'antd';
import { useMemo, useState, type Key, type ReactNode } from 'react';
import type { AccessAddress, AccessEffective, AccessExplanation, AccessNode, AccessNodeSetting, AccessSettings, AccessSubject, AccessTree } from '../../server/authorization/access-descriptions';
import type { AccessLevel } from '../../server/authorization/access-schema';
import { Column, Grid, Page, useAction, useActionResult } from '../../web/sdk';
import './access-rights.css';

const target = { kind: 'platform', name: 'authorization' } as const;
const subjectKinds = { user: 'Пользователь', role: 'Роль' } as const;
const labels: Record<AccessLevel | 'partial', string> = {
    inherit: 'Наследовать',
    deny: 'Запрет',
    read: 'Чтение',
    edit: 'Редактирование',
    allow: 'Разрешён вызов',
    full: 'Полный доступ',
    partial: 'Частичный доступ',
};

/** Поиск буквальной подстроки по названию или ключу, включая кириллицу. */
function normalized(value: string): string {
    return value.normalize('NFC').toLocaleLowerCase('ru').trim();
}

/** Оставляет совпадения с родителями. Совпавшая строка сохраняет дочерние права. */
function searchTree(nodes: readonly AccessNode[], search: string) {
    const expanded = new Set<Key>();
    const phrase = normalized(search);
    /** Раскрывает путь к совпадению, сохраняя ключи для выделения строки. */
    function filter(node: AccessNode): AccessNode | null {
        const children = node.children.flatMap(child => filter(child) ?? []);
        const matches = normalized(node.title).includes(phrase) || normalized(node.key).includes(phrase);
        if (!matches && children.length === 0) return null;
        if (node.children.length > 0) expanded.add(node.key);
        return { ...node, children: matches ? node.children : children };
    }
    return { nodes: phrase === '' ? nodes : nodes.flatMap(node => filter(node) ?? []), expanded: [...expanded] };
}

/** Одна настройка соответствует всем местам, в которых показан её узел. */
function addressKey({ kind, name, path }: AccessAddress): string {
    return JSON.stringify([kind, name, path]);
}

/** Пикер различает пользователя и роль даже при одинаковых названиях. */
function subjectKey({ subjectKind, subject }: AccessSubject): string {
    return `${subjectKind}:${subject}`;
}

/** Подсказка раскрывает итог при наследовании и при сочетании точечных настроек. */
function accessHint(access: AccessEffective): string {
    return `Итог: ${labels[access.level]}. Источник: ${access.source}.`;
}

/** Тег показывает право текстом и цветом, даже если управлять им нельзя. */
function AccessTag({ level, hint }: { readonly level: AccessLevel | 'partial'; readonly hint: string }) {
    return <Tooltip title={hint}>
        <span className={`access-rights-tag access-rights-tag--${level}`} aria-label={`${labels[level]}. ${hint}`}>{labels[level]}</span>
    </Tooltip>;
}

/** Редактируемый тег открывает только допустимые для этого узла уровни. */
function SettingTag({ setting, editable, busy, onChange }: {
    readonly setting: AccessNodeSetting;
    readonly editable: boolean;
    readonly busy: boolean;
    readonly onChange: (setting: AccessNodeSetting, level: AccessLevel) => void;
}) {
    const hint = accessHint(setting.effective);
    if (!editable) return <AccessTag level={setting.selected} hint={hint} />;
    return <Dropdown
        trigger={['click']}
        autoFocus
        disabled={busy}
        menu={{
            selectable: true,
            selectedKeys: [setting.selected],
            items: [
                ...setting.levels.map(level => ({ key: level, label: labels[level] })),
                { type: 'divider' },
                { key: 'effective', disabled: true, label: hint },
            ],
            onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                const level = setting.levels.find(level => level === key);
                if (level !== undefined && level !== setting.selected) onChange(setting, level);
            },
        }}
    >
        <button
            type="button"
            className={`access-rights-tag access-rights-tag--${setting.selected}`}
            aria-label={`Доступ к «${setting.title}»: ${labels[setting.selected]}. ${hint}`}
            aria-haspopup="menu"
            aria-disabled={busy}
            title={hint}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
        >{labels[setting.selected]} <DownOutlined /></button>
    </Dropdown>;
}

/** Один список показывает итог для всех пользователей и ролей, включая запреты. */
function AccessOverview({ detail }: { readonly detail: AccessExplanation }) {
    return <ul className="access-rights-overview" aria-label="Пользователи и роли">
        {detail.subjects.map(subject => {
            const { access } = subject;
            const level = 'level' in access ? access.level
                : access.allowed === 0 ? 'deny' : access.allowed === access.total ? 'full' : 'partial';
            const hint = 'level' in access ? accessHint(access) : `Доступно узлов: ${access.allowed} из ${access.total}.`;
            return <li key={subjectKey(subject)}>
                <Flex vertical>
                    <Typography.Text>{subject.title}</Typography.Text>
                    <Typography.Text type="secondary">{subjectKinds[subject.subjectKind]}</Typography.Text>
                </Flex>
                <AccessTag level={level} hint={hint} />
            </li>;
        })}
    </ul>;
}

/** Строки одного дерева служат для обзора или для настройки выбранного назначения. */
function renderTree(nodes: readonly AccessNode[], renderTag: (address: AccessAddress) => ReactNode, showCount: boolean): NonNullable<TreeProps['treeData']> {
    return nodes.map(node => ({
        key: node.key,
        title: <span className="access-rights-row">
            <span className="access-rights-row-title">{node.title}{showCount && <small> ({node.count})</small>}</span>
            {node.address !== null && renderTag(node.address)}
        </span>,
        children: renderTree(node.children, renderTag, showCount),
    }));
}

/** Переключает между обзором всех назначений и редактированием прав прямо в дереве. */
export default function AccessRightsPage() {
    const tree = useActionResult<AccessTree>({ object: target, action: 'tree' });
    const run = useAction();
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<string | null>(null);
    const [subject, setSubject] = useState<AccessSubject>();
    const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
    const [saving, setSaving] = useState(false);
    const explanation = useActionResult<AccessExplanation>({ object: target, action: 'explain', payload: { key: selected ?? '' }, enabled: selected !== null && subject === undefined });
    const settings = useActionResult<AccessSettings>({
        object: target,
        action: 'settings',
        payload: subject === undefined ? {} : { subject: subject.subject, subjectKind: subject.subjectKind },
        enabled: subject !== undefined,
    });
    const detail = explanation.data?.key === selected ? explanation.data : undefined;
    const data = subject !== undefined && settings.data?.subject === subject.subject && settings.data.subjectKind === subject.subjectKind ? settings.data : undefined;
    const settingsByAddress = useMemo(() => new Map(data?.nodes.map(node => [addressKey(node), node])), [data]);
    const filtered = useMemo(() => searchTree(tree.data?.nodes ?? [], search), [tree.data, search]);

    /** Обновляет раскрытые пути только при изменении поиска и сохраняет ручное раскрытие. */
    function changeSearch(value: string) {
        setSearch(value);
        if (normalized(value) !== '') setExpandedKeys(searchTree(tree.data?.nodes ?? [], value).expanded);
    }

    /** После записи перечитывает итог, поскольку настройка может изменить дочерние строки. */
    async function save(setting: AccessNodeSetting, level: AccessLevel) {
        if (data === undefined || saving) return;
        setSaving(true);
        try {
            const { kind, name, path } = setting;
            await run({
                object: target,
                action: 'saveSettings',
                payload: { subjectKind: data.subjectKind, subject: data.subject, kind, name, path, level },
                successMessage: 'Доступ изменён',
                failureMessage: 'Не удалось изменить доступ',
            });
            await settings.refresh();
        } catch {
            // Общий хук показывает причину отказа и сохраняет прежнее значение тега.
        } finally {
            setSaving(false);
        }
    }

    const treeData = renderTree(filtered.nodes, address => {
        const setting = settingsByAddress.get(addressKey(address));
        return setting === undefined ? null : <SettingTag setting={setting} editable={data?.editable === true} busy={saving} onChange={save} />;
    }, subject === undefined);

    return <Page title="Права доступа">
        <Card size="small">
            <Select
                className="access-rights-picker"
                aria-label="Пользователь или роль"
                placeholder="Выберите пользователя или роль"
                allowClear
                showSearch={{ optionFilterProp: 'label' }}
                loading={tree.loading && tree.data === undefined}
                disabled={saving || tree.data === undefined}
                value={subject === undefined ? undefined : subjectKey(subject)}
                options={tree.data?.subjects.map(option => ({ value: subjectKey(option), label: `${option.title} (${subjectKinds[option.subjectKind].toLocaleLowerCase('ru')})` })) ?? []}
                onChange={value => setSubject(tree.data?.subjects.find(option => subjectKey(option) === value))}
            />
            {subject !== undefined && (data === undefined ? settings.loading ? <Spin size="small" /> : <Alert type="error" title="Не удалось получить настройки доступа" />
                : data.readOnly && <Typography.Text className="access-rights-read-only" type="secondary">Права этой роли заданы в конфигурации.</Typography.Text>)}
        </Card>
        <Grid>
            <Column span={subject === undefined ? { md: 5, lg: 9 } : {}}>
                <Card size="small">
                    <Flex vertical gap="middle">
                        <Input.Search aria-label="Поиск объекта или права" placeholder="Найти объект или право" allowClear value={search} onChange={event => changeSearch(event.target.value)} />
                        {tree.data === undefined ? tree.loading ? <Spin /> : <Alert type="error" title="Не удалось получить дерево прав доступа" />
                            : filtered.nodes.length === 0 ? <Empty description="Ничего не найдено" />
                            : <div className="access-rights-tree">
                                <Tree aria-label="Дерево прав доступа" blockNode treeData={treeData} expandedKeys={expandedKeys} autoExpandParent={false}
                                    selectedKeys={subject === undefined && selected !== null ? [selected] : []} onExpand={keys => setExpandedKeys(keys)}
                                    selectable={subject === undefined}
                                    onSelect={keys => setSelected(keys.length === 0 ? null : String(keys[0]))} />
                            </div>}
                    </Flex>
                </Card>
            </Column>
            {subject === undefined && <Column span={{ md: 3, lg: 7 }}>
                <Card size="small" title="Пользователи и роли">
                    {selected === null ? <Typography.Text type="secondary">Выберите узел в дереве.</Typography.Text>
                        : detail !== undefined ? <AccessOverview detail={detail} />
                        : explanation.loading ? <Spin /> : <Alert type="error" title="Не удалось получить права на выбранный узел" />}
                </Card>
            </Column>}
        </Grid>
    </Page>;
}
