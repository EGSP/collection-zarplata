import { Card, ConfigProvider, Flex, Form, Space, theme, type ThemeConfig } from 'antd';
import { useLayoutEffect, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import type { FieldWidth, FormElementReference, FormField, FormTablePart } from '../../../server/ui/descriptions';
import type { RecordData } from '../../data-provider/records';
import { FieldDisplay, FieldInput } from '../../widgets/registry';
import { fieldRules, isMarkedRequired } from '../../widgets/validation';
import type { InputProperties } from '../../widgets/widget';
import { Column, Grid, type ColumnCount } from '../ds/grid';
import { layoutClasses } from '../ds/layout';
import { FluidField, type FieldInputComponent, type FieldLayout } from './field-layout';
import { fieldAttribute, type FieldTraversal } from './field-traversal';
import { useFieldRestricted, useFormElement } from './form-data';
import type { TablePartOptions } from './table-part';
import { TablePartInput } from './table-part-input';

/** Свойства группы полей. */
export interface FieldGroupProperties {
    /** Заголовок группы. Группа без заголовка выводится без рамки. */
    readonly title?: string | null;
    /** Поля, табличные части и собственные элементы конфигурации в порядке показа. */
    readonly elements: ReadonlyArray<FormField | FormTablePart | FormElementReference>;
    /**
     * Запись со служебными полями только для чтения. Вычисляемые значения берутся из текущей формы.
     */
    readonly record?: RecordData | null;
    /** Строки табличных частей нельзя изменять. Поля шапки делает недоступными сама форма Ant Design. */
    readonly disabled?: boolean;
    /** Обход с клавиатуры, в который входят поля группы. Без него поля в обходе не участвуют. */
    readonly traversal?: FieldTraversal;
    /** Настройки вида табличных частей группы по их именам: ширины колонок, строка итогов и другие. */
    readonly tablePartOptions?: { readonly [part: string]: TablePartOptions };
    /**
     * Компоновка полей группы: подпись над полем (по умолчанию) или в сегменте перед значением.
     * Составные поля и табличные части от неё не зависят и выводятся с подписью над собой.
     */
    readonly layout?: FieldLayout;
    /**
     * Поля, которые занимают всю ширину группы, а не одну колонку. Так поле с широким содержимым,
     * например переключателем и пояснением рядом, не переносит его на следующую строку.
     */
    readonly fullWidth?: ReadonlyArray<string>;
    /**
     * Ширина полей ввода по именам вместо заданной в конфигурации (`FieldBuilder.width`):
     * `standard`, `long` или `free`. Так форма меняет ширину поля, не трогая описание объекта.
     */
    readonly widths?: { readonly [field: string]: FieldWidth };
}

/**
 * Сколько колонок сетки занимает поле каждой ширины. Обычное поле — 4 колонки: на узкой группе
 * (4 колонки) это вся строка, на средней (8) — половина, на широкой (16) — четверть. Длинное
 * вдвое шире обычного. Свободное поле занимает не меньше обычного, остальное определяет его значение.
 */
const standardSpan = 4;
const fieldSpans: { readonly [Width in Exclude<FieldWidth, 'free'>]: ColumnCount } = { standard: standardSpan, long: standardSpan * 2 };

/**
 * Поля группы стоят вплотную по вертикали: расстояние между строками задаёт сетка, а не нижний
 * отступ элемента формы Ant Design. Так ошибка под одним полем увеличивает высоту всей строки,
 * и соседние поля не сдвигаются относительно друг друга.
 */
const groupTheme: ThemeConfig = { components: { Form: { itemMarginBottom: 0 } } };

/**
 * Группа полей формы с подписями и ошибками проверки.
 *
 * Группа работает внутри формы Ant Design: значение поля лежит в форме по его имени, строки
 * табличной части по имени части. Отметку обязательности и правила проверки группа строит
 * из описания поля, поэтому ввод проверяется так же, как на стандартной форме, а ошибки сервера
 * экран ставит на поля средствами формы Ant Design по тем же именам.
 *
 * Группа — сетка дизайн-системы: поле занимает столько колонок, сколько задаёт его вид ширины
 * (`widths` группы либо ширина из конфигурации, по умолчанию обычная), поэтому подписи соседних
 * строк стоят на общих вертикалях. Число колонок зависит от ширины самой группы: на узкой форме
 * обычное поле занимает всю строку, на широкой — четверть. Табличная часть и собственный элемент
 * группы занимают всю строку. Зазор группы — `wide` (32 px); подряд идущие поля fluid-группы
 * стоят плотнее, с зазором `narrow` (16 px): подпись у них в сегменте рядом со значением,
 * и место над полем для неё не нужно.
 *
 * Собственные элементы конфигурации группа берёт у поставщика данных формы (`FormDataProvider`).
 * Элемент, названный в группе, занимает всю её ширину и свойств не получает. Элемент, назначенный
 * полю, встаёт на место поля ввода и получает его свойства; подпись, проверку и обход с клавиатуры
 * поле сохраняет. Без поставщика поле выводится виджетом своего вида, а элемент группы пропускается.
 */
export function FieldGroup({ title = null, elements, record = null, disabled = false, traversal, tablePartOptions, layout = 'stacked', fullWidth = [], widths = {} }: FieldGroupProperties) {
    const fieldColumn = (field: FormField) => {
        const width = widths[field.name] ?? field.width ?? 'standard';
        const item = <FieldItem field={field} record={record} traversal={traversal} layout={layout} free={width === 'free'} />;
        if (fullWidth.includes(field.name)) return <Column key={field.name}>{item}</Column>;
        if (width === 'free') return <FreeFieldColumn key={field.name}>{item}</FreeFieldColumn>;
        return <Column key={field.name} span={fieldSpans[width]}>{item}</Column>;
    };
    const content = (
        <ConfigProvider theme={groupTheme}>
            <Grid>
                {groupRuns(elements).map((run) => {
                    if (run.kind === 'element') {
                        return (
                            <Column key={`element/${run.element.element}`}>
                                <ElementBlock name={run.element.element} />
                            </Column>
                        );
                    }
                    if (run.kind === 'tablePart') {
                        return (
                            <Column key={run.part.name}>
                                <TablePartItem part={run.part} disabled={disabled} traversal={traversal} options={tablePartOptions?.[run.part.name]} />
                            </Column>
                        );
                    }
                    if (layout === 'stacked') return run.fields.map(fieldColumn);
                    // Поля fluid-группы стоят плотнее своей сеткой той же ширины, что группа, поэтому её
                    // колонки совпадают с колонками группы, а табличные части отделены обычным зазором.
                    // Зазор `narrow`, а не `condensed`: поля вплотную с сегментами подписей сливались в одну рамку.
                    return (
                        <Column key={`fields/${run.fields[0]?.name ?? ''}`}>
                            <Grid gutter="narrow">{run.fields.map(fieldColumn)}</Grid>
                        </Column>
                    );
                })}
            </Grid>
        </ConfigProvider>
    );
    if (title === null) return content;
    return (
        <Card size="small" title={title}>
            {content}
        </Card>
    );
}

/**
 * Колонка поля шириной `free`. Поле занимает не меньше колонок, чем обычное, и столько, сколько
 * нужно представлению значения, но не больше строки: длинное ФИО покупателя видно целиком,
 * а короткое не растягивает поле.
 *
 * Ширину значения CSS-сетка сама не учитывает: число колонок у области задаётся заранее. Поэтому
 * колонка измеряет собственную ширину содержимого (`max-content`) и пересчитывает число колонок,
 * когда меняется значение или ширина группы.
 */
function FreeFieldColumn({ children }: { readonly children: ReactNode }) {
    const content = useRef<HTMLDivElement>(null);
    const [span, setSpan] = useState<number>(standardSpan);
    useLayoutEffect(() => {
        const element = content.current;
        const grid = element?.closest<HTMLElement>(`.${layoutClasses.grid}`);
        if (element === null || element === undefined || grid === null || grid === undefined) return;
        const measure = () => {
            const style = getComputedStyle(grid);
            const tracks = style.gridTemplateColumns.split(' ').map(Number.parseFloat);
            const track = tracks[0] ?? 0;
            const gap = Number.parseFloat(style.columnGap) || 0;
            // Ограничения ширины снимаются на время измерения: иначе значение не шире колонки
            // нельзя было бы отличить от значения, которое в неё не помещается.
            const { minWidth, maxWidth } = element.style;
            element.style.minWidth = '0';
            element.style.maxWidth = 'none';
            const natural = element.getBoundingClientRect().width;
            element.style.minWidth = minWidth;
            element.style.maxWidth = maxWidth;
            const needed = track > 0 ? Math.ceil((natural + gap) / (track + gap)) : tracks.length;
            setSpan(Math.min(Math.max(needed, standardSpan), tracks.length));
        };
        measure();
        const resize = new ResizeObserver(measure);
        resize.observe(grid);
        const mutation = new MutationObserver(measure);
        mutation.observe(element, { childList: true, subtree: true, characterData: true });
        return () => {
            resize.disconnect();
            mutation.disconnect();
        };
    }, []);
    return (
        <Column span={span}>
            <div ref={content} style={freeInputStyle}>{children}</div>
        </Column>
    );
}

/** Подряд идущие поля группы, табличная часть или собственный элемент группы. */
type GroupRun =
    | { readonly kind: 'fields'; readonly fields: ReadonlyArray<FormField> }
    | { readonly kind: 'tablePart'; readonly part: FormTablePart }
    | { readonly kind: 'element'; readonly element: FormElementReference };

/** Делит элементы группы на участки: подряд идущие поля собираются в один участок, порядок сохраняется. */
function groupRuns(elements: FieldGroupProperties['elements']): ReadonlyArray<GroupRun> {
    const runs: Array<GroupRun> = [];
    for (const element of elements) {
        if ('element' in element) runs.push({ kind: 'element', element });
        else if ('columns' in element) runs.push({ kind: 'tablePart', part: element });
        else {
            const last = runs.at(-1);
            if (last?.kind === 'fields') runs[runs.length - 1] = { kind: 'fields', fields: [...last.fields, element] };
            else runs.push({ kind: 'fields', fields: [element] });
        }
    }
    return runs;
}

interface FieldItemProperties {
    readonly field: FormField;
    readonly record: RecordData | null;
    readonly traversal: FieldTraversal | undefined;
    readonly layout: FieldLayout;
    /** Поле шириной `free`: значение не растягивается на место группы, а занимает ширину своего представления. */
    readonly free: boolean;
}

interface TablePartItemProperties {
    readonly part: FormTablePart;
    readonly disabled: boolean;
    readonly traversal: FieldTraversal | undefined;
    readonly options: TablePartOptions | undefined;
}

/**
 * Табличная часть группы. Часть, которую элемент формы сделал недоступной для изменения, выглядит
 * так же, как на форме только для просмотра, и в обход с клавиатуры не входит.
 */
function TablePartItem({ part, disabled, traversal, options }: TablePartItemProperties) {
    const restricted = useFieldRestricted(part.name);
    return (
        // Недоступность ячейкам передаёт контекст Ant Design, как на форме только для просмотра.
        <div {...{ [fieldAttribute]: part.name }}>
            <ConfigProvider {...(restricted ? { componentDisabled: true } : {})}>
                <TablePartInput
                    part={part}
                    options={options}
                    disabled={disabled || restricted}
                    // Обход останавливается на имени, у которого есть ссылка, поэтому недоступная часть её не получает.
                    ref={restricted ? undefined : traversal?.register(part.name)}
                    onPrevious={traversal === undefined ? undefined : () => traversal.previous(part.name)}
                />
            </ConfigProvider>
        </div>
    );
}

/** Собственный элемент конфигурации в группе. Что он показывает, решает сам: данные формы он читает хуками SDK. */
function ElementBlock({ name }: { readonly name: string }) {
    // В группе элемент свойств не получает; тип свойств в реестре закрыт (`FormElementComponent`).
    const Element = useFormElement(name) as ComponentType | undefined;
    return Element === undefined ? null : <Element />;
}

/**
 * Поле шапки. Служебное поле показывает записанное значение, вычисляемое следит за текущей формой.
 * Если полю назначен собственный элемент, он стоит на месте виджета вида поля.
 *
 * Поле, которое элемент формы сделал недоступным для изменения, остаётся полем ввода: его значение
 * по-прежнему входит в значения формы и уходит в `save`. Изменить его нельзя, и обход с клавиатуры
 * его пропускает.
 *
 * В fluid-компоновке название стоит в сегменте перед значением, а ошибка проверки по-прежнему
 * выводится под полем. Стандартный виджет форма оборачивает в сегмент сама, а собственный элемент
 * получает компоновку, название и обязательность и выводит сегмент сам (`fieldInput`).
 * Составное поле пока выводится с подписью над полем: его виджет состоит из нескольких частей.
 */
function FieldItem({ field, record, traversal, layout: groupLayout, free }: FieldItemProperties) {
    const { token } = theme.useToken();
    // На месте поля ввода элемент получает свойства поля ввода: значение и обработчик изменения
    // ему передаёт элемент формы Ant Design, как и виджету. Реестр элементов принимает на месте
    // поля только элементы, собранные `fieldInput`.
    const Override = useFormElement(field.inputElement) as FieldInputComponent<unknown> | undefined;
    const restricted = useFieldRestricted(field.name);
    const watched: unknown = Form.useWatch(field.name, { preserve: true });
    const layout: FieldLayout = field.kind === 'composite' ? 'stacked' : groupLayout;
    const fluid = layout === 'fluid';
    const required = isMarkedRequired(field);
    if (field.readOnly) {
        const display = <FieldDisplay field={field} value={field.computed ? watched : record?.[field.name]} />;
        if (fluid) {
            return (
                <Form.Item {...(field.computed ? { name: field.name } : {})}>
                    <FluidField label={field.title}>
                        {/* Высота как у поля ввода: без неё значение только для чтения ниже соседних полей. */}
                        <Space.Addon style={{ flex: 1, background: 'transparent', minHeight: token.controlHeight, display: 'flex', alignItems: 'center' }}>{display}</Space.Addon>
                    </FluidField>
                </Form.Item>
            );
        }
        return (
            <Form.Item label={field.title} {...(field.computed ? { name: field.name } : {})}>
                <Flex align="center" style={{ minHeight: token.controlHeight }}>
                    {display}
                </Flex>
            </Form.Item>
        );
    }
    return (
        <div {...{ [fieldAttribute]: field.name }}>
            {/* Недоступность полю ввода и кнопкам собственного элемента передаёт контекст Ant Design, как на форме только для просмотра. */}
            <ConfigProvider {...(restricted ? { componentDisabled: true } : {})}>
                <Form.Item name={field.name} {...(fluid ? {} : { label: field.title })} required={required} rules={fieldRules(field)}>
                    {/* Обход останавливается на имени, у которого есть ссылка, поэтому недоступное поле её не получает. */}
                    <LaidOutInput field={field} override={Override} layout={layout} label={field.title} required={required} free={free} ref={restricted ? undefined : traversal?.register(field.name)} />
                </Form.Item>
            </ConfigProvider>
        </div>
    );
}

interface LaidOutInputProperties extends InputProperties<unknown> {
    readonly override: FieldInputComponent<unknown> | undefined;
    readonly layout: FieldLayout;
    readonly label: string;
    readonly required: boolean;
    readonly free: boolean;
}

/**
 * Поле ввода в выбранной компоновке. Значение и обработчик изменения передаёт элемент формы
 * Ant Design, поэтому компонент пропускает их к полю без изменений.
 */
function LaidOutInput({ override: Override, layout, label, required, free, ...properties }: LaidOutInputProperties) {
    if (Override !== undefined) return <Override {...properties} layout={layout} label={label} required={required} />;
    if (layout === 'stacked') return free ? <div style={freeInputStyle}><FieldInput {...properties} /></div> : <FieldInput {...properties} />;
    return (
        <FluidField label={label} required={required} free={free}>
            <FieldInput {...properties} />
        </FluidField>
    );
}

/**
 * Обёртка поля шириной `free`: ширина по содержимому, но не меньше места поля в группе. Поле ввода
 * внутри растягивается на ширину обёртки, поэтому оно получает ширину своего представления.
 */
const freeInputStyle: CSSProperties = { display: 'grid', width: 'max-content', minWidth: '100%', maxWidth: '100%' };
