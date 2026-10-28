import { Alert, Button, Card, Flex, theme, Typography } from 'antd';
import { useState } from 'react';
import { FieldDisplay, Icons, useObjectView, useOpenRecord, useRecordList, useReferencePresentation, type ObjectView } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Блок «Рассрочки по продажам» на рабочем месте продавца: проведённые незакрытые рассрочки,
 * сгруппированные по покупателям. Без права читать рассрочки блока нет: проверка стоит здесь,
 * потому что страница рабочего места выводит блок сама, без перечня требуемых объектов.
 */
export default function OpenSaleInstallments() {
    const view = useObjectView(Objects.document.saleInstallment);
    return view === undefined ? null : <AvailableSaleInstallments />;
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
 * Фон покупателя показывает размер долга: без заливки, светло-бежевый и ярко-оранжевый по терцилям.
 * Раскрытые рассрочки стоят на том же фоне. Основной текст на светлых оттенках оранжевой палитры
 * Ant Design читается без потери контраста; второстепенный серый — только на бежевом и без заливки. Длинные ФИО и продажи
 * обрезаются многоточием, полный текст виден в подсказке, а сумма всегда остаётся у правого края.
 */
function Debtor({ person, rows, persons, sales, level }: { readonly person: string | null; readonly rows: ReadonlyArray<InstallmentRow>; readonly persons: ObjectView | undefined; readonly sales: ObjectView | undefined; readonly level: DebtLevel }) {
    const { token } = theme.useToken();
    const [expanded, setExpanded] = useState(false);
    const openRecord = useOpenRecord();
    const debt = rows.reduce((sum, row) => sum + row.balance, 0);
    const Toggle = expanded ? Icons.collapse : Icons.expand;
    const background = level === 0 ? undefined : level === 1 ? token.orange1 : token.orange4;
    return (
        <Flex vertical style={{ background, borderRadius: token.borderRadius }}>
            <Button type="text" block onClick={() => setExpanded(!expanded)}>
                {/* Кнопка оборачивает содержимое своим элементом, поэтому строку растягивает внутренний Flex: сумма стоит у правого края. */}
                <Flex justify="space-between" align="center" gap="small" style={{ width: '100%', minWidth: 0 }}>
                    <Flex gap="small" align="center" style={{ minWidth: 0 }}>
                        <Toggle />
                        {/* Без права читать физические лица сервер их описание не отдаёт. */}
                        <Typography.Text ellipsis style={{ minWidth: 0 }}>
                            {person === null ? 'Без физического лица' : persons === undefined ? 'Нет доступа' : <Presentation view={persons} guid={person} />}
                        </Typography.Text>
                    </Flex>
                    <span style={{ flexShrink: 0 }}><Money value={debt} /></span>
                </Flex>
            </Button>
            {expanded && rows.map((row) => (
                <Button key={row.guid} type="text" size="small" block style={{ paddingInlineStart: 32 }}
                    onClick={(event) => void openRecord(Objects.document.saleInstallment, row.guid, 'tab', { original: event.shiftKey })}>
                    <Flex justify="space-between" align="center" gap="small" style={{ width: '100%', minWidth: 0 }}>
                        {/* Серый текст на ярко-оранжевом фоне теряет контраст, поэтому там продажа выводится основным цветом. */}
                        <Typography.Text {...(level === 2 ? {} : { type: 'secondary' as const })} ellipsis style={{ minWidth: 0 }}>{sales === undefined ? 'Рассрочка' : <Presentation view={sales} guid={row.sale} />}</Typography.Text>
                        <span style={{ flexShrink: 0 }}><Money value={row.balance} /></span>
                    </Flex>
                </Button>
            ))}
        </Flex>
    );
}

/**
 * Чтение монтируется только при доступном описании объекта. Рассрочки группируются по покупателю
 * в порядке первой рассрочки: у покупателя может быть несколько рассрочек, и продавцу важен его
 * общий долг. Строка всегда передаёт исходную рассрочку общему серверному правилу открытия;
 * отсутствие права читать продажу завершает переход отказом. Shift открывает оригинал.
 */
function AvailableSaleInstallments() {
    const persons = useObjectView(Objects.catalog.physicalPersons);
    const sales = useObjectView(Objects.document.sale);
    // Незакрытой считается рассрочка без даты закрытия; помеченная на удаление в блок не входит.
    // Непроведённая тоже не входит: это черновик, долга по ней в регистре расчётов ещё нет.
    const list = useRecordList(Objects.document.saleInstallment, {
        permanentFilter: [
            { field: 'closedAt', operator: 'equals', value: null },
            { field: 'deletedAt', operator: 'equals', value: null },
            { field: 'posted', operator: 'equals', value: true },
        ],
        sort: [{ field: 'date', direction: 'ascending' }],
        pageSize: 100,
    });
    const groups = new Map<string | null, InstallmentRow[]>();
    for (const record of list.records) groups.set(record.person, [...groups.get(record.person) ?? [], { guid: record.guid, sale: record.sale, balance: record.balance }]);
    const debts = [...groups.values()].map((rows) => rows.reduce((sum, row) => sum + row.balance, 0));
    const minimum = Math.min(...debts);
    const maximum = Math.max(...debts);
    return (
        // Ширину карточки задаёт колонка страницы: рабочее место даёт ей больше места, чем отвесам,
        // потому что в строке стоят ФИО и сумма.
        <Card size="small" title="Рассрочки по продажам">
            {list.error !== null ? (
                <Alert type="error" showIcon title="Не удалось прочитать документы" description={list.error.message} />
            ) : list.records.length === 0 ? (
                <Typography.Text type="secondary">{list.loading ? 'Загрузка…' : 'Незакрытых рассрочек по продажам нет'}</Typography.Text>
            ) : (
                <Flex vertical>
                    {[...groups].map(([person, rows], index) => <Debtor key={person ?? ''} person={person} rows={rows} persons={persons} sales={sales} level={debtLevel(debts[index]!, minimum, maximum)} />)}
                    {list.total > list.records.length && <Typography.Text type="secondary">Показаны первые {list.records.length} из {list.total}</Typography.Text>}
                </Flex>
            )}
        </Card>
    );
}
