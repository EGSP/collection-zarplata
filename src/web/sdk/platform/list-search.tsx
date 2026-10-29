import { Input } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useDebounced } from '../../common/debounced';

/** Задержка поиска после ввода, в миллисекундах: запрос уходит, когда пользователь перестал печатать. */
const searchDelay = 300;

/** Свойства поля поиска списка. */
export interface ListSearchProperties {
    /** Действующий текст поиска списка. */
    readonly value: string;
    /** Вызывается, когда пользователь ввёл другой текст. Пустая строка означает, что поиск отменён. */
    readonly onSearch: (search: string) => void;
    /** Подсказка в пустом поле и его доступное имя, если поиск идёт не по всем колонкам. По умолчанию «Поиск». */
    readonly placeholder?: string;
}

/**
 * Поле поиска списка: по умолчанию ищет фрагмент в любой видимой колонке вместе с условиями отбора.
 * Экран может искать и по одному полю, назвав его в подсказке.
 *
 * Введённый текст хранится здесь, а не берётся из действующего поиска: список получает его
 * с задержкой, и до этого поле должно показывать то, что пользователь уже набрал. Очистка поля
 * применяется сразу.
 */
export function ListSearch({ value, onSearch, placeholder = 'Поиск' }: ListSearchProperties) {
    const [input, setInput] = useState(value);
    const debounced = useDebounced(input, searchDelay);

    // Текст, который список получил отсюда. Если действующий поиск от него отличается, его изменил
    // не пользователь здесь: например, вкладку открыли по адресу с другим поиском.
    const sent = useRef(value);
    useEffect(() => {
        if (value === sent.current) return;
        sent.current = value;
        setInput(value);
    }, [value]);

    const apply = (search: string) => {
        if (search === sent.current) return;
        sent.current = search;
        onSearch(search);
    };
    useEffect(() => {
        apply(debounced);
        // Применяется только изменение текста: смена обработчика поиск не меняет.
    }, [debounced]);

    return (
        <Input
            aria-label={placeholder}
            placeholder={placeholder}
            allowClear
            value={input}
            onChange={(event) => {
                setInput(event.target.value);
                if (event.target.value === '') apply('');
            }}
        />
    );
}
