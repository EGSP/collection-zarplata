/**
 * Ячейка табличной части с двумя режимами: просмотр и редактирование.
 *
 * В режиме просмотра ячейка показывает значение так же, как список (`FieldDisplay`), и не держит
 * поле ввода. Поле появляется на месте значения, только когда пользователь начал редактирование:
 *
 * ```text
 * Щелчок, Enter или F2          → поле на месте значения
 * Стрелки                       → значение соседней ячейки
 * Ввод символа                  → поле, и символ попадает в него
 * Delete                        → значение очищается без входа в редактирование
 * Enter в поле                  → значение остаётся, редактируется следующая ячейка
 * Escape в поле                 → возвращается значение до начала редактирования
 * Tab или щелчок вне ячейки     → значение остаётся, ячейка возвращается к просмотру
 * ```
 *
 * Поле в режиме редактирования без рамки и горизонтального отступа: значение стоит на той же
 * вертикали, что заголовок колонки, и не сдвигается при входе в редактирование. Рамку фокуса
 * и фон поля рисует ячейка таблицы (`DataTable`).
 *
 * Флажок и собственное поле колонки (`columnInputs`) режимов не имеют: такой элемент сам служит
 * и показом, и вводом, как переключатель «Да» / «Нет».
 *
 * Ячейка стоит в `Form.Item` без оформления: значение, обработчик изменения и ошибки проверки
 * приходят от формы. Текст ошибки не выводится под ячейкой, чтобы строка не меняла высоту:
 * ячейка обводится красным, а текст показывает подсказка у значка.
 */
import { ConfigProvider, Form, Tooltip, theme } from 'antd';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type ComponentType, type KeyboardEvent, type Ref } from 'react';
import { flushSync } from 'react-dom';
import type { FormField } from '../../../server/ui/descriptions';
import { FieldDisplay, FieldInput } from '../../widgets/registry';
import type { InputHandle, InputProperties } from '../../widgets/widget';
import { Icons } from '../ds/icons';

/** Свойства ячейки. `value`, `onChange` и `id` передаёт `Form.Item`. */
export interface TableCellProperties {
    readonly field: FormField;
    /** Собственное поле колонки вместо виджета вида поля; оно всегда в режиме ввода. */
    readonly input?: ComponentType<InputProperties<unknown>> | undefined;
    readonly value?: unknown;
    readonly onChange?: ((value: unknown) => void) | undefined;
    readonly id?: string | undefined;
    readonly disabled: boolean;
    /** Ячейка в режиме редактирования. Режимом управляет таблица: редактируется одна ячейка. */
    readonly editing: boolean;
    /** Пользователь начал редактирование этой ячейки. */
    readonly onEdit: () => void;
    /** Фокус ушёл из ячейки или пользователь отменил редактирование: ячейка возвращается к просмотру. */
    readonly onLeave: () => void;
    /** Имя ячейки в таблице: по атрибуту `data-cell-name` таблица узнаёт, в какой ячейке нажата клавиша. */
    readonly name: string;
    /** Фокус ячейки по команде таблицы: в режиме просмотра фокус получает значение, в редактировании — поле. */
    readonly ref?: Ref<InputHandle> | undefined;
}

/**
 * Всплывающие элементы, которые открывает поле ввода: списки выбора, календари, окна подбора
 * и создания записи. Фокус и щелчок внутри них не завершают редактирование.
 */
const popupSelector = '.ant-select-dropdown, .ant-picker-dropdown, .ant-dropdown, .ant-popover, .ant-tooltip, .ant-modal-root, .ant-modal-wrap, [role="dialog"]';

/** Поля в ячейке без рамки: их текст начинается там же, где заголовок колонки. */
const borderless = { components: { Input: { paddingInline: 0 }, InputNumber: { paddingInline: 0 }, DatePicker: { paddingInline: 0 } } };

/** Ячейка табличной части. Поведение описано во вводном комментарии модуля. */
export function TableCell({ name, field, input: CustomInput, value, onChange, id, disabled, editing, onEdit, onLeave, ref }: TableCellProperties) {
    const { token } = theme.useToken();
    const { errors } = Form.Item.useStatus();
    const element = useRef<HTMLDivElement>(null);
    const display = useRef<HTMLDivElement>(null);
    const control = useRef<InputHandle>(null);
    // Значение до начала редактирования: к нему Escape возвращает ячейку. Запоминается при входе
    // в редактирование, кто бы его ни начал: щелчок по ячейке или переход клавишей Enter из соседней.
    const initial = useRef<unknown>(undefined);
    const wasEditing = useRef(false);
    if (editing && !wasEditing.current) initial.current = value;
    wasEditing.current = editing;
    // Фокус вернётся к значению после выхода из редактирования клавишей, а не щелчком в другом месте.
    const returnFocus = useRef(false);
    const direct = CustomInput !== undefined || field.kind === 'boolean';
    const invalid = errors.length > 0;

    useImperativeHandle(ref, () => ({
        focus: () => (direct || editing ? control.current?.focus() : display.current?.focus()),
    }), [direct, editing]);

    // Поле получает фокус сразу после появления, в том же кадре: символ, с которого пользователь
    // начал ввод, попадает уже в него.
    useLayoutEffect(() => {
        if (editing && !direct) control.current?.focus();
        if (!editing && returnFocus.current) {
            returnFocus.current = false;
            display.current?.focus();
        }
    }, [editing]);

    // Пока ячейка редактируется, фокус или щелчок вне неё и вне открытых ею окон завершают редактирование.
    // Окно или список, внутри которого стоит сама таблица, вне ячейки не считается.
    useEffect(() => {
        if (!editing || direct) return;
        const outside = (target: EventTarget | null) => {
            const cell = element.current;
            if (!(target instanceof Element) || cell === null || cell.contains(target)) return false;
            const popup = target.closest(popupSelector);
            return popup === null || popup.contains(cell);
        };
        const leave = (event: Event) => {
            if (outside(event.target)) onLeave();
        };
        document.addEventListener('focusin', leave);
        document.addEventListener('pointerdown', leave, true);
        return () => {
            document.removeEventListener('focusin', leave);
            document.removeEventListener('pointerdown', leave, true);
        };
    }, [editing, direct, onLeave]);

    const problem = invalid && (
        <Tooltip title={errors.join('; ')}>
            <Icons.invalid aria-label={errors.join('; ')} style={{ color: token.colorError, flex: 'none' }} />
        </Tooltip>
    );
    const Input = CustomInput ?? FieldInput;
    const inputProperties = { field, value, onChange, disabled, ref: control, ...(id === undefined ? {} : { id }) };

    if (direct) {
        return (
            <div ref={element} data-cell-name={name} data-cell-state="direct" {...(invalid ? { 'data-cell-invalid': true } : {})}>
                <Input {...inputProperties} />
                {problem}
            </div>
        );
    }

    if (editing) {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            // Открытый список или календарь закрывается своим Escape; его событие помечено обработанным.
            if (event.target instanceof HTMLElement && event.target.getAttribute('aria-expanded') === 'true') return;
            event.preventDefault();
            event.stopPropagation();
            onChange?.(initial.current ?? null);
            returnFocus.current = true;
            onLeave();
        };
        return (
            <div ref={element} data-cell-name={name} data-cell-state="editing" {...(invalid ? { 'data-cell-invalid': true } : {})} onKeyDown={onKeyDown}>
                <ConfigProvider variant="borderless" theme={borderless}>
                    <Input {...inputProperties} />
                </ConfigProvider>
                {problem}
            </div>
        );
    }

    const start = () => {
        if (!disabled) onEdit();
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (disabled || event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === 'F2' || event.key === 'Enter') {
            event.preventDefault();
            start();
        } else if (event.key === 'Delete' || event.key === 'Backspace' && value == null) {
            event.preventDefault();
            onChange?.(null);
        } else if (event.key.length === 1 && event.key !== ' ' || event.key === 'Backspace') {
            // Поле должно появиться и получить фокус до того, как браузер вставит символ: тогда
            // символ попадёт в поле, и ввод начинается с первой нажатой клавиши, как в электронной таблице.
            flushSync(start);
        }
    };
    return (
        <div
            ref={(node) => {
                display.current = node;
                element.current = node;
            }}
            data-cell-target
            data-cell-name={name}
            {...(invalid ? { 'data-cell-invalid': true } : {})}
            tabIndex={disabled ? -1 : 0}
            {...(id === undefined ? {} : { id })}
            aria-label={field.title}
            // Ссылка в значении, например на выбранную запись, открывает запись, а не редактирование.
            onClick={(event) => {
                if (!(event.target instanceof Element && event.target.closest('a') !== null)) start();
            }}
            onKeyDown={onKeyDown}
        >
            <FieldDisplay field={field} value={value} />
            {problem}
        </div>
    );
}
