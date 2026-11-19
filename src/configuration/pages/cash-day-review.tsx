import { Button, Input, Modal, theme } from 'antd';
import { cloneElement, useId, useRef, useState, type ComponentPropsWithRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import { FocusScope, Overlay, usePopover } from 'react-aria';
import { useOverlayTriggerState, type OverlayTriggerState } from 'react-stately';
import { FieldDisplay, spacing, Stack, Text, useAction, useFunctionResult, useObjectView } from '../../web/sdk';
import type { CashSummary } from '../cash-summary';
import type { CashDayReviewStatus } from '../documents/cash-day.document';
import { Objects } from '../objects.generated';

/** Показывает автора, время и комментарий выбранной записи истории. */
function ReviewDescription({ row }: { readonly row: { readonly appliedAt: string; readonly authorName: string; readonly comment: string | null } }) {
    return (
        <Stack gap={2}>
            <Text tone="secondary">{row.authorName}, <FieldDisplay field={{ kind: 'dateTime', target: null }} value={row.appliedAt} /></Text>
            {row.comment && <Text>{row.comment}</Text>}
        </Stack>
    );
}

/** Всплывающее окно у кнопки даты. Фокус возвращается на дату после закрытия. */
function ReviewPopover({ id, anchor, state, children }: {
    readonly id: string;
    readonly anchor: RefObject<HTMLButtonElement | null>;
    readonly state: OverlayTriggerState;
    readonly children: ReactNode;
}) {
    const popup = useRef<HTMLDivElement>(null);
    const { token } = theme.useToken();
    const { popoverProps } = usePopover({ triggerRef: anchor, popoverRef: popup, placement: 'bottom', offset: spacing[2], isNonModal: true }, state);
    return (
        <Overlay>
            <div {...popoverProps} id={id} ref={popup} role="dialog" aria-label="Сверка дня"
                style={{ ...popoverProps.style, zIndex: 1050, background: token.colorBgElevated,
                    boxShadow: token.boxShadowSecondary, borderRadius: token.borderRadius, padding: spacing[4] }}>
                <FocusScope restoreFocus autoFocus>{children}</FocusScope>
            </div>
        </Overlay>
    );
}

/** Нажатие на выбранную дату открывает команды, доступные для этого дня и роли. */
export function CashDayReview({ trigger, day, closed, summaryVersion, refresh, renderSnapshot }: {
    readonly trigger: ReactElement<ComponentPropsWithRef<'button'>>;
    readonly day: string;
    readonly closed: boolean;
    readonly summaryVersion: string;
    readonly refresh: () => Promise<void>;
    readonly renderSnapshot: (snapshot: CashSummary) => ReactNode;
}) {
    const object = Objects.document.cashDay;
    const canReview = useObjectView(object)?.form?.actions.some((action) => action.name === 'recordReview') === true;
    const history = useFunctionResult({ object, name: 'reviewHistory', payload: { cashDate: day } });
    const anchor = useRef<HTMLButtonElement>(null);
    const popupId = useId();
    const popup = useOverlayTriggerState({});
    const [lineNumber, setLineNumber] = useState(0);
    const snapshot = useFunctionResult({ object, name: 'reviewSnapshot', payload: { cashDate: day, lineNumber }, enabled: lineNumber > 0 });
    const latest = history.data?.[0];
    const [historyOpen, setHistoryOpen] = useState(false);
    const [remarksOpen, setRemarksOpen] = useState(false);
    const [comment, setComment] = useState('');
    const [pending, setPending] = useState(false);
    const execute = useAction();

    /** Отправляет версию текущей сводки; после отказа перечитывает её для повторной сверки. */
    async function save(status: CashDayReviewStatus) {
        setPending(true);
        try {
            await execute({
                object, action: 'recordReview', payload: { cashDate: day, status, comment: status === 'Есть замечания' ? comment : null, summaryVersion },
                successMessage: 'Отметка сохранена', failureMessage: 'Не удалось сохранить отметку',
            });
            popup.close();
            setRemarksOpen(false);
            setComment('');
        } catch {
            await refresh();
        } finally {
            setPending(false);
        }
    }

    /** Открывает историю на последней отметке; остальные снимки доступны по кнопкам. */
    function openHistory() {
        if (latest === undefined) return;
        popup.close();
        setLineNumber(latest.lineNumber);
        setHistoryOpen(true);
    }

    const editable = canReview && !closed;
    if (!editable && latest === undefined) return trigger;
    const label = `${trigger.props['aria-label']}. Открыть сверку дня`;

    return (
        <>
            {cloneElement(trigger, {
                ref: anchor, 'aria-haspopup': 'dialog', 'aria-expanded': popup.isOpen, 'aria-controls': popup.isOpen ? popupId : undefined,
                'aria-label': label, title: label, onClick: popup.toggle,
            })}
            {popup.isOpen && (
                <ReviewPopover id={popupId} anchor={anchor} state={popup}>
                    <Stack gap={3}>
                        {editable && (
                            <>
                                <Button disabled={pending} onClick={() => void save('Проверен')}>Отметить проверенным</Button>
                                <Button disabled={pending} onClick={() => { popup.close(); setComment(''); setRemarksOpen(true); }}>Есть замечания</Button>
                            </>
                        )}
                        {latest !== undefined && <Button onClick={openHistory}>История сверок</Button>}
                    </Stack>
                </ReviewPopover>
            )}
            {remarksOpen && (
                <Modal title="Замечания к кассовому дню" open okText="Сохранить" cancelText="Отмена"
                    confirmLoading={pending} okButtonProps={{ disabled: comment.trim() === '' }} onCancel={() => { if (!pending) setRemarksOpen(false); }}
                    onOk={() => void save('Есть замечания')}>
                    <Input.TextArea aria-label="Замечание" autoSize maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} />
                </Modal>
            )}
            {historyOpen && (
                <Modal title="История сверок" open width="min(1200px, 96vw)" footer={null} onCancel={() => { setHistoryOpen(false); setLineNumber(0); }}>
                    <Stack gap={4}>
                        <Stack orientation="horizontal" gap={3} wrap>
                            {history.data?.map((row) => (
                                <Button key={row.lineNumber} type={row.lineNumber === lineNumber ? 'primary' : 'default'}
                                    aria-pressed={row.lineNumber === lineNumber} onClick={() => setLineNumber(row.lineNumber)}>
                                    {row.lineNumber}. {row.status}
                                </Button>
                            ))}
                        </Stack>
                        {history.data?.filter((row) => row.lineNumber === lineNumber).map((row) => <ReviewDescription key={row.lineNumber} row={row} />)}
                        {snapshot.data ? renderSnapshot(snapshot.data) : <Text tone="secondary">{snapshot.loading ? 'Загрузка снимка…' : 'Снимок недоступен'}</Text>}
                    </Stack>
                </Modal>
            )}
        </>
    );
}
