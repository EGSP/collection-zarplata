import { Alert, Button, Flex, Typography } from 'antd';
import { useState } from 'react';
import { FieldDisplay, Icons, Layer, ListSearch, spacing, Stack, Text, useObjectView, useOpenRecord, useRecordList, useReferencePresentation, type ObjectView } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Вкладка «Рассрочки» на рабочем месте продавца: проведённые незакрытые рассрочки, сгруппированные
 * по покупателям, и поиск по ФИО покупателя. Без права читать рассрочки вкладки нет: проверка стоит
 * здесь, потому что страница рабочего места выводит вкладки сама, без перечня требуемых объектов.
 */
export default function OpenSaleInstallments() {
    const view = useObjectView(Objects.document.saleInstallment);
    return view === undefined ? null : <AvailableSaleInstallments />;
}

/**
 * Незакрытые рассрочки: без даты закрытия и пометки удаления, проведённые. Непроведённая рассрочка —
 * черновик, долга по ней в регистре расчётов ещё нет. Условия общие у блока и подписи вкладки.
 */
const openInstallments = {
    permanentFilter: [
        { field: 'closedAt', operator: 'equals', value: null },
        { field: 'deletedAt', operator: 'equals', value: null },
        { field: 'posted', operator: 'equals', value: true },
    ],
    sort: [{ field: 'date', direction: 'ascending' }],
    pageSize: 100,
} as const;

/** Общий остаток незакрытых рассрочек для подписи вкладки. */
export interface InstallmentDebt {
    /** Сумма остатков в копейках. */
    readonly amount: number;
    /** Рассрочек больше первой страницы: сумма неполная, подпись говорит «не меньше». */
    readonly partial: boolean;
}

/**
 * Общий остаток незакрытых рассрочек без учёта поиска во вкладке: подпись вкладки говорит о всех
 * долгах, а не о найденных. Без поиска блок читает тот же список с теми же условиями, и кеш
 * запросов отдаёт обоим один ответ. Вызывать только при доступном описании рассрочек.
 */
export function useInstallmentDebt(): InstallmentDebt {
    const list = useRecordList(Objects.document.saleInstallment, openInstallments);
    return { amount: list.records.reduce((sum, row) => sum + row.balance, 0), partial: list.total > list.records.length };
}

/** Рассрочка в блоке: продажа и остаток долга. */
interface InstallmentRow {
    readonly guid: string;
    readonly sale: string;
    readonly balance: number;
}

/** Представление записи по ссылке: ФИО покупателя или «Продажа № … от …». */
function Presentation({ view, guid }: { readonly view: ObjectView; readonly guid: string }) {
    return <>{useReferencePresentation(view, guid).text}</>;
}

/** Деньги в том же виде, что в формах. */
function Money({ value }: { readonly value: number }) {
    return <FieldDisplay field={{ kind: 'money', target: null }} value={value} />;
}

/** Уровень заливки долга: без заливки, светлая, яркая. */
type DebtLevel = 0 | 1 | 2;

/**
 * Уровень долга по терцилям размаха: отрезок от наименьшего до наибольшего долга покупателей
 * делится на три равные части. Если долги равны, выделять нечего, и заливки нет.
 */
function debtLevel(debt: number, minimum: number, maximum: number): DebtLevel {
    if (maximum === minimum) return 0;
    const share = (debt - minimum) / (maximum - minimum);
    return share < 1 / 3 ? 0 : share < 2 / 3 ? 1 : 2;
}

/**
 * Покупатель: строка с ФИО и общим долгом; нажатие раскрывает его рассрочки. Строка рассрочки
 * называет продажу и остаток, а нажатие открывает продажу: продавец узнаёт рассрочку по проданному
 * товару, а не по номеру рассрочки.
 *
 * Фон покупателя показывает размер долга: без заливки, светлый и яркий фон цвета долга по терцилям.
 * Раскрытые рассрочки стоят на той же поверхности. Общий долг покупателя окрашен цветом долга.
 * Основной текст на фонах цвета долга читается без потери контраста; второстепенный серый —
 * только на светлом фоне и без заливки. Длинные ФИО и продажи
 * обрезаются многоточием, полный текст виден в подсказке, а сумма всегда остаётся у правого края.
 */
function Debtor({ person, rows, persons, sales, level }: { readonly person: string | null; readonly rows: ReadonlyArray<InstallmentRow>; readonly persons: ObjectView | undefined; readonly sales: ObjectView | undefined; readonly level: DebtLevel }) {
    const [expanded, setExpanded] = useState(false);
    const openRecord = useOpenRecord();
    const debt = rows.reduce((sum, row) => sum + row.balance, 0);
    const Toggle = expanded ? Icons.collapse : Icons.expand;
    const content = (
        <Flex vertical>
            {/* Покупатель — крупная кнопка, рассрочки под ним — обычные: выразительный вид ленты
                рабочего места с текстом 16 px и 14 px, как строки и заголовки дней ленты продаж и возвратов. */}
            <Button type="text" size="large" block onClick={() => setExpanded(!expanded)}>
                {/* Кнопка оборачивает содержимое своим элементом, поэтому строку растягивает внутренний Flex: сумма стоит у правого края. */}
                <Flex justify="space-between" align="center" gap="small" style={{ width: '100%', minWidth: 0 }}>
                    <Flex gap="small" align="center" style={{ minWidth: 0 }}>
                        <Toggle />
                        {/* Без права читать физические лица сервер их описание не отдаёт. */}
                        {/* Размер шрифта берётся у кнопки: свой размер Typography мельче крупной кнопки. */}
                        <Typography.Text ellipsis style={{ minWidth: 0, fontSize: 'inherit' }}>
                            {person === null ? 'Без физического лица' : persons === undefined ? 'Нет доступа' : <Presentation view={persons} guid={person} />}
                        </Typography.Text>
                    </Flex>
                    <span style={{ flexShrink: 0 }}><Text tone="debt"><Money value={debt} /></Text></span>
                </Flex>
            </Button>
            {expanded && rows.map((row) => (
                <Button key={row.guid} type="text" block style={{ paddingInlineStart: spacing[7] }}
                    onClick={(event) => void openRecord(Objects.document.saleInstallment, row.guid, 'tab', { original: event.shiftKey })}>
                    <Flex justify="space-between" align="center" gap="small" style={{ width: '100%', minWidth: 0 }}>
                        {/* Серый текст на ярко-оранжевом фоне теряет контраст, поэтому там продажа выводится основным цветом. */}
                        <Typography.Text {...(level === 2 ? {} : { type: 'secondary' as const })} ellipsis style={{ minWidth: 0, fontSize: 'inherit' }}>{sales === undefined ? 'Рассрочка' : <Presentation view={sales} guid={row.sale} />}</Typography.Text>
                        <span style={{ flexShrink: 0 }}><Money value={row.balance} /></span>
                    </Flex>
                </Button>
            ))}
        </Flex>
    );
    // Покупатель с небольшим долгом стоит прямо на панели, остальные — на поверхности цвета долга.
    return level === 0 ? content : <Layer tone="debt" emphasis={level === 1 ? 'subtle' : 'strong'} padding={0}>{content}</Layer>;
}

/**
 * Чтение монтируется только при доступном описании объекта. Рассрочки группируются по покупателю
 * в порядке первой рассрочки: у покупателя может быть несколько рассрочек, и продавцу важен его
 * общий долг. Строка всегда передаёт исходную рассрочку общему серверному правилу открытия;
 * отсутствие права читать продажу завершает переход отказом. Shift открывает оригинал.
 *
 * Поиск отбирает рассрочки на сервере условием «покупатель содержит»: сервер сравнивает часть ФИО
 * с представлением покупателя без учёта регистра и просматривает все рассрочки, а не только
 * загруженную страницу. Уровни заливки во время поиска считаются по найденным покупателям.
 */
function AvailableSaleInstallments() {
    const persons = useObjectView(Objects.catalog.physicalPersons);
    const sales = useObjectView(Objects.document.sale);
    const list = useRecordList(Objects.document.saleInstallment, openInstallments);
    // Текст поиска, уже переданный списку. Поле поиска применяет ввод с задержкой, а очистку сразу.
    const [search, setSearch] = useState('');
    const applySearch = (text: string) => {
        setSearch(text);
        const needle = text.trim();
        list.setFilter(needle === '' ? [] : [{ field: 'person', operator: 'contains', value: needle }]);
    };
    const groups = new Map<string | null, InstallmentRow[]>();
    for (const record of list.records) groups.set(record.person, [...groups.get(record.person) ?? [], { guid: record.guid, sale: record.sale, balance: record.balance }]);
    const debts = [...groups.values()].map((rows) => rows.reduce((sum, row) => sum + row.balance, 0));
    const minimum = Math.min(...debts);
    const maximum = Math.max(...debts);
    return (
        // Заголовок блока — вкладка «Рассрочки» на рабочем месте, поэтому своей панели у блока нет.
        <Stack gap={3}>
                <ListSearch value={search} onSearch={applySearch} placeholder="Поиск по ФИО покупателя" />
                {list.error !== null ? (
                    <Alert type="error" showIcon title="Не удалось прочитать документы" description={list.error.message} />
                ) : list.records.length === 0 ? (
                    <Typography.Text type="secondary">
                        {list.loading ? 'Загрузка…' : search.trim() === '' ? 'Незакрытых рассрочек по продажам нет' : `Нет покупателей с рассрочками по запросу «${search.trim()}»`}
                    </Typography.Text>
                ) : (
                    <Flex vertical>
                        {[...groups].map(([person, rows], index) => <Debtor key={person ?? ''} person={person} rows={rows} persons={persons} sales={sales} level={debtLevel(debts[index]!, minimum, maximum)} />)}
                        {list.total > list.records.length && <Typography.Text type="secondary">Показаны первые {list.records.length} из {list.total}</Typography.Text>}
                    </Flex>
                )}
        </Stack>
    );
}
