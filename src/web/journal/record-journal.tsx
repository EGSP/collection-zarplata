/** Просмотр истории сохранённой записи. Чтение не выполняет действия формы и не сохраняет её ввод. */
import { useQuery } from '@tanstack/react-query';
import { Alert, Avatar, Button, Collapse, Dropdown, Empty, Flex, Modal, Pagination, Skeleton, Table, Typography, theme } from 'antd';
import { HistoryOutlined, MoreOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import type { JournalEntry, JournalTraceNode } from '../../server/journal/descriptions';
import type { FormAction, FormTablePart, ObjectView } from '../../server/ui/descriptions';
import { useMetadata } from '../data-provider/metadata';
import { perform } from '../data-provider/perform';
import { recordGuid, type RecordData } from '../data-provider/records';
import { useRecordPresentation } from '../references/presentation';
import { RecordLink } from '../references/reference-display';
import { FieldDisplay } from '../widgets/registry';
import { useWindowScope } from '../window/window-scope';
import { useActionConfirmation } from '../sdk/action-confirmation';

interface HistoryPage {
    readonly items: readonly JournalEntry[];
    readonly total: number;
}

const journalTarget = { kind: 'platform', name: 'journal' };
const pageSize = 20;
const actionTitles: Readonly<Record<string, string>> = {
    save: 'Запись сохранена', post: 'Документ проведён', unpost: 'Проведение отменено',
    markDeleted: 'Установлена пометка удаления', unmarkDeleted: 'Снята пометка удаления',
    delete: 'Запись удалена', import: 'Данные импортированы', repost: 'Документы перепроведены',
};

/** Свойства меню «Ещё» формы записи. */
export interface RecordMoreActionsProperties {
    readonly object: ObjectView;
    readonly record: RecordData | null;
    /** Собственные действия с местом показа «Ещё», доступные на форме сейчас. */
    readonly actions?: ReadonlyArray<FormAction>;
    /** Выполняет действие меню через форму; об отказе сообщает уведомление. */
    readonly onRun?: (action: FormAction) => Promise<unknown>;
    /** Форма выполняет действие: пункты действий недоступны, как и кнопки формы. */
    readonly busy?: boolean;
}

/**
 * Общие дополнительные команды стандартной и собственной формы, использующей RecordFormActions:
 * журнал действий и собственные действия с местом показа «Ещё». Действие с подтверждением
 * выполняется только после него (`useActionConfirmation`).
 */
export function RecordMoreActions({ object, record, actions = [], onRun, busy = false }: RecordMoreActionsProperties) {
    const command = object.form?.actions.find((action) => action.opens === 'journal');
    const [opened, setOpened] = useState(false);
    const scope = useWindowScope();
    const confirmation = useActionConfirmation();
    // Регистры не имеют карточек записи с guid; их историю этот вход не открывает.
    if (command === undefined && actions.length === 0) return null;
    const items = [
        ...command === undefined ? [] : [{ key: command.name, label: command.title, icon: <HistoryOutlined />, disabled: record === null }],
        ...actions.map((action) => ({ key: action.name, label: action.title, disabled: busy || onRun === undefined, danger: action.confirmation?.tone === 'danger' })),
    ];
    const select = async (key: string) => {
        if (key === command?.name) return setOpened(true);
        const action = actions.find((candidate) => candidate.name === key);
        if (action === undefined || onRun === undefined || !(await confirmation.confirm(action))) return;
        // Об отказе сервера уже сообщило уведомление, поэтому ошибка здесь не обрабатывается.
        await onRun(action).catch(() => undefined);
    };
    return (
        <>
            <Dropdown trigger={['click']} menu={{ items, onClick: ({ key }) => void select(key) }}>
                <Button icon={<MoreOutlined />}>Ещё</Button>
            </Dropdown>
            {confirmation.dialog}
            {opened && record !== null && (
                <Modal
                    open={scope.active}
                    title="Журнал действий"
                    width="min(1000px, calc(100% - 32px))"
                    onCancel={() => setOpened(false)}
                    footer={<Button onClick={() => setOpened(false)}>Закрыть</Button>}
                    styles={{ body: { maxHeight: '65vh', overflowY: 'auto', overflowX: 'hidden' } }}
                >
                    <RecordJournal object={object} record={record} />
                </Modal>
            )}
        </>
    );
}

/** Пагинация принадлежит одной открытой истории; прежняя запись не подставляется во время загрузки. */
function RecordJournal({ object, record }: { readonly object: ObjectView; readonly record: RecordData }) {
    const [page, setPage] = useState(1);
    const presentation = useRecordPresentation(object, record);
    const guid = recordGuid(record);
    const history = useQuery({
        queryKey: ['journal', object.kind, object.name, guid, page],
        queryFn: () => perform<HistoryPage>({ target: journalTarget, action: 'history', payload: { targetKind: object.kind, targetName: object.name, targetGuid: guid, page, pageSize } }),
        placeholderData: () => undefined,
        retry: false,
    });
    return (
        <Flex vertical gap="middle">
            <Flex justify="space-between" align="center" gap="small" wrap>
                <Typography.Text strong>{object.title}: {presentation.text}</Typography.Text>
                <Button onClick={() => { void history.refetch(); }} loading={history.isFetching}>Обновить</Button>
            </Flex>
            <Typography.Text type="secondary">Сначала новые события</Typography.Text>
            {history.isPending ? <Skeleton active /> : history.isError ? <JournalError error={history.error} retry={() => { void history.refetch(); }} /> : (
                <>
                    {history.data.items.length === 0 ? <Empty description="Действий пока нет" /> : (
                        <Flex vertical gap="middle" role="list" aria-label="События журнала">
                            {history.data.items.map((entry) => <JournalMessage key={entry.guid} entry={entry} />)}
                        </Flex>
                    )}
                    <Pagination current={page} total={history.data.total} pageSize={pageSize} showSizeChanger={false} onChange={setPage} hideOnSinglePage showTotal={(total) => `Всего событий: ${total}`} />
                </>
            )}
        </Flex>
    );
}

/** Сообщение ленты с отдельным раскрытием изменений и всей цепочки внешней операции. */
function JournalMessage({ entry }: { readonly entry: JournalEntry }) {
    const { token } = theme.useToken();
    const [traceOpened, setTraceOpened] = useState(false);
    return (
        <Flex gap="small" align="start" role="listitem">
            <Avatar icon={<UserOutlined />} style={{ flexShrink: 0 }} />
            <Flex vertical gap="small" style={{ minWidth: 0, flex: 1, padding: token.paddingSM, background: token.colorFillQuaternary, borderRadius: token.borderRadiusLG }}>
                <Flex justify="space-between" gap="small" wrap>
                    <Typography.Text strong>{entry.userName ?? (entry.userGuid === null ? 'Система' : `Пользователь ${entry.userGuid}`)}</Typography.Text>
                    <Typography.Text type="secondary">{new Date(entry.occurredAt).toLocaleString('ru-RU')}</Typography.Text>
                </Flex>
                <ActionTitle entry={entry} />
                <JournalChanges entry={entry} />
                <Collapse ghost onChange={(keys) => setTraceOpened(keys.includes('trace'))} items={[{
                    key: 'trace', label: 'Цепочка действий',
                    children: traceOpened ? <JournalTrace traceGuid={entry.traceGuid} selected={entry.actionGuid} /> : null,
                }]} />
            </Flex>
        </Flex>
    );
}

/** Названия собственных действий берутся из описаний, неизвестное имя сохраняется для старой истории. */
function ActionTitle({ entry, target = false }: { readonly entry: JournalEntry; readonly target?: boolean }) {
    const object = useMetadata().data?.objects.find((candidate) => candidate.kind === entry.targetKind && candidate.name === entry.targetName);
    const title = actionTitles[entry.action] ?? object?.form?.actions.find((action) => action.name === entry.action)?.title ?? entry.action;
    return <div><Typography.Text strong>{title}</Typography.Text>{target && (
        <div><Typography.Text type="secondary">{object?.title ?? `${entry.targetKind}.${entry.targetName}`}</Typography.Text>
            {entry.targetGuid !== null && (entry.targetKind === 'catalog' || entry.targetKind === 'document') && <>: <RecordLink reference={{ kind: entry.targetKind, name: entry.targetName, guid: entry.targetGuid }} /></>}
        </div>
    )}</div>;
}

/** Цепочка загружается только после раскрытия; её ошибки не скрывают историю записи. */
function JournalTrace({ traceGuid, selected }: { readonly traceGuid: string; readonly selected: string }) {
    const trace = useQuery({
        queryKey: ['journal-trace', traceGuid],
        queryFn: () => perform<{ readonly actions: readonly JournalTraceNode[] }>({ target: journalTarget, action: 'trace', payload: { traceGuid } }),
        placeholderData: () => undefined,
        retry: false,
    });
    if (trace.isPending) return <Skeleton active paragraph={{ rows: 2 }} />;
    if (trace.isError) return <JournalError error={trace.error} retry={() => { void trace.refetch(); }} />;
    if (trace.data.actions.length === 0) return <Empty description="Цепочка не найдена" />;
    return <TraceNodes nodes={trace.data.actions} selected={selected} />;
}

/** Каждый уровень раскрывается отдельно, чтобы длинная цепочка не вытесняла всю ленту. */
function TraceNodes({ nodes, selected }: { readonly nodes: readonly JournalTraceNode[]; readonly selected: string }) {
    return <Collapse items={nodes.map((node) => ({
        key: node.actionGuid,
        label: <Flex vertical gap={4}><ActionTitle entry={node} target />{node.actionGuid === selected && <Typography.Text type="secondary">Событие этой записи</Typography.Text>}</Flex>,
        children: <Flex vertical gap="small">
            <Typography.Text type="secondary">{new Date(node.occurredAt).toLocaleString('ru-RU')} · {node.userName ?? (node.userGuid === null ? 'Система' : `Пользователь ${node.userGuid}`)}</Typography.Text>
            <JournalChanges entry={node} />
            {node.children.length > 0 && <TraceNodes nodes={node.children} selected={selected} />}
        </Flex>,
    }))} />;
}

/** Изменения показываются по полям, табличные части целиком: журнал не сопоставляет отдельные строки. */
function JournalChanges({ entry }: { readonly entry: JournalEntry }) {
    const object = useMetadata().data?.objects.find((candidate) => candidate.kind === entry.targetKind && candidate.name === entry.targetName);
    if (entry.changes === null) return <Typography.Text type="secondary">Изменения полей для этого действия не записаны.</Typography.Text>;
    const changes = Object.entries(entry.changes);
    if (changes.length === 0) return <Typography.Text type="secondary">Значения не изменились.</Typography.Text>;
    const fields = object?.form?.calculations?.fields ?? object?.form?.fields ?? [];
    const parts = object?.tableParts ?? object?.form?.tableParts ?? [];
    return <Collapse ghost items={[{
        key: 'changes', label: `Изменения (${changes.length})`, children: <Flex vertical gap="middle">
            {changes.map(([name, change]) => {
                const field = fields.find((candidate) => candidate.name === name);
                const part = parts.find((candidate) => candidate.name === name);
                return <Flex vertical gap="small" key={name}>
                    <Typography.Text strong>{field?.title ?? part?.title ?? name}</Typography.Text>
                    <Flex gap="middle" wrap>
                        {(['before', 'after'] as const).map((side) => <div key={side} style={{ flex: '1 1 240px', minWidth: 0 }}>
                            <Typography.Text type="secondary">{side === 'before' ? 'Было' : 'Стало'}</Typography.Text>
                            <div style={{ overflowX: 'auto', overflowWrap: 'anywhere' }}>
                                {part !== undefined ? <JournalTablePart part={part} value={change[side]} />
                                    : change[side] == null ? <Typography.Text type="secondary">Не заполнено</Typography.Text>
                                    : field !== undefined ? <FieldDisplay field={field} value={change[side]} /> : <RawValue value={change[side]} />}
                            </div>
                        </div>)}
                    </Flex>
                </Flex>;
            })}
        </Flex>,
    }]} />;
}

/** Таблица сохраняет порядок строк и форматирование денег, дат и ссылок из обычных форм. */
function JournalTablePart({ part, value }: { readonly part: FormTablePart; readonly value: unknown }) {
    if (!Array.isArray(value) || value.length === 0) return <Typography.Text type="secondary">Нет строк</Typography.Text>;
    const rows = value.map((row: unknown, index) => ({ key: index, values: row as Record<string, unknown> }));
    return <Table size="small" pagination={false} scroll={{ x: 'max-content', y: 260 }} dataSource={rows} columns={part.columns.map((field) => ({
        key: field.name, title: field.title,
        render: (_: unknown, row: typeof rows[number]) => <FieldDisplay field={field} value={row.values[field.name]} />,
    }))} />;
}

/** Историческое поле могло исчезнуть из метаданных; исходное значение остаётся доступным. */
function RawValue({ value }: { readonly value: unknown }) {
    return <pre style={{ margin: 0, maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>;
}

function JournalError({ error, retry }: { readonly error: Error; readonly retry: () => void }) {
    return <Alert type="error" showIcon title="Не удалось загрузить журнал" description={error.message} action={<Button onClick={retry}>Повторить</Button>} />;
}

