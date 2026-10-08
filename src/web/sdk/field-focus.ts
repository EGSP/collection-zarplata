/**
 * Учёт полей ввода формы по именам, чтобы переводить на них фокус.
 *
 * Форма сама решает, какое поле получает фокус: первое поле при открытии новой записи, а при
 * обходе с клавиатуры следующее имя из порядка обхода (`traversal`) описания формы. Для этого
 * ей нужно найти поле ввода по имени поля или табличной части.
 */
import { useMemo, type RefCallback } from 'react';
import type { InputHandle } from '../widgets/widget';

/** Поля ввода формы по именам. */
export interface FieldFocus {
    /** Ссылка для поля ввода с этим именем. Для одного имени всегда возвращается одна и та же функция. */
    register(name: string): RefCallback<InputHandle>;
    /** Переводит фокус на поле. Возвращает `false`, если поля с таким именем на форме сейчас нет. */
    focus(name: string): boolean;
}

/** Создаёт учёт полей ввода на время жизни компонента формы. */
export function useFieldFocus(): FieldFocus {
    return useMemo(() => {
        const handles = new Map<string, InputHandle>();
        // React вызывает новую функцию-ссылку при каждой отрисовке, поэтому функции хранятся по именам.
        const callbacks = new Map<string, RefCallback<InputHandle>>();
        return {
            register: (name) => {
                let callback = callbacks.get(name);
                if (callback === undefined) {
                    callback = (handle) => {
                        if (handle === null) handles.delete(name);
                        else handles.set(name, handle);
                    };
                    callbacks.set(name, callback);
                }
                return callback;
            },
            focus: (name) => {
                const handle = handles.get(name);
                handle?.focus();
                return handle !== undefined;
            },
        };
    }, []);
}
