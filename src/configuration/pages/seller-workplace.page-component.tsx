import { Alert, Button, Card, Col, Divider, Flex, Result, Row, Spin, theme, Typography } from 'antd';
import type { ComponentType } from 'react';
import { ActionButton, FieldDisplay, Icons, Page, RecordLink, useObjectView, useOpenRecord, type PerformTarget } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { employeeCount, useCurrentShift, type OpenShiftState } from '../shell-components/current-shift-state';
import OpenSaleInstallments from '../shell-components/open-sale-installments';
import OpenWeighings from '../shell-components/open-weighings';
import RecentSales from '../shell-components/recent-sales';

/** Может ли пользователь создавать записи объекта: сервер оставляет действие `save` только при праве записи. */
function useCreatable(object: PerformTarget): boolean {
    return useObjectView(object)?.form?.actions.some((action) => action.name === 'save') === true;
}

/** Свойства тайла действия продавца. */
interface ActionTileProperties {
    readonly title: string;
    /** Пояснение под заголовком: что оформляет действие. */
    readonly description: string;
    /** Подпись кнопки: глагол действия, например «Продать». */
    readonly action: string;
    /** Иконка кнопки из реестра `Icons`; у каждого действия своя. */
    readonly icon: ComponentType;
    /** Документ, новая запись которого открывается кнопкой. */
    readonly object: PerformTarget;
}

/**
 * Тайл одного действия продавца: заголовок, пояснение и единственная кнопка, открывающая новый
 * документ во вкладке. Списка и общей кнопки «Создать» у тайла нет: продавцу нужно только
 * оформить операцию, а найти прежние документы можно в разделе «Продажи».
 *
 * Тайла нет у пользователя без права записи документа: кнопка, которая всегда завершается
 * отказом, продавцу не нужна. Оформление тайла повторяет `Tile` из SDK: фон карточки без рамки
 * и скруглённые углы, поэтому тайлы действий и плитки главного экрана выглядят одинаково.
 */
function ActionTile({ title, description, action, icon: Icon, object }: ActionTileProperties) {
    const { token } = theme.useToken();
    const openRecord = useOpenRecord();
    if (!useCreatable(object)) return null;
    return (
        <Col xs={24} sm={12} xl={6}>
            <Flex
                vertical
                justify="space-between"
                gap="middle"
                style={{ height: '100%', padding: token.padding, borderRadius: token.borderRadiusLG, background: token.colorBgContainer }}
            >
                <Flex vertical gap="small">
                    <Typography.Text style={{ fontSize: token.fontSizeHeading4, lineHeight: token.lineHeightHeading4 }}>{title}</Typography.Text>
                    <Typography.Text type="secondary">{description}</Typography.Text>
                </Flex>
                <Button type="primary" size="large" block icon={<Icon />} onClick={() => void openRecord(object, null)}>
                    {action}
                </Button>
            </Flex>
        </Col>
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
        <Flex justify="center" align="center" style={{ minHeight: '60vh' }}>
            <Card style={{ maxWidth: 480, width: '100%' }}>
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
        <Flex vertical gap="middle">
            <ShiftHeader shift={shift} />
            <Row gutter={[16, 16]}>
                <ActionTile title="Продажа" description="Продажа товара с оплатой наличными, безналичными или сложной оплатой." action="Продать" icon={Icons.sell} object={Objects.document.sale} />
                <ActionTile title="Отвес" description="Товар откладывается для покупателя до продажи или вывешивания." action="Отложить товар" icon={Icons.weigh} object={Objects.document.weighing} />
                <ActionTile title="Возврат" description="Возврат товара по проведённой продаже." action="Оформить возврат" icon={Icons.refund} object={Objects.document.refund} />
            </Row>
            {/* Линия делит экран на действия и справки. Цвет рамки, а не разделителя: на сером фоне
                страницы стандартная линия Ant Design почти не видна. */}
            <Divider style={{ margin: 0, borderBlockStartWidth: 2, borderColor: token.colorBorder }} />
            <Flex gap="middle" align="flex-start" wrap>
                <RecentSales />
                <OpenSaleInstallments />
                <OpenWeighings />
            </Flex>
        </Flex>
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
