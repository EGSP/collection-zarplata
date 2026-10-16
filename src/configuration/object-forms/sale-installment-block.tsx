import { Button, Flex, Radio, Typography } from 'antd';
import type { ComponentType } from 'react';
import { FieldInput, FluidField, Icons, TablePartTitle, useObjectView, useRecord, useReferencePresentation, type ObjectView } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Данные рассрочки, которые продавец вводит на форме продажи: их получает действие «Продать с рассрочкой». */
export interface SaleInstallmentTerms {
    readonly type: string | null;
    readonly person: string | null;
    readonly responsibleEmployee: string | null;
}

/** Данные рассрочки до ввода: ничего не выбрано. */
export const emptyInstallmentTerms: SaleInstallmentTerms = { type: null, person: null, responsibleEmployee: null };

/** Собственная рассрочка: её ведёт магазин, и ответственный сотрудник обязателен. */
const ownInstallment = 'Собственная';

/**
 * Что не заполнено в данных рассрочки. Те же условия проверяет политика рассрочки на сервере,
 * но форма проверяет их до записи продажи: отказ действия после записи оставил бы продажу
 * записанной и перевёл бы форму на её страницу, где блока рассрочки уже нет.
 */
export function installmentTermsProblems(terms: SaleInstallmentTerms): ReadonlyArray<string> {
    return [
        ...(terms.type === null ? ['Выберите тип рассрочки'] : []),
        ...(terms.person === null ? ['Укажите покупателя'] : []),
        ...(terms.type === ownInstallment && terms.responsibleEmployee === null ? ['Выберите ответственного сотрудника собственной рассрочки'] : []),
    ];
}

/**
 * Типы рассрочки со значками. Значения совпадают с `installmentTypes` из `installments.ts`;
 * константы оттуда не импортируются, потому что это серверный модуль, а блок собирается в клиент.
 */
const installmentTypes: ReadonlyArray<{ readonly value: string; readonly icon: ComponentType }> = [
    { value: 'Собственная', icon: Icons.ownInstallment },
    { value: 'Банковская', icon: Icons.bankInstallment },
];

/** Поле «Покупатель»: ссылка на физическое лицо, как поле `person` рассрочки по продаже. */
const personField = { kind: 'reference', target: { kind: Objects.catalog.physicalPersons.kind, name: Objects.catalog.physicalPersons.name } } as const;

/** Свойства блока рассрочки. */
interface SaleInstallmentBlockProperties {
    readonly terms: SaleInstallmentTerms;
    readonly onChange: (terms: SaleInstallmentTerms) => void;
    /** Смена продажи: ответственного выбирают из её состава. */
    readonly shift: string | null;
    readonly disabled: boolean;
    /** Незаполненные данные, о которых блок сообщает под полями; пусто, пока продавец не пытался продать. */
    readonly problems: ReadonlyArray<string>;
}

/**
 * Блок рассрочки на форме новой продажи. Появляется, когда часть оплаты внесена способом
 * «Рассрочка»: на эту сумму при продаже оформляется рассрочка по продаже, и продавцу нужно
 * указать её тип, покупателя и ответственного сотрудника.
 *
 * Тип выбирается кнопками со значками магазина и банка. Ответственного выбирают из состава
 * смены продажи нажатием на ФИО: повторное нажатие снимает выбор. Ответственный нужен только
 * собственной рассрочке; без него сервер откажет при продаже, и продажа не проведётся.
 *
 * Значения хранит форма продажи, а не поля документа: у продажи таких полей нет, их получает
 * действие «Продать с рассрочкой».
 */
export function SaleInstallmentBlock({ terms, onChange, shift, disabled, problems }: SaleInstallmentBlockProperties) {
    return (
        <Flex vertical gap="middle">
            <TablePartTitle>Рассрочка</TablePartTitle>
            <Radio.Group
                optionType="button"
                buttonStyle="solid"
                disabled={disabled}
                value={terms.type}
                onChange={(event) => onChange({ ...terms, type: String(event.target.value) })}
                options={installmentTypes.map((type) => ({
                    value: type.value,
                    label: <Flex gap={6} align="center"><type.icon />{type.value}</Flex>,
                }))}
            />
            {/* Ширина free, как у поля «Покупатель» в описаниях документов: ФИО не обрезается. */}
            <FluidField label="Покупатель" required free>
                <FieldInput field={personField} value={terms.person} disabled={disabled} onChange={(person) => onChange({ ...terms, person: typeof person === 'string' ? person : null })} />
            </FluidField>
            <Flex vertical gap="small">
                <Typography.Text type="secondary">Ответственный сотрудник</Typography.Text>
                <ResponsibleEmployees shift={shift} selected={terms.responsibleEmployee} disabled={disabled}
                    onSelect={(employee) => onChange({ ...terms, responsibleEmployee: employee })} />
            </Flex>
            {problems.map((problem) => <Typography.Text key={problem} type="danger">{problem}</Typography.Text>)}
        </Flex>
    );
}

/** Свойства выбора ответственного. */
interface ResponsibleEmployeesProperties {
    readonly shift: string | null;
    readonly selected: string | null;
    readonly disabled: boolean;
    readonly onSelect: (employee: string | null) => void;
}

/** ФИО сотрудников смены кнопками; выбранный выделен. */
function ResponsibleEmployees({ shift, selected, disabled, onSelect }: ResponsibleEmployeesProperties) {
    const record = useRecord(Objects.document.shift, shift).record;
    const view = useObjectView(Objects.catalog.employees);
    if (shift === null) return <Typography.Text type="secondary">Выберите смену продажи</Typography.Text>;
    // Без права читать сотрудников их ФИО показать нечем.
    if (view === undefined || record === undefined) return null;
    return (
        <Flex wrap gap="small">
            {record.employees.map((line) => line.employee === null ? null : (
                <EmployeeButton key={line.employee} view={view} guid={line.employee} selected={line.employee === selected} disabled={disabled}
                    onClick={(guid) => onSelect(guid === selected ? null : guid)} />
            ))}
        </Flex>
    );
}

/** Кнопка сотрудника: подпись — ФИО физического лица, представление сотрудника. */
function EmployeeButton({ view, guid, selected, disabled, onClick }: { readonly view: ObjectView; readonly guid: string; readonly selected: boolean; readonly disabled: boolean; readonly onClick: (guid: string) => void }) {
    const presentation = useReferencePresentation(view, guid);
    return <Button type={selected ? 'primary' : 'default'} aria-pressed={selected} disabled={disabled} onClick={() => onClick(guid)}>{presentation.text}</Button>;
}
