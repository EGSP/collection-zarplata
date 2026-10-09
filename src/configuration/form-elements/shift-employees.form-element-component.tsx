import { Button, Flex, Typography } from 'antd';
import { useFormValue, useFormData, useObjectView, useRecordList, useReferencePresentation, type ObjectView } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Сотрудников в магазине немного, поэтому все они читаются одной страницей без подгрузки.
 * Сотрудник сверх этого числа в наборе не появится, но его можно добавить строкой состава.
 */
const employeeLimit = 500;

/** Кнопка сотрудника: подпись читается как представление записи, то есть ФИО физического лица. */
function EmployeeButton({ view, guid, selected, onToggle }: { view: ObjectView; guid: string; selected: boolean; onToggle: () => void }) {
    const presentation = useReferencePresentation(view, guid);
    return <Button type={selected ? 'primary' : 'default'} aria-pressed={selected} onClick={onToggle}>{presentation.text}</Button>;
}

/**
 * Набор состава смены: ФИО всех сотрудников без пометки удаления. Нажатие добавляет строку
 * сотрудника в состав, повторное нажатие удаляет её; сотрудники из состава выделены.
 *
 * Состав элемент читает и меняет через данные формы, поэтому он согласован с таблицей состава
 * под ним: строка, добавленная или удалённая в таблице, сразу меняет выделение, а изменение
 * элементом считается несохранённым вводом. На закрытой смене кнопки недоступны: недоступность
 * им передаёт форма.
 */
export default function ShiftEmployees() {
    const form = useFormData(Objects.document.shift);
    const lines = useFormValue(Objects.document.shift, 'employees');
    const view = useObjectView(Objects.catalog.employees);
    const employees = useRecordList(Objects.catalog.employees, {
        permanentFilter: [{ field: 'deletedAt', operator: 'equals', value: null }],
        sort: [{ field: 'name', direction: 'ascending' }],
        pageSize: employeeLimit,
    });
    // Без права читать сотрудников сервер их описание не отдаёт, и набирать состав не из кого.
    if (view === undefined) return null;
    if (!employees.loading && employees.records.length === 0) {
        return <Typography.Text type="secondary">В справочнике «Сотрудники» нет записей</Typography.Text>;
    }
    // Состав вычисляется от текущего значения формы, а не от `lines`: при быстрых нажатиях подряд
    // второе нажатие по составу прошлой отрисовки отменило бы первое.
    const toggle = (guid: string) => form.setValue('employees', (current) => current.some((line) => line.employee === guid)
        ? current.filter((line) => line.employee !== guid)
        : [...current, { employee: guid }]);
    return (
        <Flex wrap gap="small">
            {employees.records.map((employee) => (
                <EmployeeButton
                    key={employee.guid}
                    view={view}
                    guid={employee.guid}
                    selected={lines.some((line) => line.employee === employee.guid)}
                    onToggle={() => toggle(employee.guid)}
                />
            ))}
        </Flex>
    );
}
