/**
 * Общий ввод дат: текст остаётся видимым, даже когда его нельзя отправить серверу.
 * Календарь и ручной ввод используют одни ограничения; потеря фокуса не отменяет набор.
 */
import { Calendar, ConfigProvider, Input, Popover, TimePicker, type InputRef } from 'antd';
import dayjs from 'dayjs';
import { useImperativeHandle, useRef, useState } from 'react';
import { useKeyboard } from 'react-aria';
import { Icons } from '../sdk/ds/icons';
import { dateTextError, parseDateText, type DateKind } from './date-text';
import { useInputDraft } from './input-draft';
import type { InputProperties } from './widget';

/** Дата в формате сервера YYYY-MM-DD. */
export function DateInput(properties: InputProperties<string>) {
    return <DateTextInput {...properties} kind="date" />;
}

/** Дата и время: показываем местное время, отправляем ISO 8601 в UTC. */
export function DateTimeInput(properties: InputProperties<string>) {
    return <DateTextInput {...properties} kind="dateTime" />;
}

function DateTextInput({ kind, value, onChange, disabled, dateLimits, id, ref }: InputProperties<string> & { readonly kind: DateKind }) {
    const { draft, setDraft } = useInputDraft(true);
    // Кнопка календаря учитывает и явный disabled, и блокировку всей формы.
    const { componentDisabled } = ConfigProvider.useConfig();
    const unavailableInput = disabled ?? componentDisabled;
    const [open, setOpen] = useState(false);
    const input = useRef<InputRef>(null);
    const initial = useRef({ value, draft });
    useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
    const format = kind === 'date' ? 'DD.MM.YYYY' : 'DD.MM.YYYY HH:mm';
    const currentDraft = draft !== null && Object.is(draft.value ?? null, value ?? null) ? draft : null;
    const text = currentDraft?.text ?? (value == null ? '' : dayjs(value).format(format));
    const error = currentDraft === null ? null : dateTextError(currentDraft.text, kind, dateLimits);
    const current = value == null ? dayjs() : dayjs(value);

    const enter = (text: string) => {
        const parsed = parseDateText(text, kind);
        const problem = dateTextError(text, kind, dateLimits);
        const next = parsed === undefined || problem !== null ? value ?? null : parsed;
        setDraft({ text, error: problem, value: next });
        // Не передаём неверный текст значением. Повтор прежнего значения запускает проверку
        // Form.Item, а его дополнительный валидатор читает ошибку черновика.
        onChange?.(next ?? null);
    };
    const select = (date: dayjs.Dayjs) => {
        enter(date.format(format));
        setOpen(false);
        input.current?.focus();
    };
    const unavailable = (date: dayjs.Dayjs) => {
        const day = date.format('YYYY-MM-DD');
        return dateLimits?.minimum !== undefined && day < dateLimits.minimum
            || dateLimits?.maximum !== undefined && day > dateLimits.maximum;
    };

    // Esc внутри календаря закрывает его и возвращает фокус в поле. Календарь находится в портале,
    // поэтому `useKeyboard` останавливает событие: Esc не должен закрыть ещё и форму под ним.
    // Фокус возвращается явно, а не `FocusScope restoreFocus`: Popover не размонтирует скрытое
    // содержимое, и область фокуса не узнала бы о закрытии.
    const { keyboardProps: calendarKeyboard } = useKeyboard({
        onKeyDown: (event) => {
            if (event.key !== 'Escape') {
                event.continuePropagation();
                return;
            }
            event.preventDefault();
            setOpen(false);
            input.current?.focus();
        },
    });
    const calendar = (
        <Popover
            trigger="click"
            open={open && unavailableInput !== true}
            onOpenChange={setOpen}
            content={<div style={{ width: 288 }} {...calendarKeyboard}>
                <Calendar fullscreen={false} defaultValue={current} disabledDate={unavailable} onSelect={(date, information) => {
                    if (information.source !== 'date') return;
                    select(kind === 'date' ? date : date.hour(current.hour()).minute(current.minute()).second(0).millisecond(0));
                }} />
                {kind === 'dateTime' && <TimePicker value={current} format="HH:mm" needConfirm={false} allowClear={false} onChange={(time) => {
                    if (time !== null) select(current.hour(time.hour()).minute(time.minute()).second(0).millisecond(0));
                }} />}
            </div>}
        >
            <button type="button" aria-label="Календарь" disabled={unavailableInput} onMouseDown={(event) => event.preventDefault()}
                style={{ border: 0, padding: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
                <Icons.calendar />
            </button>
        </Popover>
    );
    return (
        <div data-picker-open={open}>
            <Input
                ref={input}
                {...(id === undefined ? {} : { id })}
                {...(unavailableInput === undefined ? {} : { disabled: unavailableInput })}
                style={{ width: '100%' }}
                value={text}
                placeholder={kind === 'date' ? 'дд.мм.гггг' : 'дд.мм.гггг чч:мм'}
                {...(error === null ? {} : { status: 'error' as const, title: error, 'aria-invalid': true })}
                suffix={calendar}
                onFocus={() => { initial.current = { value, draft: currentDraft }; }}
                onChange={(event) => enter(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setOpen(true);
                    }
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (open) { setOpen(false); return; }
                    setDraft(initial.current.draft);
                    onChange?.(initial.current.value ?? null);
                }}
            />
        </div>
    );
}
