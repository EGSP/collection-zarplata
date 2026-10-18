import { Alert, Button, Card, Descriptions, Flex, Popconfirm, Progress, Space, Spin, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { BackupFile, BackupOverview, BackupSource, RunningBackup } from '../../server/backup/descriptions';
import { Page, useAction, useActionResult } from '../../web/sdk';

const backups = { kind: 'platform', name: 'backups' } as const;

/** Пока идёт копия, страница перечитывает состояние с этим интервалом: копию пишет сервер сам. */
const runningRefreshInterval = 2000;

const sourceTitles: Readonly<Record<BackupSource, string>> = { schedule: 'По расписанию', manual: 'Вручную' };

/** Размер в байтах привычными единицами: «1,5 ГБ». */
function formatSize(bytes: number): string {
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toLocaleString('ru', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

function formatTime(value: string): string {
    return new Date(value).toLocaleString('ru');
}

/**
 * Резервные копии базы: место на диске, копии в каталоге, идущие копии и итог последней.
 * Копия пишется в фоне, поэтому кнопка создания только начинает её, а ход копии страница
 * узнаёт, перечитывая состояние.
 */
export default function BackupsPage() {
    const [refreshInterval, setRefreshInterval] = useState<number | false>(false);
    const result = useActionResult<BackupOverview>({ object: backups, action: 'list', refreshInterval });
    const action = useAction();
    const overview = result.data;
    const running = overview?.running ?? [];
    // Опрос включается, пока есть идущие копии, и выключается, когда они закончились.
    const wanted = running.length > 0 ? runningRefreshInterval : false;
    if (wanted !== refreshInterval) setRefreshInterval(wanted);
    const canStart = overview !== undefined && overview.available && overview.canWrite && running.length < overview.limit;

    async function create(): Promise<void> {
        await action({ object: backups, action: 'create', successMessage: 'Копирование начато', failureMessage: 'Копирование не начато' }).catch(() => undefined);
        await result.refresh();
    }

    async function cancel(backup: RunningBackup): Promise<void> {
        await action({ object: backups, action: 'cancel', payload: { id: backup.id }, successMessage: 'Отмена копирования запрошена', failureMessage: 'Копирование не прервано' }).catch(() => undefined);
        await result.refresh();
    }

    return <Page title="Резервные копии" actions={overview?.canWrite === true && <Button type="primary" disabled={!canStart} onClick={() => { void create(); }}>Создать копию</Button>}>
        {!result.loading && overview === undefined && <Alert type="error" title="Не удалось получить состояние копирования. Проверьте право чтения и соединение с сервером." />}
        {overview !== undefined && !overview.available && <Alert type="info" title="База открыта в памяти: резервное копирование недоступно." />}
        {overview?.directoryError != null && <Alert type="error" title={overview.directoryError} />}
        {overview !== undefined && overview.available && <Flex vertical gap="middle">
            <Card size="small" title="Диск">
                {overview.disk === null ? <Typography.Text type="secondary">Нет сведений о диске</Typography.Text> : <Flex vertical gap="small">
                    <Progress percent={Math.round(overview.disk.used / overview.disk.total * 100)} status={overview.disk.free < overview.disk.total * 0.1 ? 'exception' : 'normal'} />
                    <Typography.Text>Занято {formatSize(overview.disk.used)} из {formatSize(overview.disk.total)}, свободно {formatSize(overview.disk.free)}</Typography.Text>
                </Flex>}
                <Descriptions size="small" column={1} style={{ marginTop: 12 }} items={[
                    { key: 'directory', label: 'Каталог', children: overview.directory },
                    { key: 'schedule', label: 'Расписание', children: overview.schedule.length === 0 ? 'Не задано, только ручные копии' : <Space wrap>{overview.schedule.map((line) => <Tag key={line}>{line}</Tag>)}</Space> },
                    { key: 'next', label: 'Следующая копия', children: overview.nextRun === null ? '—' : formatTime(overview.nextRun) },
                    { key: 'keep', label: 'Хранится копий', children: overview.keep },
                ]} />
            </Card>
            {running.length > 0 && <Card size="small" title={<Space><Spin size="small" />Идёт копирование</Space>}>
                <Table<RunningBackup> rowKey="id" size="small" pagination={false} dataSource={running} columns={[
                    { title: 'Начата', render: (_, backup) => formatTime(backup.startedAt) },
                    { title: 'Источник', render: (_, backup) => sourceTitles[backup.source] },
                    { title: 'Состояние', render: (_, backup) => backup.cancelling ? 'Прерывается' : 'Пишется' },
                    { title: '', align: 'right', render: (_, backup) => overview.canWrite && <Popconfirm title="Прервать копирование?" description="Недописанный файл будет удалён." okText="Прервать" cancelText="Продолжить" onConfirm={() => cancel(backup)}>
                        <Button danger size="small" disabled={backup.cancelling}>Прервать</Button>
                    </Popconfirm> },
                ]} />
            </Card>}
            {overview.lastOutcome !== null && <Alert
                type={overview.lastOutcome.kind === 'succeeded' ? 'success' : overview.lastOutcome.kind === 'failed' ? 'error' : 'warning'}
                title={`${overview.lastOutcome.kind === 'succeeded' ? 'Последняя копия записана' : overview.lastOutcome.kind === 'failed' ? 'Последняя копия не записана' : 'Последняя копия прервана'}: ${formatTime(overview.lastOutcome.finishedAt)}`}
                description={overview.lastOutcome.message ?? overview.lastOutcome.file ?? undefined} />}
            <Table<BackupFile> rowKey="name" loading={result.loading && running.length === 0} dataSource={[...overview.files]} locale={{ emptyText: 'Копий пока нет' }} columns={[
                { title: 'Создана', render: (_, file) => formatTime(file.createdAt) },
                { title: 'Источник', render: (_, file) => sourceTitles[file.source] },
                { title: 'Размер', align: 'right', render: (_, file) => formatSize(file.size) },
                { title: 'Файл', dataIndex: 'name' },
            ]} />
        </Flex>}
    </Page>;
}
