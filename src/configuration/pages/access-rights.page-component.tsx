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

/** Итог наследования выделяется одинаковым серым цветом для любого уровня. */
type AccessTagTone = keyof typeof labels | 'effective';

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

/** Проверяет всё дерево, чтобы скрытые поиском или свёрнутые настройки отмечали предков. */
function branchesWithSettings(nodes: readonly AccessNode[], settings: ReadonlyMap<string, AccessNodeSetting>): ReadonlySet<string> {
    const branches = new Set<string>();

    /** Возвращает признак настройки в этом узле или ниже. */
    function visit(node: AccessNode): boolean {
        const descendants = node.children.map(visit).some(Boolean);
        if (descendants) branches.add(node.key);
        const setting = node.address === null ? undefined : settings.get(addressKey(node.address));
        return descendants || (setting !== undefined && (setting.selected !== 'inherit' || setting.differsFromBaseline));
    }

    nodes.forEach(visit);
    return branches;
}

/** Пикер различает пользователя и роль даже при одинаковых названиях. */
function subjectKey({ subjectKind, subject }: AccessSubject): string {
    return `${subjectKind}:${subject}`;
}

/** Объясняет действующее право обычной фразой, включая запрет по умолчанию. */
function accessHint(access: AccessEffective): string {
    return access.sourcePath === 'default'
        ? 'Доступ закрыт по умолчанию.'
        : `Действует право «${labels[access.level]}», заданное в узле «${access.source}».`;
}

/** Тег показывает право текстом и цветом, даже если управлять им нельзя. */
function AccessTag({ level, hint, tone = level }: { readonly level: keyof typeof labels; readonly hint: string; readonly tone?: AccessTagTone }) {
    return <Tooltip title={hint}>
        <span className={`access-rights-tag access-rights-tag--${tone}`} aria-label={`${labels[level]}. ${hint}`}>{labels[level]}</span>
    </Tooltip>;
}

/** Тег настройки открывает допустимые уровни, а серый тег рядом показывает итог наследования. */
function SettingTag({ setting, editable, busy, onChange }: {
    readonly setting: AccessNodeSetting;
    readonly editable: boolean;
    readonly busy: boolean;
    readonly onChange: (setting: AccessNodeSetting, level: AccessLevel) => void;
}) {
    const [open, setOpen] = useState(false);
    const hint = accessHint(setting.effective);
    const level = setting.selected;
    const tag = editable ? <Dropdown
        trigger={['click']}
        autoFocus
        disabled={busy}
        open={open && !busy}
        onOpenChange={setOpen}
        popupRender={menu => <div className="access-rights-menu">
            {menu}
            <p className="access-rights-menu-explanation">{hint}</p>
        </div>}
        menu={{
            selectable: true,
            selectedKeys: [level],
            items: setting.levels.map(level => ({
                key: level,
                label: labels[level],
            })),
            onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                const level = setting.levels.find(level => level === key);
                if (level !== undefined && level !== setting.selected) onChange(setting, level);
            },
        }}
    >
        <button
            type="button"
            className={`access-rights-tag access-rights-tag--${level}`}
            aria-label={`Доступ к «${setting.title}»: ${labels[level]}. ${hint}`}
            aria-haspopup="menu"
            aria-expanded={open && !busy}
            aria-disabled={busy}
            title={hint}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
        >{labels[level]}</button>
    </Dropdown> : <AccessTag level={level} hint={hint} />;
    return <span className="access-rights-setting">
        {tag}
        {level === 'inherit' && <AccessTag level={setting.effective.level} hint={hint} tone="effective" />}
    </span>;
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

/** Собирает данные Tree с одним способом отображения строк на всех уровнях. */
function renderTree(nodes: readonly AccessNode[], renderRow: (node: AccessNode) => ReactNode): NonNullable<TreeProps['treeData']> {
    return nodes.map(node => ({
        key: node.key,
        title: renderRow(node),
        children: renderTree(node.children, renderRow),
    }));
}

/** Переключает между обзором всех назначений и редактированием прав прямо в дереве. */
export default function AccessRightsPage() {
    const tree = useActionResult<AccessTree>({ object: target, action: 'tree' });
    const run = useAction();
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<string | null>(null);
    const [subject, setSubject] = useState<AccessSubject>();
    const [selectedSubjectNode, setSelectedSubjectNode] = useState<string | null>(null);
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
    const markedBranches = useMemo(() => branchesWithSettings(tree.data?.nodes ?? [], settingsByAddress), [tree.data, settingsByAddress]);
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

    /** Выделяет явное назначение текстом, а изменения текущего узла и потомков отдельной меткой. */
    function renderRow(node: AccessNode) {
        const setting = node.address === null ? undefined : settingsByAddress.get(addressKey(node.address));
        const muted = data !== undefined && (setting === undefined || setting.selected === 'inherit');
        const changed = setting?.differsFromBaseline === true;
        const markedBranch = markedBranches.has(node.key);
        const marker = changed && markedBranch ? 'Право отличается от базового. В поддереве есть настроенные права.'
            : changed ? 'Право отличается от базового.'
                : markedBranch ? 'В поддереве есть настроенные права.' : undefined;
        return <span className="access-rights-row">
            <span className={muted ? 'access-rights-row-title access-rights-row-title--muted' : 'access-rights-row-title'}>
                {node.title}{subject === undefined && <small> ({node.count})</small>}
            </span>
            {marker !== undefined && <Tooltip title={marker}>
                <span className="access-rights-marker" role="img" aria-label={marker} />
            </Tooltip>}
            {setting !== undefined && <SettingTag setting={setting} editable={data?.editable === true} busy={saving} onChange={save} />}
        </span>;
    }

    const treeData = renderTree(filtered.nodes, renderRow);
    const selectedNode = subject === undefined ? selected : selectedSubjectNode;

    /** В обзоре выбор открывает панель, в режиме настроек подсвечивает строку. */
    function selectNode(keys: Key[]) {
        const key = keys[0] === undefined ? null : String(keys[0]);
        if (subject === undefined) setSelected(key);
        else setSelectedSubjectNode(key);
    }

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
                onChange={value => {
                    setSubject(tree.data?.subjects.find(option => subjectKey(option) === value));
                    setSelectedSubjectNode(null);
                }}
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
                                    selectedKeys={selectedNode === null ? [] : [selectedNode]} onExpand={keys => setExpandedKeys(keys)}
                                    selectable={subject === undefined || data !== undefined}
                                    onSelect={selectNode} />
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
