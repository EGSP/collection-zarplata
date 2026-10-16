import { Button, Flex, Typography } from 'antd';
import { listRecordPresentation, useFormValue, useFormData, useObjectView, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Сотрудников в магазине немного, поэтому все они читаются одной страницей без подгрузки.
 * Сотрудник сверх этого числа в наборе не появится, но его можно добавить строкой состава.
 */
const employeeLimit = 500;

/**
 * Набор состава смены: ФИО всех сотрудников без пометки удаления по алфавиту, то есть по фамилии,
 * с которой ФИО начинается. Нажатие добавляет строку сотрудника в состав, повторное нажатие
 * удаляет её; сотрудники из состава выделены.
 *
 * Состав элемент читает и меняет через данные формы, поэтому он согласован с таблицей состава,
 * если форма её выводит: строка, добавленная или удалённая в таблице, сразу меняет выделение, а изменение
 * элементом считается несохранённым вводом. На закрытой смене кнопки недоступны: недоступность
 * им передаёт форма.
 */
export default function ShiftEmployees() {
    const form = useFormData(Objects.document.shift);
    const lines = useFormValue(Objects.document.shift, 'employees');
    const view = useObjectView(Objects.catalog.employees);
    const employees = useRecordList(Objects.catalog.employees, {
        permanentFilter: [{ field: 'deletedAt', operator: 'equals', value: null }],
        pageSize: employeeLimit,
    });
    // Без права читать сотрудников сервер их описание не отдаёт, и набирать состав не из кого.
    if (view === undefined) return null;
    if (!employees.loading && employees.records.length === 0) {
        return <Typography.Text type="secondary">В справочнике «Сотрудники» нет записей</Typography.Text>;
    }
    // ФИО хранится в физическом лице, и сервер по нему не сортирует. Список возвращает
    // представления ссылок своей страницы, поэтому кнопки упорядочиваются по ним на клиенте.
    const buttons = employees.records
        .map((employee) => ({ guid: employee.guid, text: listRecordPresentation(view, employee, employees.presentations) }))
        .sort((left, right) => left.text.localeCompare(right.text, 'ru'));
    // Состав вычисляется от текущего значения формы, а не от `lines`: при быстрых нажатиях подряд
    // второе нажатие по составу прошлой отрисовки отменило бы первое.
    const toggle = (guid: string) => form.setValue('employees', (current) => current.some((line) => line.employee === guid)
        ? current.filter((line) => line.employee !== guid)
        : [...current, { employee: guid }]);
    return (
        <Flex wrap gap="small">
            {buttons.map((employee) => {
                const selected = lines.some((line) => line.employee === employee.guid);
                return (
                    <Button key={employee.guid} type={selected ? 'primary' : 'default'} aria-pressed={selected} onClick={() => toggle(employee.guid)}>
                        {employee.text}
                    </Button>
                );
            })}
        </Flex>
    );
}
