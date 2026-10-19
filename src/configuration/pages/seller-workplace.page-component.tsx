import { Alert, Button, Card, Divider, Flex, Result, Spin, theme, Typography } from 'antd';
import type { ComponentType } from 'react';
import { ActionButton, Column, FieldDisplay, Grid, Icons, Page, RecordLink, Stack, useObjectView, useOpenRecord, type ColumnCount, type PerformTarget } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { employeeCount, useCurrentShift, type OpenShiftState } from '../shell-components/current-shift-state';
import OpenSaleInstallments from '../shell-components/open-sale-installments';
import OpenWeighings from '../shell-components/open-weighings';
import RecentSales from '../shell-components/recent-sales';

/** Может ли пользователь создавать записи объекта: сервер оставляет действие `save` только при праве записи. */
function useCreatable(object: PerformTarget): boolean {
    return useObjectView(object)?.form?.actions.some((action) => action.name === 'save') === true;
}

/** Высота тайла действия: такой она была с пояснением в три строки. */
const actionTileHeight = 168;

/**
 * Ширины областей рабочего места в колонках сетки. Тайлы действий стоят по два в строке
 * на среднем контейнере и по четыре начиная с `lg`, как плитки главного экрана. Из справочных
 * карточек продажи и рассрочки шире отвесов: в их строках стоят товары, ФИО и суммы.
 */
const columns = {
    actionTile: { md: 4 },
    recentSales: { lg: 6 },
    installments: { md: 4, lg: 6 },
    weighings: { md: 4 },
} satisfies { readonly [area: string]: ColumnCount };

/** Панель открытия смены по центру страницы: шесть колонок со сдвигом к середине строки. */
const closedShiftSpan: ColumnCount = { md: 6 };
const closedShiftOffset: ColumnCount = { md: 1, lg: 5 };

/** Свойства тайла действия продавца. */
interface ActionTileProperties {
    readonly title: string;
    /** Подпись кнопки: глагол действия, например «Продать». */
    readonly action: string;
    /** Иконка кнопки из реестра `Icons`; у каждого действия своя. */
    readonly icon: ComponentType;
    /** Документ, новая запись которого открывается кнопкой. */
    readonly object: PerformTarget;
}

/**
 * Тайл одного действия продавца: заголовок и единственная кнопка, открывающая новый документ
 * во вкладке. Пояснения нет, но высота тайла прежняя: крупная кнопка остаётся на привычном месте
 * и в неё легко попасть. Списка и общей кнопки «Создать» у тайла нет: продавцу нужно только
 * оформить операцию, а найти прежние документы можно в разделе «Продажи».
 *
 * Тайла нет у пользователя без права записи документа: кнопка, которая всегда завершается
 * отказом, продавцу не нужна. Оформление тайла повторяет `Tile` из SDK: фон карточки без рамки
 * и скруглённые углы, поэтому тайлы действий и плитки главного экрана выглядят одинаково.
 */
function ActionTile({ title, action, icon: Icon, object }: ActionTileProperties) {
    const { token } = theme.useToken();
    const openRecord = useOpenRecord();
    if (!useCreatable(object)) return null;
    return (
        <Column span={columns.actionTile}>
            <Flex
                vertical
                justify="space-between"
                gap="middle"
                style={{ height: '100%', minHeight: actionTileHeight, padding: token.padding, borderRadius: token.borderRadiusLG, background: token.colorBgContainer }}
            >
                <Typography.Text style={{ fontSize: token.fontSizeHeading4, lineHeight: token.lineHeightHeading4 }}>{title}</Typography.Text>
                <Button type="primary" size="large" block icon={<Icon />} onClick={() => void openRecord(object, null)}>
                    {action}
                </Button>
            </Flex>
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
        <Card size="small">
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
        </Card>
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
                    <Card>
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
                    </Card>
                </Column>
            </Grid>
        </Flex>
    );
}

/**
 * Активное состояние: смена открыта. Сверху шапка смены и тайлы действий, под разделительной
 * линией информационный блок: фид последних продаж, незакрытые рассрочки по продажам и отвесы.
 * Фид показывает продавцу, что уже оформлено.
 * Рассрочку продавец оформляет из продажи, поэтому отдельного тайла у неё нет.
 */
function OpenShiftWorkplace({ shift }: { readonly shift: OpenShiftState }) {
    const { token } = theme.useToken();
    return (
        <Stack gap={5}>
            <ShiftHeader shift={shift} />
            <Grid>
                <ActionTile title="Продажа" action="Продать" icon={Icons.sell} object={Objects.document.sale} />
                <ActionTile title="Отвес" action="Отложить товар" icon={Icons.weigh} object={Objects.document.weighing} />
                <ActionTile title="Возврат" action="Оформить возврат" icon={Icons.refund} object={Objects.document.refund} />
            </Grid>
            {/* Линия делит экран на действия и справки. Цвет рамки, а не разделителя: на сером фоне
                страницы стандартная линия Ant Design почти не видна. */}
            <Divider style={{ margin: 0, borderBlockStartWidth: 2, borderColor: token.colorBorder }} />
            {/* Карточки стоят по верхнему краю: высота каждой зависит от числа строк в ней. */}
            <Grid>
                <Column span={columns.recentSales}><RecentSales /></Column>
                <Column span={columns.installments}><OpenSaleInstallments /></Column>
                <Column span={columns.weighings}><OpenWeighings /></Column>
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
