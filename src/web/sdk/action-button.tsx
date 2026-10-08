import { Button, type ButtonProps } from 'antd';
import { useRef, useState, type ReactNode } from 'react';
import type { FormAction } from '../../server/ui/descriptions';
import { useAction } from '../data-provider/actions';
import { useObjectView } from '../data-provider/metadata';
import type { PerformTarget } from '../data-provider/perform';
import { recordGuid, type RecordData } from '../data-provider/records';
import { ActionDialog } from './action-dialog';
import type { FormValues } from './record-values';

/** Заголовки уведомлений об успехе стандартных действий. У собственного действия заголовком служит его название. */
const standardSuccessMessages: { readonly [action: string]: string } = {
    save: 'Запись сохранена',
    post: 'Документ проведён',
    unpost: 'Проведение отменено',
    markDeleted: 'Запись помечена на удаление',
    unmarkDeleted: 'Пометка удаления снята',
};

/** Заголовок уведомления об успешном выполнении действия. */
export function actionSuccessMessage(action: FormAction): string {
    return (action.standard ? standardSuccessMessages[action.name] : undefined) ?? action.title;
}

/**
 * Применимо ли действие к записи в её состоянии. Из пары «Пометить на удаление» и «Снять пометку
 * удаления» применимо одно, отмена проведения применима только к проведённому документу.
 * Остальные действия от состояния записи не зависят. `record` равен `null`, пока записи нет.
 */
export function actionApplies(action: FormAction, record: RecordData | null): boolean {
    if (!action.standard) return true;
    switch (action.name) {
        case 'unpost':
            return record?.['posted'] === true;
        case 'markDeleted':
            return record !== null && (record['deletedAt'] ?? null) === null;
        case 'unmarkDeleted':
            return record !== null && (record['deletedAt'] ?? null) !== null;
        default:
            return true;
    }
}

/** Свойства кнопки действия. */
export interface ActionButtonProperties {
    /** Объект конфигурации, которому принадлежит действие. Подходит и его описание `ObjectView`. */
    readonly object: PerformTarget;
    /** Запись, над которой выполняется действие. `null`, если записи ещё нет или действие к записи не относится. */
    readonly record: RecordData | null;
    /** Имя действия: стандартное (`post`, `markDeleted`) или собственное действие объекта. */
    readonly action: string;
    /**
     * Входные данные собственного действия. Если они заданы, окно входных данных не открывается:
     * так экран передаёт действию значения, которые знает сам, например `guid` открытой записи.
     */
    readonly input?: FormValues | undefined;
    /**
     * Заменяет выполнение действия: кнопка сохраняет проверку прав, окно входных данных и признак
     * ожидания, а запрос отправляет экран. `input` содержит данные окна либо `null`, если их нет.
     * Об исходе сообщает сам экран; ошибка вызова означает, что действие не выполнено. Так форма
     * записи перед действием записывает несохранённые изменения, а действие `save` получает
     * значения полей: сама кнопка их не знает.
     */
    readonly execute?: ((input: FormValues | null) => Promise<void>) | undefined;
    /** Вызывается после успешного действия с его результатом. При заданном `execute` не вызывается. */
    readonly onCompleted?: ((result: unknown) => void) | undefined;
    /** Действие выполняется по команде извне, например сочетанием клавиш: кнопка показывает ожидание. */
    readonly loading?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly type?: ButtonProps['type'];
    /** Подпись кнопки. По умолчанию название действия из описания формы. */
    readonly children?: ReactNode;
}

/**
 * Кнопка действия над записью или объектом.
 *
 * Кнопка выводится, только если действие есть в описании формы объекта: сервер оставляет там
 * действия, на которые у пользователя есть право. Поэтому экрану не нужно проверять права самому.
 * Не выводится и действие, неприменимое к записи в её состоянии (`actionApplies`).
 *
 * Стандартное действие получает `guid` записи, поэтому без записи его кнопка не выводится.
 * Действие `save` кнопка сама не выполняет: значения полей знает только форма, и ей нужен `execute`.
 * Собственное действие получает входные данные: если они у него объявлены, кнопка сначала
 * открывает окно с их полями.
 *
 * Во время запроса кнопка недоступна. Об успехе и отказе сервера сообщает уведомление, после
 * успеха сохранённые ответы сервера сбрасываются: открытые списки и ссылки перечитываются.
 */
export function ActionButton({ object, record, action: name, input, execute, onCompleted, loading = false, disabled = false, type, children }: ActionButtonProperties) {
    const action = useObjectView(object)?.form?.actions.find((candidate) => candidate.name === name);
    const performAction = useAction();
    const [running, setRunning] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    // Состояние React обновится позже; ссылка блокирует повторное нажатие в том же кадре.
    const executing = useRef(false);

    if (action === undefined || !actionApplies(action, record)) return null;
    if (execute === undefined && action.standard && (record === null || action.name === 'save')) return null;

    const run = async (values: FormValues | null): Promise<void> => {
        if (executing.current) throw new Error('Действие уже выполняется');
        executing.current = true;
        setRunning(true);
        try {
            if (execute !== undefined) return await execute(values);
            const payload = action.standard && record !== null ? { guid: recordGuid(record) } : (values ?? {});
            onCompleted?.(await performAction({ object, action: action.name, payload, successMessage: actionSuccessMessage(action) }));
        } finally {
            executing.current = false;
            setRunning(false);
        }
    };

    return (
        <>
            <Button
                {...(type === undefined ? {} : { type })}
                loading={running || loading}
                disabled={disabled || running}
                onClick={() => {
                    if (action.input.length > 0 && input === undefined) setDialogOpen(true);
                    // Об отказе уже сообщило уведомление либо сам экран, поэтому ошибка здесь не обрабатывается.
                    else run(input ?? null).catch(() => undefined);
                }}
            >
                {children ?? action.title}
            </Button>
            {dialogOpen && <ActionDialog action={action} onExecute={run} onClose={() => setDialogOpen(false)} />}
        </>
    );
}
