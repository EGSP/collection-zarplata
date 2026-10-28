import { Alert, Button, Flex, Typography } from 'antd';
import { ActionButton, FieldDisplay, Panel, RecordLink, useListControls, useObjectView, useOpenRecord } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { employeeCount, useCurrentShift } from './current-shift-state';

/**
 * Блок «Текущая смена» над списком смен: показывает открытую смену и даёт
 * открыть новую или закрыть текущую.
 *
 * Открытую смену блок читает хуком `useCurrentShift`, как и рабочее место продавца.
 * Правила блок не проверяет. Доступность кнопок следует только из того, есть ли открытая смена,
 * а отказ политики, например при пересечении дат, показывает обычное уведомление с текстом сервера.
 *
 * Из двух кнопок доступна одна, вторая остаётся на месте неактивной: так кнопки не меняют
 * положение при смене состояния. Кнопки, на действие которой у пользователя нет права, нет совсем.
 *
 * Над списком смен блок убирает кнопку «Создать» и пометку удаления из меню строки: смену открывают
 * кнопкой блока, а пометку удаления политика смены отклоняет. Вне стандартного списка это
 * управление ничего не делает, поэтому блок можно поставить и в другое место.
 */
export default function CurrentShift() {
    const shifts = Objects.document.shift;
    const view = useObjectView(shifts);
    const openRecord = useOpenRecord();
    const { known, error, shift: current } = useCurrentShift();
    useListControls({ hideCreate: true, hiddenRowActions: ['markDeleted', 'unmarkDeleted'] });

    if (error !== null && !known) {
        return <Alert type="error" showIcon title="Не удалось прочитать текущую смену" description={error.message} />;
    }

    const creatable = view?.form?.actions.some((action) => action.name === 'save') === true;
    return (
        <Panel title="Текущая смена">
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
                        {current.employees !== undefined && <Typography.Text>{employeeCount(current.employees)}</Typography.Text>}
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
        </Panel>
    );
}
