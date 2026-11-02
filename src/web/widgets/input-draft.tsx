/**
 * Текст, который ещё нельзя превратить в значение сервера, принадлежит элементу формы,
 * а не временному редактору ячейки. Валидатор читает его синхронно и запрещает запись
 * прежнего значения, пока пользователь видит неверный текст.
 */
import { Form, type FormItemProps } from 'antd';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

export interface InputDraft {
    readonly text: string;
    readonly error: string | null;
    /** Значение, рядом с которым набран текст: внешняя замена значения сбрасывает черновик. */
    readonly value: unknown;
}

interface DraftState {
    readonly draft: InputDraft | null;
    readonly setDraft: (draft: InputDraft | null) => void;
}

const InputDraftContext = createContext<DraftState | null>(null);

/** Обычный Form.Item с дополнительной проверкой текста, который не является значением. */
export function InputDraftItem({ rules = [], ...properties }: FormItemProps) {
    const [draft, setState] = useState<InputDraft | null>(null);
    const latest = useRef<InputDraft | null>(null);
    return (
        <InputDraftContext value={{ draft, setDraft: (next) => {
            latest.current = next;
            setState(next);
        } }}>
            <Form.Item {...properties} rules={[{
                validator: (_rule, value: unknown) => {
                    const current = latest.current;
                    return current !== null && Object.is(current.value ?? null, value ?? null) && current.error !== null
                        ? Promise.reject(new Error(current.error)) : Promise.resolve();
                },
            }, ...rules]} />
        </InputDraftContext>
    );
}

/** Вне формы (например, в отборе списка) виджет хранит такой же текст локально. */
export function useInputDraft(resetOnUnmount = false): DraftState {
    const context = useContext(InputDraftContext);
    const [draft, setDraft] = useState<InputDraft | null>(null);
    // resetFields размонтирует поле, даже если возвращает то же значение. Владелец ввода
    // очищает черновик при таком сбросе; временный редактор ячейки владельцем не является.
    const clear = useRef(() => context?.setDraft(null));
    useEffect(() => resetOnUnmount ? () => clear.current() : undefined, [resetOnUnmount]);
    return context ?? { draft, setDraft };
}
