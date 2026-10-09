import { Typography } from 'antd';
import { RecordLink, useFormValue } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Основание продажи на её форме: ссылка на отвес, из которого продажа оформлена. Поле основания
 * на форме скрыто, поэтому изменить его с формы нельзя; значение элемент читает из записанного
 * состояния. У продажи без основания элемент ничего не выводит.
 */
export default function SaleBasis() {
    const basis = useFormValue(Objects.document.sale, 'basis');
    if (basis === null) return null;
    const weighings = Objects.document.weighing;
    return (
        <Typography.Text>
            Оформлена из отвеса: <RecordLink reference={{ kind: weighings.kind, name: weighings.name, guid: basis }} />
        </Typography.Text>
    );
}
