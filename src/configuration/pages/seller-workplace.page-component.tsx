import { Alert, Button, Flex, Result, Spin, Tabs, Typography } from 'antd';
import type { ComponentType, ReactNode } from 'react';
import { ActionButton, ActionTile, Column, FieldDisplay, Grid, Icons, Page, Panel, RecordLink, Stack, useObjectView, useOpenRecord, type ColumnCount, type PerformTarget } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { employeeCount, useCurrentShift, type OpenShiftState } from '../shell-components/current-shift-state';
import OpenSaleInstallments, { useInstallmentDebt } from '../shell-components/open-sale-installments';
import OpenWeighings, { useHeldGoodsAvailable, useOpenWeighingCount } from '../shell-components/open-weighings';
import SellerFeed, { useSellerFeedAvailable } from '../shell-components/seller-feed';

/** Может ли пользователь создавать записи объекта: сервер оставляет действие `save` только при праве записи. */
function useCreatable(object: PerformTarget): boolean {
    return useObjectView(object)?.form?.actions.some((action) => action.name === 'save') === true;
}

/**
 * Ширины областей рабочего места в колонках сетки (Carbon 2x Grid). Начиная с `lg` страница делится
 * на область действий в четверть ширины и ленту в три четверти: на всю ширину широкого экрана
 * колонки ленты расходились, и время, товары и сумму продажи было трудно связать взглядом.
 * Уже `lg` области стоят друг под другом: действия сверху, по две плитки в строке на `md`.
 *
 * Плитки стоят во вложенной сетке области действий и занимают по четыре колонки: на `md` это
 * половина строки, а начиная с `lg` — вся область, и плитки идут столбиком.
 */
const columns = {
    actions: { lg: 4 },
    feed: { lg: 12 },
    actionTile: { md: 4 },
} satisfies { readonly [area: string]: ColumnCount };

/** Панель открытия смены по центру страницы: шесть колонок со сдвигом к середине строки. */
const closedShiftSpan: ColumnCount = { md: 6 };
const closedShiftOffset: ColumnCount = { md: 1, lg: 5 };

/** Свойства тайла действия продавца. */
interface DocumentActionTileProperties {
    /** Подпись кнопки: глагол действия, например «Продать». */
    readonly action: string;
    /** Продажа выделена акцентным цветом; остальные операции второстепенные. */
    readonly primary?: boolean;
    /** Иконка кнопки из реестра `Icons`; у каждого действия своя. */
    readonly icon: ComponentType;
    /** Документ, новая запись которого открывается кнопкой. */
    readonly object: PerformTarget;
}

/**
 * Связывает плитку SDK с созданием документа во вкладке. Проверка права записи остаётся
 * в конфигурации: универсальная плитка знает только подпись, значок и обработчик действия.
 */
function DocumentActionTile({ action, primary = false, icon: Icon, object }: DocumentActionTileProperties) {
    const openRecord = useOpenRecord();
    if (!useCreatable(object)) return null;
    return (
        <Column span={columns.actionTile}>
            <ActionTile type={primary ? 'primary' : 'default'} icon={<Icon />} onClick={() => void openRecord(object, null)}>
                {action}
            </ActionTile>
        </Column>
    );
}

/**
 * Шапка открытой смены: ссылка на смену, время открытия, число сотрудников и кнопка закрытия.
 * Кнопки закрытия нет у пользователя без права на действие `close`. После закрытия хук смены
 * перечитывает список, и страница сама переходит в неактивное состояние.
 */
function ShiftHeader({ shift }: { readonly shift: OpenShiftState }) {
    const shifts = Objects.document.shift;
    return (
        <Panel>
            <Flex justify="space-between" align="center" gap="middle" wrap>
                <Flex gap="large" align="center" wrap>
                    <Typography.Text strong>
                        <RecordLink reference={{ kind: shifts.kind, name: shifts.name, guid: shift.guid }} />
                    </Typography.Text>
                    <Typography.Text>
                        Открыта <FieldDisplay field={{ kind: 'dateTime', target: null }} value={shift.date} />
                    </Typography.Text>
                    {shift.employees !== undefined && <Typography.Text>{employeeCount(shift.employees)}</Typography.Text>}
                </Flex>
                <ActionButton object={shifts} record={null} action="close" icon={<Icons.closeShift />}>
                    Закрыть смену
                </ActionButton>
            </Flex>
        </Panel>
    );
}

/**
 * Неактивное состояние: смена не открыта, и действия продавца скрыты. По центру стоит панель
 * с кнопкой открытия смены; она открывает форму новой смены в модальном окне. Без права записи
 * смен кнопки нет, и панель объясняет, почему работать нельзя.
 */
function ClosedShift() {
    const shifts = Objects.document.shift;
    const openRecord = useOpenRecord();
    const creatable = useCreatable(shifts);
    return (
        // Сетка ставит панель по центру строки, а Flex — по вертикали.
        <Flex vertical justify="center" style={{ minHeight: '60vh' }}>
            <Grid>
                <Column span={closedShiftSpan} offset={closedShiftOffset}>
                    <Panel>
                        <Result
                            icon={<Icons.openShift />}
                            title="Смена не открыта"
                            subTitle={creatable ? 'Откройте смену, чтобы оформлять продажи, отвесы, возвраты и рассрочки.' : 'Смену открывает сотрудник с правом записи смен.'}
                            extra={
                                creatable && (
                                    <Button type="primary" size="large" icon={<Icons.openShift />} onClick={() => void openRecord(shifts, null, 'dialog')}>
                                        Открыть смену
                                    </Button>
                                )
                            }
                        />
                    </Panel>
                </Column>
            </Grid>
        </Flex>
    );
}

/**
 * Подпись вкладки со значением в скобках после названия: сумма или число, которые продавцу полезно
 * видеть, не открывая вкладку. Значение стоит в одной строке с названием, а не второй строкой,
 * как `secondaryLabel` у Carbon: полоса вкладок остаётся в одну строку и не отнимает высоту у ленты.
 */
function TabLabel({ title, value }: { readonly title: string; readonly value: ReactNode }) {
    return <>{title} ({value})</>;
}

/** Подпись вкладки «Рассрочки»: общий остаток незакрытых рассрочек, без учёта поиска во вкладке. */
function InstallmentsLabel() {
    const debt = useInstallmentDebt();
    return <TabLabel title="Рассрочки" value={<>{debt.partial ? 'не меньше ' : ''}<FieldDisplay field={{ kind: 'money', target: null }} value={debt.amount} /></>} />;
}

/** Подпись вкладки «Отвесы»: число незакрытых отвесов. */
function WeighingsLabel() {
    return <TabLabel title="Отвесы" value={useOpenWeighingCount()} />;
}

/**
 * Лента рабочего места: продажи и возвраты, незакрытые рассрочки и отвесы во вкладках одной панели.
 * Их продавец смотрит по очереди, поэтому три узкие карточки рядом заменены вкладками.
 * Вкладки и строки крупные: ленту читают на ходу, с расстояния.
 *
 * Вкладка есть только при нужном праве: у продаж и возвратов — на функцию ленты возврата, у отвесов —
 * на функцию отвеса `heldGoods`, у рассрочек — на чтение объекта. Подписи читают списки, и без права сервер ответил бы отказом. Содержимое вкладки остаётся смонтированным
 * после первого показа, поэтому поиск и страница сохраняются при переключении.
 */
function WorkplaceJournal() {
    const feed = useSellerFeedAvailable();
    const installments = useObjectView(Objects.document.saleInstallment) !== undefined;
    const weighings = useHeldGoodsAvailable();
    const items = [
        ...(feed ? [{ key: 'feed', label: 'Продажи', children: <SellerFeed /> }] : []),
        ...(installments ? [{ key: 'installments', label: <InstallmentsLabel />, children: <OpenSaleInstallments /> }] : []),
        ...(weighings ? [{ key: 'weighings', label: <WeighingsLabel />, children: <OpenWeighings /> }] : []),
    ];
    return items.length === 0 ? null : <Panel flushTop><Tabs size="large" items={items} /></Panel>;
}

/**
 * Активное состояние: смена открыта. Под шапкой смены две области (`columns`): слева тайлы
 * действий, справа лента с продажами, незакрытыми рассрочками по продажам и отвесами.
 * Рассрочку продавец оформляет из продажи, поэтому отдельного тайла у неё нет.
 */
function OpenShiftWorkplace({ shift }: { readonly shift: OpenShiftState }) {
    return (
        <Stack gap={5}>
            <ShiftHeader shift={shift} />
            <Grid>
                <Column span={columns.actions}>
                    <Grid subgrid>
                        <DocumentActionTile action="Продать" primary icon={Icons.sell} object={Objects.document.sale} />
                        <DocumentActionTile action="Отложить товар" icon={Icons.weigh} object={Objects.document.weighing} />
                        <DocumentActionTile action="Оформить возврат" icon={Icons.refund} object={Objects.document.refund} />
                    </Grid>
                </Column>
                <Column span={columns.feed}>
                    <WorkplaceJournal />
                </Column>
            </Grid>
        </Stack>
    );
}

/**
 * Рабочее место продавца. У экрана два состояния, их выбирает текущая смена из `useCurrentShift`:
 * без открытой смены показана только панель её открытия, с открытой — шапка смены, действия
 * продавца и информационный блок. Открытие и закрытие смены сбрасывают сохранённые ответы
 * сервера, поэтому экран переключается сам, без перезагрузки.
 *
 * Страница открывает стандартные формы документов и собственных форм не содержит.
 */
export default function SellerWorkplacePage() {
    const { known, error, shift } = useCurrentShift();
    return (
        <Page title="Рабочее место продавца">
            {error !== null && !known ? (
                <Alert type="error" showIcon title="Не удалось прочитать текущую смену" description={error.message} />
            ) : !known ? (
                // До первого ответа неизвестно, открыта ли смена: любое из состояний могло бы мелькнуть зря.
                <Flex justify="center" align="center" style={{ minHeight: '60vh' }}>
                    <Spin />
                </Flex>
            ) : shift === null ? (
                <ClosedShift />
            ) : (
                <OpenShiftWorkplace shift={shift} />
            )}
        </Page>
    );
}
