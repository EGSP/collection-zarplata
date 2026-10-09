import { Alert, Button, Card, Flex, Typography } from 'antd';
import { FieldDisplay, useObjectView, useOpenRecord, useReferencePresentation, type ApiError, type ObjectView, type PerformTarget } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Документ в блоке незакрытых: физическое лицо и остаток в копейках. */
export interface DebtRow {
    readonly guid: string;
    readonly person: string;
    readonly balance: number;
}

/** Свойства блока незакрытых документов. */
export interface DebtListProperties {
    readonly title: string;
    /** Объект документов: нажатие на строку открывает его запись. */
    readonly object: PerformTarget;
    /** Документы первой страницы списка. */
    readonly rows: ReadonlyArray<DebtRow>;
    /** Число незакрытых документов на всех страницах. */
    readonly total: number;
    readonly loading: boolean;
    readonly error: ApiError | null;
    /** Текст на месте строк, когда незакрытых документов нет. */
    readonly empty: string;
}

/** ФИО физического лица: представление записи справочника. */
function PersonName({ view, guid }: { readonly view: ObjectView; readonly guid: string }) {
    return <>{useReferencePresentation(view, guid).text}</>;
}

/**
 * Блок незакрытых документов: в строке ФИО физического лица и остаток, нажатие открывает документ
 * во вкладке. Общая часть блоков «Рассрочки» и «Отвесы»: они различаются объектом и условием
 * незакрытого документа, а выглядят одинаково.
 *
 * Данные блок не читает: их передаёт блок документа, который знает свой отбор. Перечитывать их
 * тоже не нужно: запись документа и действие над ним помечают сохранённые ответы сервера
 * устаревшими, и список блока обновляется сам.
 */
export function DebtList({ title, object, rows, total, loading, error, empty }: DebtListProperties) {
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
                            <span>{persons === undefined ? 'Нет доступа' : <PersonName view={persons} guid={row.person} />}</span>
                            <FieldDisplay field={{ kind: 'money', target: null }} value={row.balance} />
                        </Button>
                    ))}
                    {total > rows.length && <Typography.Text type="secondary">Показаны первые {rows.length} из {total}</Typography.Text>}
                </Flex>
            )}
        </Card>
    );
}
