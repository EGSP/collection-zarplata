/** Представления служебного объекта пользователей для общего механизма списков и форм. */
import type { ObjectView } from '../ui/descriptions.js';
import { platformUsers } from './descriptions.js';

/** Хранение PIN и ролей обслуживают собственные формы; окна открывает общая платформа. */
export function userObjectView(canWrite: boolean): ObjectView {
    return {
        ...platformUsers, title: 'Пользователи', presentation: null, lookup: null, functions: [],
        form: {
            fields: [], tableParts: [], groups: [], traversal: [], creationMode: 'tab',
            actions: canWrite ? [{ name: 'save', title: 'Записать', standard: true, input: [] }] : [],
        },
        list: {
            columns: [{ field: 'name', title: 'Имя', kind: 'string', role: 'standard', target: null }],
            filters: [], sortable: [], defaultSort: [], deletionMark: false,
        },
    };
}
