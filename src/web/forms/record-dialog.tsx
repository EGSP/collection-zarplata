/**
 * Модальное окно с формой записи: вторая реализация области окна после вкладки.
 *
 * Окно открывает команда открытия записи SDK в режиме окна. Форма внутри та же, что во вкладке:
 * она обращается к ближайшей области и не знает, что показана в окне. Заголовок и кнопки формы
 * каркас страницы выводит в рамку области: в шапку и нижнюю часть окна.
 *
 * Адреса у окна нет: вкладки выводятся из адреса, и адрес окна открыл бы вкладку. Поэтому окно
 * живёт в состоянии поставщика и после перезагрузки страницы не восстанавливается.
 *
 * Поставщик стоит внутри области, из которой окна открываются. Окно регистрируется в этой области
 * вложенной: закрытие вкладки и страницы браузера учитывают несохранённые изменения в окне.
 * Внутри окна стоит такой же поставщик, поэтому форма в окне может открыть следующее окно.
 *
 * Окно выводится в слой страницы, а не поверх всего приложения: затемнение закрывает только
 * страницу вкладки, и пользователь может перейти на другую вкладку или закрыть эту, не закрывая окна.
 */
import { Button, Modal, theme } from 'antd';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NotFoundPage } from '../common/not-found';
import { useObjectView, useWindowScope, type PerformTarget } from '../sdk';
import { RecordDialogContext, type OpenRecordDialog } from '../sdk/open-record';
import { WindowScopeProvider } from '../window/window-scope';
import { ExistingRecordForm } from './existing-record-form';
import { RecordForm } from './record-form';

interface OpenedDialog {
    readonly id: number;
    readonly object: PerformTarget;
    /** `guid` открытой записи; у формы новой записи `null`. */
    readonly guid: string | null;
}

let nextDialogId = 1;

/**
 * Элемент страницы, в который выводятся её модальные окна с формами. Его даёт область страницы
 * вкладки. Без него окно выводится поверх всего приложения.
 */
export const RecordDialogLayerContext = createContext<HTMLElement | null>(null);

/**
 * Показывает модальные окна с формами записей, открытые со вложенных страниц, и даёт этим
 * страницам команду открытия окна. Должен стоять внутри области окна.
 */
export function RecordDialogHost({ children }: { readonly children: ReactNode }) {
    const [dialogs, setDialogs] = useState<ReadonlyArray<OpenedDialog>>([]);
    /** Вызывающий код каждого открытого окна ждёт итога: `guid` записанной записи либо `null`. */
    const waiting = useRef(new Map<number, (written: string | null) => void>());

    const open = useCallback<OpenRecordDialog>(
        (object, guid) =>
            new Promise((resolve) => {
                const id = nextDialogId++;
                waiting.current.set(id, resolve);
                // Объект мог прийти описанием или ссылкой с типами: окну нужны только вид и имя.
                setDialogs((previous) => [...previous, { id, guid, object: { kind: object.kind, name: object.name } }]);
            }),
        [],
    );
    const finish = useCallback((id: number, written: string | null) => {
        waiting.current.get(id)?.(written);
        waiting.current.delete(id);
        setDialogs((previous) => previous.filter((dialog) => dialog.id !== id));
    }, []);

    useEffect(() => {
        const callers = waiting.current;
        // Область закрыта вместе с окнами: без ответа вызывающий код ждал бы итога бесконечно.
        return () => {
            for (const resolve of callers.values()) resolve(null);
            callers.clear();
        };
    }, []);

    return (
        <RecordDialogContext.Provider value={open}>
            {children}
            {dialogs.map((dialog) => (
                <RecordDialog key={dialog.id} dialog={dialog} onFinish={finish} />
            ))}
        </RecordDialogContext.Provider>
    );
}

// Заголовок окна выводит каркас страницы в рамку, сообщение о заголовке области окну не нужно.
function ignoreTitle(): void {}

interface RecordDialogProperties {
    readonly dialog: OpenedDialog;
    readonly onFinish: (id: number, written: string | null) => void;
}

/**
 * Область окна одного модального окна. Закрытие убирает окно и отдаёт вызывающему коду запись,
 * которую в окне записали. Сообщение о созданной записи значит то же самое: адреса, который
 * нужно было бы сменить, у окна нет, поэтому после создания записи оно закрывается.
 */
function RecordDialog({ dialog, onFinish }: RecordDialogProperties) {
    const { id } = dialog;
    const [header, setHeader] = useState<HTMLElement | null>(null);
    const [footer, setFooter] = useState<HTMLElement | null>(null);
    const frame = useMemo(() => ({ header, footer }), [header, footer]);

    const written = useRef<string | null>(null);
    const remember = useCallback((_object: PerformTarget, guid: string) => {
        written.current = guid;
    }, []);
    const finish = useCallback(() => onFinish(id, written.current), [id, onFinish]);

    return (
        <WindowScopeProvider
            active
            frame={frame}
            onTitle={ignoreTitle}
            onClose={finish}
            onRecordCreated={finish}
            onRecordWritten={remember}
            unsavedChangesWarning="На форме есть несохранённые изменения. Если закрыть окно, они будут потеряны."
        >
            <RecordDialogWindow onHeader={setHeader} onFooter={setFooter}>
                <RecordDialogHost>
                    <RecordDialogContent object={dialog.object} guid={dialog.guid} />
                </RecordDialogHost>
            </RecordDialogWindow>
        </WindowScopeProvider>
    );
}

interface RecordDialogWindowProperties {
    readonly onHeader: (element: HTMLElement | null) => void;
    readonly onFooter: (element: HTMLElement | null) => void;
    readonly children: ReactNode;
}

/** Модальное окно Ant Design с пустыми шапкой и нижней частью: их заполняет каркас страницы. */
function RecordDialogWindow({ onHeader, onFooter, children }: RecordDialogWindowProperties) {
    const { token } = theme.useToken();
    const scope = useWindowScope();
    const layer = useContext(RecordDialogLayerContext);
    return (
        <Modal
            // Окно скрытой вкладки закрыто, а не только спрятано стилем её страницы: открытое окно
            // удерживало бы фокус клавиатуры. Скрытое окно остаётся смонтированным и при возврате
            // на вкладку показано с введёнными значениями.
            open={scope.active}
            getContainer={layer ?? document.body}
            width={720}
            // Esc обрабатывает форма: она отличает закрытие списка выбора от закрытия окна.
            // Со встроенной обработкой подтверждение спрашивалось бы дважды.
            keyboard={false}
            onCancel={scope.close}
            title={
                <div
                    ref={onHeader}
                    // Высота держит шапку, пока запись читается и заголовка ещё нет; отступ оставляет место крестику.
                    style={{ minHeight: '1.5em', paddingInlineEnd: token.controlHeight }}
                />
            }
            footer={<div ref={onFooter} />}
            // Длинная форма прокручивается внутри окна: шапка и кнопки остаются на месте.
            styles={{
                body: { maxHeight: 'calc(100vh - 280px)', overflowY: 'auto', overflowX: 'hidden' },
                // Ant Design закрепляет окно и затемнение относительно окна браузера. В слое страницы они занимают только её.
                ...(layer === null ? {} : { mask: { position: 'absolute' }, wrapper: { position: 'absolute' } }),
            }}
        >
            {children}
        </Modal>
    );
}

/**
 * Содержимое окна: форма новой или существующей записи. Объекта без формы, недоступного объекта
 * и новой записи без права записи вызывающий код открывать не должен; если это случилось, окно
 * отвечает так же, как адрес вкладки.
 */
function RecordDialogContent({ object: target, guid }: { readonly object: PerformTarget; readonly guid: string | null }) {
    const object = useObjectView(target);
    const { close } = useWindowScope();
    if (object === undefined || object.form === null) return <NotFoundPage />;
    if (guid !== null) {
        return (
            <ExistingRecordForm
                object={object}
                view={object.form}
                guid={guid}
                failureAction={
                    <Button type="primary" onClick={close}>
                        Закрыть
                    </Button>
                }
            />
        );
    }
    if (!object.form.actions.some((action) => action.name === 'save')) return <NotFoundPage />;
    return <RecordForm object={object} view={object.form} record={null} reload={null} />;
}
