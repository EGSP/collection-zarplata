import { Typography } from 'antd';
import { useFormRestrictions } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Управляет формой закрытия периода. Поля и начисление недоступны для изменения: закрытие создаёт
 * действие «Закрыть период» на странице «Зарплата», а проведение сверяет начисление с расчётом,
 * поэтому изменённые вручную строки всё равно не провелись бы.
 *
 * Действия «Закрыть период» и «Расчёт зарплаты» на форме скрыты: они относятся к странице
 * «Зарплата», а не к открытой записи. Отмена проведения остаётся: так открывают период заново.
 */
export default function PeriodClosingState() {
    useFormRestrictions(Objects.document.periodClosing, { readOnly: true, hiddenActions: ['closePeriod', 'payrollPreview'] });
    return <Typography.Text type="secondary">Начисление зафиксировано при закрытии и не пересчитывается. Отмена проведения открывает период заново.</Typography.Text>;
}
