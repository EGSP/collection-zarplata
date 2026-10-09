import { Typography } from 'antd';
import { FieldDisplay, useFormData, useFormRestrictions } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Состояние смены на её форме: «Открыта с …» либо «Закрыта …». Поле даты закрытия на форме
 * скрыто, поэтому о закрытии сообщает этот элемент.
 *
 * Он же управляет формой. Закрытую смену нельзя изменить и закрыть повторно. Проведение, отмена
 * проведения и пометка удаления скрыты у любой смены: проводит смену только закрытие, а остальное
 * политика смены отклоняет, и кнопки вели бы к отказу сервера.
 *
 * Условие берётся из записанного состояния: смена становится закрытой после ответа сервера
 * на действие закрытия, и форма меняет состояние без повторного открытия.
 */
export default function ShiftState() {
    const { saved } = useFormData(Objects.document.shift);
    const closedAt = saved?.closedAt ?? null;
    useFormRestrictions(Objects.document.shift, closedAt === null
        ? { hiddenActions: ['post', 'unpost', 'markDeleted'] }
        : { readOnly: true, hiddenActions: ['close', 'post', 'unpost', 'markDeleted'] });
    // У новой смены состояния ещё нет: она станет открытой после записи.
    if (saved === null) return null;
    return (
        <Typography.Text strong>
            {closedAt === null ? 'Открыта с ' : 'Закрыта '}
            <FieldDisplay field={{ kind: 'dateTime', target: null }} value={closedAt ?? saved.date} />
        </Typography.Text>
    );
}
