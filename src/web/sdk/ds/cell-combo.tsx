/**
 * Поле ячейки со списком: собственный `input` ячейки и всплывающий список под ней. На нём
 * строятся подсказки значений, выбор из вариантов и выбор записи по ссылке: внутри ячейки нет
 * поля Ant Design с его рамкой и отступами, текст стоит там же, где в просмотре.
 *
 * Поле не знает, откуда берутся варианты: их передаёт платформа (подсказки из записей, варианты
 * выбора, найденные записи). Список выводится в `document.body` под ячейкой, поэтому его
 * не обрезает прокрутка таблицы, и он может быть шире узкой колонки.
 *
 * ```text
 * Ввод текста          → `onText` (поиск или значение), список открывается
 * Стрелка вниз         → открывает список, дальше выделяет следующий вариант
 * Стрелка вверх        → выделяет предыдущий вариант
 * Enter на варианте    → `onPick`, список закрывается; следующий Enter переходит дальше
 * Enter без выделения  → список не мешает: таблица переходит к следующей ячейке
 * Escape               → закрывает список; второй Escape отменяет редактирование ячейки
 * ```
 *
 * Пока в списке выделен вариант, у поля `aria-expanded="true"`: по нему обход таблицы уступает
 * Enter полю (`hasOpenPicker`). Без выделения Enter переходит к следующей ячейке, и набранное
 * значение остаётся, а не заменяется первым вариантом списка.
 */
import { theme } from 'antd';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { cellInputClass, focusCellInput, type CellTextInputHandle } from './cell-types';
import { spacing } from './layout';

/** Вариант списка: ключ, по которому платформа узнаёт выбор, и подпись. */
export interface CellOption {
    readonly key: string;
    readonly label: ReactNode;
}

/** Свойства поля со списком. */
export interface CellComboInputProperties {
    /** Текст поля при входе в редактирование: значение или представление выбранной записи. */
    readonly text: string;
    /** Текст изменился: платформа ищет по нему варианты или переводит его в значение. */
    readonly onText?: ((text: string) => void) | undefined;
    /** Может ли текст стоять в поле; недопустимый ввод отбрасывается. По умолчанию любой текст. */
    readonly accepts?: ((text: string) => boolean) | undefined;
    readonly options?: ReadonlyArray<CellOption> | undefined;
    /** Пользователь выбрал вариант. Возвращает новый текст поля, например представление выбранной записи. */
    readonly onPick?: ((key: string) => string | undefined) | undefined;
    readonly loading?: boolean | undefined;
    /** Текст пустого списка, по умолчанию «Ничего не найдено». */
    readonly emptyText?: ReactNode;
    /**
     * Своё содержимое списка вместо вариантов, например календарь. Получает функцию, которая
     * ставит в поле текст выбранного значения и закрывает список.
     */
    readonly panel?: ((done: (text: string) => void) => ReactNode) | undefined;
    /**
     * Выделять первый вариант после ввода: Enter выберет его. Подходит выбору записи, где текст
     * служит только поиском. Подсказкам значений не подходит: там Enter оставляет набранное.
     */
    readonly autoHighlight?: boolean | undefined;
    /** Открывать список при вводе. Календарю это мешало бы набирать дату: он открывается стрелкой вниз. */
    readonly openOnType?: boolean | undefined;
    /** Элемент справа в ячейке, например кнопка подбора. Может открыть или закрыть список: `toggle`. */
    readonly trailing?: ((controls: { readonly toggle: () => void }) => ReactNode) | undefined;
    readonly inputMode?: 'text' | 'numeric' | 'decimal' | undefined;
    readonly placeholder?: string | undefined;
    readonly id?: string | undefined;
    readonly label?: string | undefined;
    readonly ref?: Ref<CellTextInputHandle> | undefined;
}

/** Наибольшая высота списка: десять строк, дальше список прокручивается. */
const listHeight = 10 * spacing[7];

/** Поле ячейки со списком. Поведение описано во вводном комментарии модуля. */
export function CellComboInput({ text: initialText, onText, accepts, options = [], onPick, loading = false, emptyText = 'Ничего не найдено', panel, autoHighlight = false, openOnType = true, trailing, inputMode = 'text', placeholder, id, label, ref }: CellComboInputProperties) {
    const { token } = theme.useToken();
    const [text, setText] = useState(initialText);
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(-1);
    const input = useRef<HTMLInputElement>(null);
    const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

    useImperativeHandle(ref, () => ({
        focus: (selection) => {
            if (input.current !== null) focusCellInput(input.current, selection);
        },
    }), []);

    // Список стоит под ячейкой и следует за ней при прокрутке страницы и окна.
    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const cell = input.current?.closest('[role="gridcell"], [role="cell"]') ?? input.current;
            if (cell === null || cell === undefined) return;
            const rect = cell.getBoundingClientRect();
            setPosition({ top: rect.bottom, left: rect.left, width: rect.width });
        };
        place();
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        return () => {
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
        };
    }, [open]);

    // Новый набор вариантов сбрасывает выделение: прежний номер указывал бы на другую запись.
    useEffect(() => {
        setHighlighted(autoHighlight && options.length > 0 && text !== '' ? 0 : -1);
    }, [options, autoHighlight]);

    const pick = (index: number) => {
        const option = options[index];
        if (option === undefined) return;
        const next = onPick?.(option.key);
        if (next !== undefined) setText(next);
        setOpen(false);
        setHighlighted(-1);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) setOpen(true);
            else if (panel === undefined) setHighlighted((index) => Math.min(index + 1, options.length - 1));
        } else if (event.key === 'ArrowUp' && open && panel === undefined) {
            event.preventDefault();
            setHighlighted((index) => Math.max(index - 1, -1));
        } else if (event.key === 'Enter' && open && highlighted >= 0) {
            event.preventDefault();
            event.stopPropagation();
            pick(highlighted);
        } else if (event.key === 'Escape' && open) {
            // Первый Escape закрывает список; ячейка видит обработанное событие и не отменяет ввод.
            event.preventDefault();
            setOpen(false);
            setHighlighted(-1);
        }
    };

    const list = open && position !== null && createPortal(
        <div
            data-cell-popup
            // Календарь — группа, а не окно: окно поверх таблицы отключило бы сочетания формы (`hasOpenDialog`).
            role={panel === undefined ? 'listbox' : 'group'}
            // Щелчок по списку не уводит фокус из поля: редактирование ячейки продолжается.
            onMouseDown={(event) => event.preventDefault()}
            style={{
                position: 'fixed',
                top: position.top,
                left: position.left,
                minWidth: Math.max(position.width, 0),
                maxWidth: '48ch',
                maxHeight: panel === undefined ? listHeight : undefined,
                overflowY: 'auto',
                zIndex: token.zIndexPopupBase + 100,
                background: token.colorBgElevated,
                boxShadow: token.boxShadowSecondary,
                fontSize: token.fontSize,
            }}
        >
            {panel !== undefined ? panel((next) => {
                setText(next);
                setOpen(false);
            }) : (options.length === 0
                ? <div style={{ padding: `${spacing[3]}px ${spacing[5]}px`, color: token.colorTextSecondary }}>{loading ? 'Загрузка…' : emptyText}</div>
                : options.map((option, index) => (
                    <div
                        key={option.key}
                        role="option"
                        aria-selected={index === highlighted}
                        onMouseEnter={() => setHighlighted(index)}
                        onClick={() => pick(index)}
                        style={{
                            minHeight: spacing[7],
                            display: 'flex',
                            alignItems: 'center',
                            padding: `0 ${spacing[5]}px`,
                            cursor: 'pointer',
                            background: index === highlighted ? token.controlItemBgActive : undefined,
                        }}
                    >
                        {option.label}
                    </div>
                )))}
        </div>,
        document.body,
    );

    return (
        <>
            <input
                ref={input}
                className={cellInputClass}
                {...(id === undefined ? {} : { id })}
                {...(label === undefined ? {} : { 'aria-label': label })}
                {...(placeholder === undefined ? {} : { placeholder })}
                role="combobox"
                aria-autocomplete="list"
                // Признак открытого выбора для обхода таблицы: Enter уступается полю, только пока
                // в списке выделен вариант или открыт свой выбор, например календарь.
                aria-expanded={open && (highlighted >= 0 || panel !== undefined)}
                autoComplete="off"
                inputMode={inputMode}
                value={text}
                onChange={(event) => {
                    const next = event.target.value;
                    if (accepts !== undefined && !accepts(next)) return;
                    setText(next);
                    if (openOnType) setOpen(true);
                    onText?.(next);
                }}
                onKeyDown={onKeyDown}
            />
            {trailing?.({
                toggle: () => {
                    setOpen((opened) => !opened);
                    input.current?.focus();
                },
            })}
            {list}
        </>
    );
}
