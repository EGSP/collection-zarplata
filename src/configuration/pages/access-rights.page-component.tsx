import { Alert, Card, Collapse, Empty, Flex, Input, Space, Spin, Tag, Tree, Typography } from 'antd';
import type { TreeProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'react';
import type { AccessExplanation, AccessNode, AccessRole } from '../../server/authorization/access-descriptions';
import { Column, Grid, Page, useActionResult, type ColumnCount } from '../../web/sdk';

const target = { kind: 'platform', name: 'authorization' } as const;

/**
 * Ширины областей страницы в колонках сетки. Начиная с `lg` дерево прав стоит слева от объяснения
 * и уже его; на более узком контейнере объяснение переносится под дерево. Списки пользователей
 * и ролей внутри объяснения делят его пополам, когда оно не уже точки `md`.
 */
const treeSpan: ColumnCount = { lg: 6 };
const explanationSpan: ColumnCount = { lg: 10 };
const holdersSpan: ColumnCount = { md: 4 };

/** Поиск буквальной подстроки, включая кириллицу. Ключи помогают найти право из ответа 403. */
function normalized(value: string): string {
    return value.normalize('NFC').toLocaleLowerCase('ru').trim();
}

/** Отбирает совпадения с родителями; совпавший объект сохраняет все свои права и нулевые узлы. */
function searchTree(nodes: readonly AccessNode[], search: string) {
    const expanded = new Set<Key>();
    const phrase = normalized(search);
    function filter(node: AccessNode): AccessNode | null {
        const children = node.children.flatMap((child) => filter(child) ?? []);
        const matches = normalized(node.title).includes(phrase) || normalized(node.key).includes(phrase);
        if (!matches && children.length === 0) return null;
        if (node.children.length > 0) expanded.add(node.key);
        return { ...node, children: matches ? node.children : children };
    }
    return { nodes: phrase === '' ? nodes : nodes.flatMap((node) => filter(node) ?? []), expanded: [...expanded] };
}

/** Все роли-основания; grantAll обозначается словами, а не только цветом. */
function RoleReasons({ roles }: { readonly roles: readonly AccessRole[] }) {
    return <Space wrap>{roles.map((role) => <Tag key={role.name}>{role.title}{role.all ? ' (полный доступ)' : ''}</Tag>)}</Space>;
}

/**
 * Слева дерево с числом пользователей, справа объяснение выбранного права или поддерева.
 * Стрелка Tree меняет раскрытие, выбор названия меняет только панель объяснения.
 */
export default function AccessRightsPage() {
    const tree = useActionResult<{ readonly nodes: readonly AccessNode[] }>({ object: target, action: 'tree' });
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState<string | null>(null);
    const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
    const filtered = useMemo(() => searchTree(tree.data?.nodes ?? [], search), [tree.data, search]);
    // Новый поисковый запрос раскрывает путь. После этого стрелками можно свернуть его вручную.
    useEffect(() => {
        if (normalized(search) !== '') setExpandedKeys(filtered.expanded);
    }, [filtered, search]);
    const explanation = useActionResult<AccessExplanation>({ object: target, action: 'explain', payload: { key: selected ?? '' }, enabled: selected !== null });
    const detail = explanation.data?.node.key === selected ? explanation.data : undefined;

    const treeData = useMemo(() => {
        function convert(nodes: readonly AccessNode[]): NonNullable<TreeProps['treeData']> {
            return nodes.map((node) => ({
                key: node.key, title: <span>{node.title} ({node.count})</span>,
                isLeaf: node.right !== null, children: convert(node.children),
            }));
        }
        return convert(filtered.nodes);
    }, [filtered]);

    return <Page title="Права доступа">
        <Grid>
            <Column span={treeSpan}>
                <Card size="small">
                    <Flex vertical gap="middle">
                        <Input.Search aria-label="Поиск объекта или права" placeholder="Найти объект или право" allowClear value={search} onChange={(event) => setSearch(event.target.value)} />
                        {tree.loading && tree.data === undefined ? <Spin /> : tree.data === undefined
                            ? <Alert type="error" title="Не удалось получить права доступа. Проверьте разрешение просмотра и соединение с сервером." />
                            : filtered.nodes.length === 0 ? <Empty description="Ничего не найдено" />
                            : <Tree aria-label="Дерево прав доступа" blockNode treeData={treeData} expandedKeys={expandedKeys} autoExpandParent={false}
                                selectedKeys={selected === null ? [] : [selected]} onExpand={(keys) => setExpandedKeys(keys)}
                                onSelect={(_, information) => setSelected(String(information.node.key))} />}
                    </Flex>
                </Card>
            </Column>
            <Column span={explanationSpan}>
                <Card size="small" title={detail === undefined ? 'Объяснение доступа' : `${detail.node.title} (${detail.node.count})`}>
                    {selected === null ? <Typography.Text type="secondary">Нажмите на название объекта или права. Стрелка раскрывает дочерние узлы.</Typography.Text>
                        : explanation.loading && detail === undefined ? <Spin />
                        : detail === undefined ? <Alert type="error" title="Не удалось получить объяснение доступа" />
                        // Своя сетка внутри карточки: её точки перелома считаются по ширине карточки.
                        : <Grid gutter="narrow"><Column span={holdersSpan}>
                            <Card size="small" title={`Пользователи (${detail.users.length})`}>
                                <section aria-label="Пользователи с доступом" tabIndex={0} style={{ height: 'clamp(240px, 50vh, 560px)', overflowY: 'auto' }}>
                                    {detail.users.length === 0 ? <Empty description="Нет активных пользователей с доступом" />
                                        : detail.node.right !== null ? <Flex vertical gap="small">{detail.users.map((user) => <Card key={user.guid} size="small">
                                            <Flex vertical gap="small"><Typography.Text strong>{user.name}</Typography.Text><RoleReasons roles={user.rights[0]?.roles ?? []} /></Flex>
                                        </Card>)}</Flex>
                                            : <Collapse ghost items={detail.users.map((user) => ({ key: user.guid, label: user.name,
                                                children: <Collapse ghost items={user.rights.map((right) => ({ key: right.key, label: right.title, children: <RoleReasons roles={right.roles} /> }))} />,
                                            }))} />}
                                </section>
                            </Card>
                        </Column><Column span={holdersSpan}>
                            <Card size="small" title={`Роли (${detail.roles.length})`}>
                                <section aria-label="Роли с доступом" tabIndex={0} style={{ height: 'clamp(240px, 50vh, 560px)', overflowY: 'auto' }}>
                                    {detail.roles.length === 0 ? <Empty description="Нет ролей с доступом" />
                                        : detail.node.right === null ? <Collapse ghost items={detail.roles.map((role) => ({ key: role.name,
                                            label: <Flex vertical gap="small"><Typography.Text>{role.title}</Typography.Text>{role.all && <Tag>Полный доступ</Tag>}</Flex>,
                                            children: <Flex vertical gap="small">{role.rights.map((right) => <Typography.Text key={right.key}>{right.title}</Typography.Text>)}</Flex>,
                                        }))} /> : <Flex vertical gap="small">{detail.roles.map((role) => <Card key={role.name} size="small">
                                            <Flex vertical gap="small">
                                                <Typography.Text strong>{role.title}</Typography.Text>
                                                {role.all && <Tag>Полный доступ</Tag>}
                                            </Flex>
                                        </Card>)}</Flex>}
                                </section>
                            </Card>
                        </Column></Grid>}
                </Card>
            </Column>
        </Grid>
    </Page>;
}
