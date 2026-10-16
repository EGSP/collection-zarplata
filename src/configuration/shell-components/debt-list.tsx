import { Alert, Button, Card, Flex, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useObjectView, useOpenRecord, useReferencePresentation, type ApiError, type ObjectView, type PerformTarget } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Документ в блоке незакрытых: запись и физическое лицо. По типу записи рассрочки физического
 * лица может не быть; проведённая рассрочка, которую показывает блок, его имеет.
 */
export interface DebtRow {
    readonly guid: string;
    readonly person: string | null;
}

/** Свойства блока незакрытых документов. */
export interface DebtListProperties<Row extends DebtRow> {
    readonly title: ReactNode;
    /** Объект документов: нажатие на строку открывает его запись. */
    readonly object: PerformTarget;
    /** Документы первой страницы списка. */
    readonly rows: ReadonlyArray<Row>;
    /** Число незакрытых документов на всех страницах. */
    readonly total: number;
    readonly loading: boolean;
    readonly error: ApiError | null;
    /** Текст на месте строк, когда незакрытых документов нет. */
    readonly empty: string;
    /** Значение справа в строке: у рассрочки остаток, у отвеса число товаров в нём. */
    readonly value: (row: Row) => ReactNode;
}

/** ФИО физического лица: представление записи справочника. */
function PersonName({ view, guid }: { readonly view: ObjectView; readonly guid: string }) {
    return <>{useReferencePresentation(view, guid).text}</>;
}

/**
 * Блок незакрытых документов: в строке ФИО физического лица и значение документа; нажатие
 * открывает документ во вкладке. Общая часть блоков рассрочек и блока «Отвесы»: они различаются
 * объектом, условием незакрытого документа и значением в строке, а выглядят одинаково.
 *
 * Данные блок не читает: их передаёт блок документа, который знает свой отбор. Перечитывать их
 * тоже не нужно: запись документа и действие над ним помечают сохранённые ответы сервера
 * устаревшими, и список блока обновляется сам.
 */
export function DebtList<Row extends DebtRow>({ title, object, rows, total, loading, error, empty, value }: DebtListProperties<Row>) {
    const persons = useObjectView(Objects.catalog.physicalPersons);
    const openRecord = useOpenRecord();
    return (
        <Card size="small" title={title} style={{ flex: 1, minWidth: 280 }}>
            {error !== null ? (
                <Alert type="error" showIcon title="Не удалось прочитать документы" description={error.message} />
            ) : rows.length === 0 ? (
                <Typography.Text type="secondary">{loading ? 'Загрузка…' : empty}</Typography.Text>
            ) : (
                <Flex vertical>
                    {rows.map((row) => (
                        <Button key={row.guid} type="text" block style={{ justifyContent: 'space-between' }} onClick={() => void openRecord(object, row.guid)}>
                            {/* Без права читать физические лица сервер их описание не отдаёт. */}
                            <span>{row.person === null ? 'Без физического лица' : persons === undefined ? 'Нет доступа' : <PersonName view={persons} guid={row.person} />}</span>
                            {value(row)}
                        </Button>
                    ))}
                    {total > rows.length && <Typography.Text type="secondary">Показаны первые {rows.length} из {total}</Typography.Text>}
                </Flex>
            )}
        </Card>
    );
}
