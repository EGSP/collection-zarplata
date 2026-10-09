import { Alert, Button, Card, Flex, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { ActionButton, FieldDisplay, RecordLink, useListControls, useObjectView, useOpenRecord, useRecord, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Число сотрудников с согласованным словом: «1 сотрудник», «2 сотрудника», «5 сотрудников». */
function employeeCount(count: number): string {
    const lastTwo = count % 100;
    const last = count % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return `${count} сотрудников`;
    if (last === 1) return `${count} сотрудник`;
    if (last >= 2 && last <= 4) return `${count} сотрудника`;
    return `${count} сотрудников`;
}

/**
 * Блок «Текущая смена» на главном экране и над списком смен: показывает открытую смену и даёт
 * открыть новую или закрыть текущую.
 *
 * Открытой считается смена без даты закрытия. Блок находит её чтением списка смен с постоянным
 * отбором, а не отдельным действием сервера: политика смены допускает не больше одной такой записи.
 * Правила блок не проверяет. Доступность кнопок следует только из того, есть ли открытая смена,
 * а отказ политики, например при пересечении дат, показывает обычное уведомление с текстом сервера.
 *
 * Из двух кнопок доступна одна, вторая остаётся на месте неактивной: так кнопки не меняют
 * положение при смене состояния. Кнопки, на действие которой у пользователя нет права, нет совсем.
 *
 * Над списком смен блок убирает кнопку «Создать» и пометку удаления из меню строки: смену открывают
 * кнопкой блока, а пометку удаления политика смены отклоняет. На главном экране списка нет,
 * и это управление ничего не делает.
 *
 * Блок перечитывать данные сам не должен: запись смены в окне и действие закрытия помечают
 * сохранённые ответы сервера устаревшими, и чтения блока повторяются на всех вкладках, где он стоит.
 */
export default function CurrentShift() {
    const shifts = Objects.document.shift;
    const view = useObjectView(shifts);
    const openRecord = useOpenRecord();
    const list = useRecordList(shifts, { permanentFilter: [{ field: 'closedAt', operator: 'equals', value: null }], pageSize: 1 });
    useListControls({ hideCreate: true, hiddenRowActions: ['markDeleted', 'unmarkDeleted'] });

    const current = list.records[0] ?? null;
    // Состав лежит в табличной части, а строка списка её не содержит.
    const { record } = useRecord(shifts, current?.guid ?? null);

    // До первого ответа сервера список пуст так же, как при отсутствии открытой смены.
    // Без этого признака блок на время загрузки сообщал бы, что смена не открыта, и разрешал её открыть.
    const [known, setKnown] = useState(false);
    useEffect(() => {
        if (!list.loading && list.error === null) setKnown(true);
    }, [list.loading, list.error]);

    if (list.error !== null && !known) {
        return <Alert type="error" showIcon title="Не удалось прочитать текущую смену" description={list.error.message} />;
    }

    const creatable = view?.form?.actions.some((action) => action.name === 'save') === true;
    return (
        <Card size="small" title="Текущая смена">
            <Flex justify="space-between" align="center" gap="middle" wrap>
                {!known ? (
                    <Typography.Text type="secondary">Загрузка…</Typography.Text>
                ) : current === null ? (
                    <Typography.Text type="secondary">Смена не открыта</Typography.Text>
                ) : (
                    <Flex gap="large" align="center" wrap>
                        <Typography.Text strong>
                            <RecordLink reference={{ kind: shifts.kind, name: shifts.name, guid: current.guid }} />
                        </Typography.Text>
                        <Typography.Text>
                            Открыта <FieldDisplay field={{ kind: 'dateTime', target: null }} value={current.date} />
                        </Typography.Text>
                        {record !== undefined && <Typography.Text>{employeeCount(record.employees.length)}</Typography.Text>}
                    </Flex>
                )}
                <Flex gap="small">
                    {creatable && (
                        <Button type="primary" disabled={!known || current !== null} onClick={() => void openRecord(shifts, null, 'dialog')}>
                            Открыть
                        </Button>
                    )}
                    <ActionButton object={shifts} record={null} action="close" disabled={!known || current === null}>
                        Закрыть
                    </ActionButton>
                </Flex>
            </Flex>
        </Card>
    );
}
