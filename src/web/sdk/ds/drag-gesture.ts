/**
 * Перетаскивание указателем поверх `useMove` из React Aria. Хук отличает перетаскивание от щелчка
 * и отменяет нажатие, которым закончилось перетаскивание. Им пользуются все места, где содержимое
 * тянут мышью (сейчас полоса вкладок), поэтому порог и отмена нажатия не повторяются в каждом
 * компоненте.
 *
 * React Aria щелчок от перетаскивания не отличает: если тянуть полосу за вкладку и отпустить кнопку
 * над ней же, вкладка получит нажатие. Хук считает жест перетаскиванием, когда указатель ушёл дальше
 * `dragThreshold` пикселей от точки нажатия. Нажатия внутри области проверяют `wasDragged()`
 * и после перетаскивания ничего не делают:
 *
 * ```tsx
 * const drag = useDragGesture({ onDrag: (delta) => { scroller.scrollLeft -= delta.x; } });
 * const select = (key: string) => {
 *     if (!drag.wasDragged()) onSelect(key);
 * };
 * return <div {...drag.gestureProps}>…</div>;
 * ```
 */
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useMove } from 'react-aria';

/** Расстояние в пикселях, после которого движение указателя считается перетаскиванием, а не щелчком. */
export const dragThreshold = 4;

/** Указатель, которым начинают перетаскивание. */
export type DragPointerType = 'mouse' | 'pen' | 'touch';

/** Смещение указателя по осям в пикселях с прошлого сообщения. */
export interface DragDelta {
    readonly x: number;
    readonly y: number;
}

/** Настройки перетаскивания. */
export interface DragGestureOptions {
    /**
     * Указатель сдвинулся во время перетаскивания. Первое сообщение приходит, когда пройден порог,
     * и содержит всё смещение от точки нажатия: содержимое догоняет указатель без скачка.
     */
    readonly onDrag: (delta: DragDelta) => void;
    /**
     * Какими указателями можно тянуть. По умолчанию только мышью: на сенсорном экране остаётся
     * родная прокрутка пальцем, а `useMove` перехватил бы её.
     */
    readonly pointerTypes?: ReadonlyArray<DragPointerType>;
}

/** Состояние перетаскивания и свойства для области, которую тянут. */
export interface DragGesture {
    /** Свойства элемента-области: их нужно передать ему целиком. */
    readonly gestureProps: {
        readonly onPointerDownCapture: (event: PointerEvent<HTMLElement>) => void;
        readonly onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => void;
    };
    /** Идёт перетаскивание: порог пройден, кнопка ещё не отпущена. Подходит для курсора `grabbing`. */
    readonly isDragging: boolean;
    /**
     * Был ли последний жест указателем перетаскиванием. Нажатие внутри области проверяет признак
     * и после перетаскивания ничего не делает. Признак снимается со следующим нажатием указателя
     * или клавиши в области, поэтому Enter после перетаскивания работает как обычно.
     */
    readonly wasDragged: () => boolean;
}

const defaultPointerTypes: ReadonlyArray<DragPointerType> = ['mouse'];

/** Перетаскивание области указателем с порогом и отменой нажатия после него. */
export function useDragGesture({ onDrag, pointerTypes = defaultPointerTypes }: DragGestureOptions): DragGesture {
    const [isDragging, setDragging] = useState(false);
    // Жест хранится в ссылке: события указателя приходят чаще, чем нужна отрисовка.
    const gesture = useRef({ total: { x: 0, y: 0 }, dragged: false });
    const allowed = (pointerType: string) => pointerTypes.some((type) => type === pointerType);

    const { moveProps } = useMove({
        onMove: (event) => {
            // Стрелки клавиатуры `useMove` тоже сообщает как движение (`pointerType === 'keyboard'`).
            // Обработчик клавиш хук не подключает, а проверка оставлена на случай, если их подключат.
            if (!allowed(event.pointerType)) return;
            const current = gesture.current;
            if (current.dragged) {
                onDrag({ x: event.deltaX, y: event.deltaY });
                return;
            }
            current.total = { x: current.total.x + event.deltaX, y: current.total.y + event.deltaY };
            if (Math.hypot(current.total.x, current.total.y) <= dragThreshold) return;
            current.dragged = true;
            setDragging(true);
            onDrag(current.total);
        },
        onMoveEnd: () => setDragging(false),
    });

    return {
        gestureProps: {
            // Нажатие слушается на фазе перехвата: `usePress` вкладки останавливает всплытие
            // pointerdown, и до области событие не дошло бы. `useMove` сам останавливает всплытие
            // и отменяет действие по умолчанию, а на фазе перехвата это отняло бы нажатие у вкладки.
            // Поэтому `useMove` получает событие, в котором обе остановки ничего не делают.
            onPointerDownCapture: (event) => {
                gesture.current = { total: { x: 0, y: 0 }, dragged: false };
                if (!allowed(event.pointerType)) return;
                const forwarded: PointerEvent<HTMLElement> = Object.create(event, {
                    stopPropagation: { value: () => {} },
                    preventDefault: { value: () => {} },
                });
                moveProps.onPointerDown?.(forwarded);
            },
            onKeyDownCapture: () => {
                gesture.current.dragged = false;
            },
        },
        isDragging,
        wasDragged: () => gesture.current.dragged,
    };
}
