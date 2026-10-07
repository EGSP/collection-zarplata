import { useEffect, useState } from 'react';

/**
 * Возвращает значение с задержкой: новое значение отдаётся, когда оно не менялось `delay` миллисекунд.
 * Нужен там, где значение меняется при каждом нажатии клавиши, а запрос к серверу по каждому
 * нажатию был бы лишним.
 */
export function useDebounced<Value>(value: Value, delay: number): Value {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}
