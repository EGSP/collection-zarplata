/**
 * Обход полей формы с клавиатуры: Enter переводит фокус в следующее поле, Shift+Enter в предыдущее.
 *
 * Порядок обхода задаёт экран перечнем имён; у стандартной формы это `traversal` из описания.
 * Обход знает поля по именам (`field-focus.ts`) и пропускает имена, полей которых на экране
 * сейчас нет. Табличная часть входит в порядок одной остановкой: внутри неё ячейки обходит она сама.
 */
import type { KeyboardEvent, RefCallback } from 'react';
import type { InputHandle } from '../widgets/widget';
import { useFieldFocus } from './field-focus';
import { hasOpenDialog, hasOpenPicker } from './keyboard';

/** Атрибут, которым группа полей отмечает элемент поля: по нему обход узнаёт имя поля под фокусом. */
export const fieldAttribute = 'data-form-field';

/** Обход полей экрана. Его получают группы полей (`FieldGroup`) и контейнер, в котором они стоят. */
export interface FieldTraversal {
    /** Ссылка для поля ввода с этим именем. Для одного имени всегда возвращается одна и та же функция. */
    readonly register: (name: string) => RefCallback<InputHandle>;
    /** Переводит фокус в первое поле порядка обхода, которое есть на экране. */
    readonly focusFirst: () => void;
    /** Переводит фокус в ближайшее поле перед названным. Если такого нет, фокус остаётся на месте. */
    readonly previous: (name: string) => void;
    /**
     * Обработчик перехвата нажатий для элемента, внутри которого стоят поля. Enter в поле ввода
     * он забирает себе, остальные нажатия пропускает.
     */
    readonly onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * Создаёт обход полей. При `enabled`, равном `false`, Enter обход не выполняет: так ведёт себя
 * форма, открытая только для просмотра.
 */
export function useFieldTraversal(order: ReadonlyArray<string>, enabled = true): FieldTraversal {
    const fields = useFieldFocus();
    const move = (name: string, direction: number) => {
        for (let index = order.indexOf(name) + direction; index >= 0 && index < order.length; index += direction) {
            const next = order[index];
            if (next !== undefined && fields.focus(next)) break;
        }
    };
    return {
        register: fields.register,
        focusFirst: () => void order.some((name) => fields.focus(name)),
        previous: (name) => move(name, -1),
        onKeyDownCapture: (event) => {
            // Открытый список выбора или календарь получает Enter сам; окно поверх формы тоже.
            if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || !enabled || hasOpenDialog() || hasOpenPicker(event.target)) return;
            const target = event.target;
            // Табличная часть обходит свои ячейки сама, а кнопка и ссылка по Enter срабатывают.
            if (!(target instanceof HTMLElement) || target.closest('[data-table-part], button, a') !== null) return;
            const name = target.closest<HTMLElement>(`[${fieldAttribute}]`)?.getAttribute(fieldAttribute);
            if (name === null || name === undefined) return;
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) move(name, event.shiftKey ? -1 : 1);
        },
    };
}
