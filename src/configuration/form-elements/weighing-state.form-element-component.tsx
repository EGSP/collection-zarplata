import { Button, Flex, Modal, Table, Typography } from 'antd';
import { useState } from 'react';
import { FieldDisplay, useFormData, useFormRestrictions, useFormValue, useOpenRecord } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Состояние строки, из которого товар можно продать. Совпадает со значением в описании отвеса:
 * компонент не импортирует значения из файла объекта, иначе в клиент попал бы серверный код.
 */
const held = 'В отвесе';

/** Строка окна выбора: товар в отвесе и его номер среди строк отвеса. */
interface HeldLine {
    readonly lineNumber: number;
    readonly name: string | null;
    readonly cost: number | null;
    readonly discount: number | null;
    readonly total: number | null;
}

/**
 * Состояние отвеса на его форме и кнопка «Продажа».
 *
 * Кнопка открывает окно со строками в состоянии «В отвесе». По выбранным строкам действие отвеса
 * создаёт непроведённую продажу и переводит строки в «Продано»; после этого элемент открывает
 * форму продажи. Стандартная кнопка действия скрыта: её окно потребовало бы выбрать отвес
 * и набрать номера строк.
 *
 * Окно показывает строки формы вместе с несохранёнными, а действие работает с записанным отвесом.
 * Расхождения нет: форма перед действием записывает несохранённые изменения, и номера строк
 * в окне совпадают с номерами в записи. У нового отвеса элемент ничего не выводит: действию
 * нужен `guid` записанного отвеса.
 *
 * Закрыт ли отвес, элемент судит по записанному состоянию: состояние строки, выбранное на форме,
 * отвес закрывает только после записи.
 */
export default function WeighingState() {
    const weighings = Objects.document.weighing;
    const form = useFormData(weighings);
    const goods = useFormValue(weighings, 'goods');
    const openRecord = useOpenRecord();
    const [choosing, setChoosing] = useState(false);
    const [selected, setSelected] = useState<ReadonlyArray<number>>([]);
    const [selling, setSelling] = useState(false);
    useFormRestrictions(weighings, { hiddenActions: ['sell'] });
    const saved = form.saved;
    if (saved === null) return null;

    const sell = form.view.actions.find((action) => action.name === 'sell');
    const lines: ReadonlyArray<HeldLine> = goods.flatMap((line, index) => line.state === held
        ? [{ lineNumber: index + 1, name: line.name, cost: line.cost, discount: line.discount, total: line.total }]
        : []);
    const sellSelected = async () => {
        setSelling(true);
        try {
            const sale = (await form.runAction('sell', { weighing: saved.guid, lines: selected.map((lineNumber) => ({ lineNumber })) })) as { readonly guid: string };
            setChoosing(false);
            await openRecord(Objects.document.sale, sale.guid);
        } catch {
            // Об отказе уже сообщило уведомление с текстом сервера; окно остаётся открытым.
        } finally {
            setSelling(false);
        }
    };
    return (
        <Flex align="center" gap="middle" wrap>
            <Typography.Text strong>{saved.heldCount === 0 ? 'Отвес закрыт' : `Товаров в отвесе: ${saved.heldCount}`}</Typography.Text>
            {sell !== undefined && (
                <Button
                    disabled={lines.length === 0}
                    onClick={() => {
                        setSelected([]);
                        setChoosing(true);
                    }}
                >
                    {sell.title}
                </Button>
            )}
            <Modal
                open={choosing}
                width={900}
                title="Продажа товаров из отвеса"
                okText="Создать продажу"
                cancelText="Отмена"
                okButtonProps={{ disabled: selected.length === 0 }}
                confirmLoading={selling}
                closable={{ disabled: selling }}
                keyboard={!selling}
                cancelButtonProps={{ disabled: selling }}
                onOk={() => void sellSelected()}
                onCancel={() => {
                    if (!selling) setChoosing(false);
                }}
            >
                <Table<HeldLine>
                    size="small"
                    pagination={false}
                    rowKey="lineNumber"
                    dataSource={[...lines]}
                    rowSelection={{ selectedRowKeys: [...selected], onChange: (keys) => setSelected(keys.map(Number)) }}
                    columns={[
                        { key: 'lineNumber', dataIndex: 'lineNumber', title: '№', width: 48 },
                        { key: 'name', dataIndex: 'name', title: 'Название' },
                        { key: 'cost', title: 'Стоимость', render: (_value, line) => <FieldDisplay field={{ kind: 'money', target: null }} value={line.cost} /> },
                        { key: 'discount', title: 'Скидка, %', render: (_value, line) => <FieldDisplay field={{ kind: 'number', target: null }} value={line.discount} /> },
                        { key: 'total', title: 'Итог', render: (_value, line) => <FieldDisplay field={{ kind: 'money', target: null }} value={line.total} /> },
                    ]}
                    locale={{ emptyText: 'Товаров в отвесе нет' }}
                />
            </Modal>
        </Flex>
    );
}
