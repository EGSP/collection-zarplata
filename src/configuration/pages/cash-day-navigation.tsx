import { Button, theme } from 'antd';
import { useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type ReactElement } from 'react';
import { Column, componentSizes, Drawer, DrawerHeader, FieldInput, FluidField, Grid, Icons, spacing, Stack, useDrawer, useFunctionResult, type DrawerControl } from '../../web/sdk';
import { Objects } from '../objects.generated';
import './cash-day-navigation.css';

/** Сдвигает дату без зависимости от часового пояса и перехода на летнее время. */
export function shiftDay(day: string, days: number): string {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/** Ширина квадрата и промежутка участвует и в раскладке, и в расчёте количества видимых дней. */
const square = componentSizes.md;
const gap = spacing[2];
const triggerGap = spacing[3];

/** Распределяет место вокруг выбранного дня с независимыми пределами по обе стороны. */
function visibleNeighbors(capacity: number, daysBefore: number, daysAfter: number) {
    const neighbors = capacity - 1;
    const before = Math.min(daysBefore, Math.ceil(neighbors / 2));
    const after = Math.min(daysAfter, neighbors - before);
    return { before: Math.min(daysBefore, neighbors - after), after };
}

/** Название месяца не должно занимать место соседнего квадрата, даже если в группе только один день. */
const monthName = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });
const shortMonthName = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone: 'UTC' });
const monthWithYear = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Кнопку выбранной даты в полосе можно использовать как якорь команд сверки. */
type RenderSelectedDay = (trigger: ReactElement<ComponentPropsWithRef<'button'>>) => ReactElement;

/** Закрытие периода задаёт заливку, но отметка сверки остаётся в подписи. Команды добавляются только в полосе. */
function DaySquare({ date, selected, today, statuses, closedThrough, onSelect, renderSelectedDay }: {
    readonly date: string;
    readonly selected: string;
    readonly today: string;
    readonly statuses: ReadonlyMap<string, string> | undefined;
    readonly closedThrough: string | null;
    readonly onSelect: (date: string) => void;
    readonly renderSelectedDay?: RenderSelectedDay | undefined;
}) {
    const future = date > today;
    const closed = !future && closedThrough !== null && date <= closedThrough;
    const status = statuses?.get(date);
    const tone = future ? 'future' : closed ? 'closed' : status === 'Проверен' ? 'checked' : status === 'Есть замечания' ? 'remarks' : statuses === undefined ? 'loading' : 'neutral';
    const reviewLabel = future ? 'Будущий день' : status ?? (statuses === undefined ? 'Статус недоступен' : 'Не проверен');
    const label = `${fullDate.format(new Date(`${date}T00:00:00.000Z`))}: ${reviewLabel}${closed ? '. Период закрыт' : ''}`;
    const square = (
        <button type="button" className="cash-day-square" data-tone={tone} disabled={future}
            aria-current={date === selected ? 'date' : undefined} aria-label={label} title={label} onClick={() => onSelect(date)}>
            {date.slice(-2)}
        </button>
    );
    return date === selected && renderSelectedDay !== undefined ? renderSelectedDay(square) : square;
}

/** Возвращает первый день месяца относительно месяца выбранной даты. */
function shiftMonth(day: string, months: number): string {
    const start = new Date(`${day.slice(0, 7)}-01T00:00:00.000Z`);
    start.setUTCMonth(start.getUTCMonth() + months);
    return start.toISOString().slice(0, 10);
}

/** Показывает три соседних месяца. Перелистывание не меняет дату сводки до выбора дня. */
function CashCalendarDrawer({ control, day, today, closedThrough, onDayChange, colors }: {
    readonly control: DrawerControl;
    readonly day: string;
    readonly today: string;
    readonly closedThrough: string | null;
    readonly onDayChange: (date: string) => void;
    readonly colors: CSSProperties;
}) {
    const [month, setMonth] = useState(() => shiftMonth(day, 0));
    const months = [shiftMonth(month, -1), month, shiftMonth(month, 1)];
    const marks = useFunctionResult({
        object: Objects.document.cashDay, name: 'reviewCalendar',
        payload: { firstDate: months[0]!, lastDate: shiftDay(shiftMonth(month, 2), -1) },
    });
    const statuses = marks.data === undefined ? undefined : new Map(marks.data.days.map((record) => [record.cashDate, record.reviewStatus]));

    /** Закрывает панель после выбора и синхронизирует пикер, полосу и сводку. */
    function select(date: string) {
        onDayChange(date);
        control.close();
    }

    return (
        <Drawer control={control} width={800}>
            <DrawerHeader title="Календарь кассовых дней" closeLabel="Закрыть календарь" onClose={control.close} />
            <div className="cash-day-calendar" style={colors}>
                <Stack gap={5}>
                    <Stack orientation="horizontal" gap={3} wrap>
                        <Button aria-label="Предыдущий месяц" icon={<Icons.previousDay />} onClick={() => setMonth(shiftMonth(month, -1))} />
                        <Button aria-label="Следующий месяц" icon={<Icons.nextDay />} disabled={month >= shiftMonth(today, 0)} onClick={() => setMonth(shiftMonth(month, 1))} />
                        <Button onClick={() => setMonth(shiftMonth(today, 0))}>Текущий месяц</Button>
                    </Stack>
                    <div className="cash-day-calendar-months">
                        {months.map((start) => {
                            const startDate = new Date(`${start}T00:00:00.000Z`);
                            const emptyCells = (startDate.getUTCDay() + 6) % 7;
                            const count = Number(shiftDay(shiftMonth(start, 1), -1).slice(-2));
                            const title = monthWithYear.format(startDate);
                            return (
                                <section key={start} className="cash-day-calendar-month" aria-label={title}>
                                    <h3>{title}</h3>
                                    <div className="cash-day-calendar-grid">
                                        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((weekday) => <span key={weekday} className="cash-day-weekday">{weekday}</span>)}
                                        {Array.from({ length: emptyCells }, (_, index) => <span key={index} aria-hidden />)}
                                        {Array.from({ length: count }, (_, index) => {
                                            const date = shiftDay(start, index);
                                            return <DaySquare key={date} date={date} selected={day} today={today} closedThrough={closedThrough} statuses={statuses} onSelect={select} />;
                                        })}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                </Stack>
            </div>
        </Drawer>
    );
}

/** Собирает видимые даты в непрерывные группы по месяцу и году. */
function monthGroups(day: string, before: number, after: number) {
    const groups: { key: string; days: string[] }[] = [];
    for (let offset = -before; offset <= after; offset += 1) {
        const date = shiftDay(day, offset);
        const key = date.slice(0, 7);
        const previous = groups.at(-1);
        if (previous?.key === key) previous.days.push(date);
        else groups.push({ key, days: [date] });
    }
    return groups;
}

/** Пикер и полоса делят одну 2x Grid; полоса измеряет только ширину своей колонки. */
export function CashDayNavigation({ day, today, onDayChange, statuses, closedThrough, daysBefore, daysAfter, renderSelectedDay }: {
    readonly day: string;
    readonly today: string;
    readonly onDayChange: (day: string) => void;
    readonly statuses: ReadonlyMap<string, string> | undefined;
    readonly closedThrough: string | null;
    readonly daysBefore: number;
    readonly daysAfter: number;
    readonly renderSelectedDay?: RenderSelectedDay | undefined;
}) {
    const navigation = useRef<HTMLDivElement>(null);
    const [capacity, setCapacity] = useState(1);
    const { token } = theme.useToken();
    const calendar = useDrawer('Календарь кассовых дней');
    useEffect(() => {
        const element = navigation.current;
        if (element === null) return;
        const observer = new ResizeObserver(([entry]) => {
            if (entry === undefined || entry.contentRect.width === 0) return;
            const available = entry.contentRect.width - square - triggerGap;
            setCapacity(Math.max(1, Math.floor((available + gap) / (square + gap))));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const { before, after } = visibleNeighbors(capacity, daysBefore, daysAfter);
    const colors = {
        '--cash-day-size': `${square}px`,
        '--cash-day-gap': `${gap}px`,
        '--cash-day-trigger-gap': `${triggerGap}px`,
        '--cash-day-radius': `${token.borderRadius}px`,
        '--cash-day-neutral': token.colorFillTertiary,
        '--cash-day-checked': token.colorSuccessBgHover,
        '--cash-day-remarks': token.colorWarningBgHover,
        '--cash-day-border': token.colorBorder,
        '--cash-day-focus': token.colorPrimary,
        '--cash-day-text': token.colorText,
        '--cash-day-secondary': token.colorTextSecondary,
    } as CSSProperties;
    return (
        <Grid gutter="narrow">
            <Column span={{ lg: 6 }}>
                <Stack orientation="horizontal" align="flex-end" gap={3} wrap>
                    <div className="cash-day-picker">
                        <FluidField label="День" required>
                            <FieldInput field={{ kind: 'date', target: null }} value={day}
                                onChange={(value) => { if (typeof value === 'string') onDayChange(value > today ? today : value); }} />
                        </FluidField>
                    </div>
                    <Stack orientation="horizontal" gap={3}>
                        <Button aria-label="Предыдущий день" icon={<Icons.previousDay />} onClick={() => onDayChange(shiftDay(day, -1))} />
                        <Button aria-label="Следующий день" icon={<Icons.nextDay />} disabled={day >= today} onClick={() => onDayChange(shiftDay(day, 1))} />
                        <Button disabled={day === today} onClick={() => onDayChange(today)}>Сегодня</Button>
                    </Stack>
                </Stack>
            </Column>
            <Column span={{ lg: 10 }}>
                <div className="cash-day-navigation" ref={navigation} style={colors}>
                    <div className="cash-day-strip" role="group" aria-label="Кассовые дни">
                        {monthGroups(day, before, after).map((month) => {
                            const start = new Date(`${month.key}-01T00:00:00.000Z`);
                            const title = monthName.format(start);
                            return (
                                <div className="cash-day-month" key={month.key}>
                                    <div className="cash-day-month-days">
                                        {month.days.map((date) => <DaySquare key={date} date={date} selected={day} today={today}
                                            statuses={statuses} closedThrough={closedThrough} onSelect={onDayChange} renderSelectedDay={renderSelectedDay} />)}
                                    </div>
                                    <span className="cash-day-month-title" title={title}>{month.days.length === 1 ? shortMonthName.format(start) : title}</span>
                                </div>
                            );
                        })}
                    </div>
                    <Button className="cash-day-calendar-trigger" aria-label="Открыть календарь" title="Открыть календарь"
                        aria-haspopup="dialog" icon={<Icons.calendar />} onClick={calendar.open} />
                </div>
            </Column>
            {calendar.isOpen && <CashCalendarDrawer control={calendar} day={day} today={today} closedThrough={closedThrough} onDayChange={onDayChange} colors={colors} />}
        </Grid>
    );
}
