import { Flex, Typography } from 'antd';
import { FieldDisplay, useFormValue } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Пробный блок «Итого до скидки» под табличной частью: сумма исходных сумм строк.
 * Служит образцом элемента в группе формы: свойств он не получает, а строки читает из данных
 * формы вместе с несохранёнными, поэтому сумма меняется по мере ввода и при удалении строки.
 *
 * Сумма хранится в копейках, как и значения колонки; в рубли её переводит отображение поля.
 * Не заполненная ещё ячейка в сумму не входит.
 */
export default function SampleTotal() {
    const lines = useFormValue(Objects.document.sample, 'lines');
    const total = lines.reduce((sum, line) => sum + (line.amount ?? 0), 0);
    return (
        <Flex justify="flex-end" gap="small">
            <Typography.Text strong>Итого до скидки:</Typography.Text>
            <FieldDisplay field={{ kind: 'money', target: null }} value={total} />
        </Flex>
    );
}
