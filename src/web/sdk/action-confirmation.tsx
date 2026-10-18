/**
 * Подтверждение собственного действия перед выполнением: окно с кнопками «Подтверждаю», «Отмена»
 * и крестиком. Настройку окна задаёт описание действия (`FormAction.confirmation`), поэтому
 * экраны не решают сами, какое действие подтверждать.
 */
import { Button, Flex, Modal, Typography, theme } from 'antd';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ActionConfirmation, FormAction } from '../../server/ui/descriptions';
import { Icons } from './icons';

/** Свойства окна подтверждения. */
export interface ActionConfirmationDialogProperties {
    /** Действие, которое подтверждается: из него берутся название и настройка окна. */
    readonly action: FormAction;
    readonly confirmation: ActionConfirmation;
    /** Пользователь подтвердил действие. Окно закрывает вызывающий. */
    readonly onConfirm: () => void;
    /** Пользователь отказался: «Отмена», крестик или Esc. */
    readonly onCancel: () => void;
}

/**
 * Окно подтверждения действия. «Подтверждаю» недоступна, пока не истекла задержка: на кнопке идёт
 * обратный отсчёт. «Отмена» и крестик доступны сразу и закрывают окно без выполнения действия.
 *
 * Отсчёт начинается при монтировании окна, поэтому каждое новое открытие ждёт задержку заново.
 * Фокус при открытии стоит на «Отмена»: Enter, нажатый сразу, отказывается от действия, а не
 * подтверждает его. Пока идёт отсчёт, Enter внутри окна вовсе не обрабатывается, даже если фокус
 * перевели на недоступную кнопку подтверждения.
 *
 * Оформление (`tone`) задаёт значок и цвет кнопки: у `danger` она красная, как у необратимых
 * действий Ant Design.
 */
export function ActionConfirmationDialog({ action, confirmation, onConfirm, onCancel }: ActionConfirmationDialogProperties) {
    const { token } = theme.useToken();
    const [remaining, setRemaining] = useState(Math.ceil(confirmation.delay));
    // Момент открытия: остаток считается от него, а не числом срабатываний таймера, которые браузер
    // может задержать в фоновой вкладке.
    const opened = useRef(Date.now());
    useEffect(() => {
        if (confirmation.delay <= 0) return;
        const timer = window.setInterval(() => {
            const left = Math.max(0, Math.ceil(confirmation.delay - (Date.now() - opened.current) / 1000));
            setRemaining(left);
            if (left === 0) window.clearInterval(timer);
        }, 200);
        return () => window.clearInterval(timer);
    }, [confirmation.delay]);
    const waiting = remaining > 0;

    const icons: Record<ActionConfirmation['tone'], ReactNode> = {
        danger: <Icons.confirmDanger style={{ color: token.colorError }} />,
        warning: <Icons.confirmWarning style={{ color: token.colorWarning }} />,
        info: <Icons.confirmInfo style={{ color: token.colorInfo }} />,
    };

    /** Enter во время отсчёта не доходит до кнопок окна. */
    const blockEnter = (event: KeyboardEvent<HTMLElement>) => {
        if (waiting && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    return (
        <Modal
            open
            closable
            mask={{ closable: false }}
            onCancel={onCancel}
            title={(
                <Flex gap="small" align="center">
                    {icons[confirmation.tone]}
                    <span>{confirmation.title ?? `${action.title}?`}</span>
                </Flex>
            )}
            footer={(
                <Flex justify="end" gap="small">
                    <Button autoFocus onClick={onCancel}>Отмена</Button>
                    <Button type="primary" danger={confirmation.tone === 'danger'} disabled={waiting} onClick={onConfirm}>
                        {waiting ? `Подтверждаю (${remaining})` : 'Подтверждаю'}
                    </Button>
                </Flex>
            )}
            modalRender={(node) => <div onKeyDownCapture={blockEnter}>{node}</div>}
        >
            {confirmation.message !== null && <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-line' }}>{confirmation.message}</Typography.Paragraph>}
        </Modal>
    );
}

/** Подтверждение, которое экран запрашивает через `useActionConfirmation`. */
export interface ActionConfirmationState {
    /**
     * Спрашивает подтверждение действия и возвращает ответ пользователя. Действие без
     * `confirmation` подтверждено сразу, окно не открывается.
     */
    readonly confirm: (action: FormAction) => Promise<boolean>;
    /** Окно подтверждения; экран выводит его в своей разметке. Без открытого вопроса `null`. */
    readonly dialog: ReactNode;
}

/**
 * Запрос подтверждения действия для экрана: кнопки действия, меню «Ещё» или собственного блока.
 *
 * ```tsx
 * const confirmation = useActionConfirmation();
 * const run = async () => {
 *     if (await confirmation.confirm(action)) await state.run(action, input);
 * };
 * return <>{confirmation.dialog}<Button onClick={() => void run()}>{action.title}</Button></>;
 * ```
 */
export function useActionConfirmation(): ActionConfirmationState {
    const [question, setQuestion] = useState<{ readonly action: FormAction; readonly confirmation: ActionConfirmation; readonly answer: (confirmed: boolean) => void } | null>(null);
    const confirm = useCallback((action: FormAction) => {
        const confirmation = action.confirmation;
        if (confirmation === undefined) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => setQuestion({ action, confirmation, answer: resolve }));
    }, []);
    const answer = (confirmed: boolean) => {
        question?.answer(confirmed);
        setQuestion(null);
    };
    return {
        confirm,
        dialog: question === null ? null : (
            <ActionConfirmationDialog action={question.action} confirmation={question.confirmation} onConfirm={() => answer(true)} onCancel={() => answer(false)} />
        ),
    };
}
