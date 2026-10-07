/**
 * Проверка ввода по правилам из описания поля.
 *
 * Правила приходят с сервера вместе с описанием формы (`rules`), и сервер проверяет по ним же.
 * Клиентская проверка нужна, чтобы пользователь увидел ошибку под полем сразу, без запроса.
 * Правила Ant Design строятся только здесь, поэтому шапка формы, ячейки табличной части
 * и окно входных данных действия проверяют ввод одинаково. Значение проверяется в формате
 * сервера: граница суммы задана в копейках и с копейками же сравнивается.
 */
import type { FormItemProps } from 'antd';
import type { FormField } from '../../server/ui/descriptions';
import { formatMoney, formatNumber } from './format';

/**
 * Возвращает текст ошибки для значения поля или `null`, если значение подходит. Незаполненное
 * необязательное поле подходит всегда.
 */
export function validationMessage(field: FormField, value: unknown): string | null {
    const { rules } = field;
    if (value === null || value === undefined || value === '') return rules.required ? 'Заполните поле' : null;
    if (typeof value === 'string') {
        if (rules.minimumLength !== null && value.length < rules.minimumLength) return `Не меньше ${rules.minimumLength} символов`;
        if (rules.maximumLength !== null && value.length > rules.maximumLength) return `Не больше ${rules.maximumLength} символов`;
    }
    if (typeof value === 'number') {
        // Сумму пользователь вводит в рублях, поэтому и граница в сообщении названа в рублях.
        const format = field.kind === 'money' ? formatMoney : formatNumber;
        if (rules.integer && !Number.isInteger(value)) return 'Введите целое число';
        if (rules.minimum !== null && value < rules.minimum) return `Не меньше ${format(rules.minimum)}`;
        if (rules.maximum !== null && value > rules.maximum) return `Не больше ${format(rules.maximum)}`;
    }
    return null;
}

/** Правила проверки элемента формы Ant Design по описанию поля. */
export function fieldRules(field: FormField): NonNullable<FormItemProps['rules']> {
    return [
        {
            validator: (_rule, value: unknown) => {
                const message = validationMessage(field, value);
                return message === null ? Promise.resolve() : Promise.reject(new Error(message));
            },
        },
    ];
}

/**
 * Нужна ли у подписи поля отметка обязательности. У флажка её нет: он всегда либо установлен,
 * либо снят, и незаполненным не бывает.
 */
export function isMarkedRequired(field: FormField): boolean {
    return field.rules.required && field.kind !== 'boolean';
}

/** Текст ошибки у поля, которое отклонил сервер. Отдельного текста на каждое поле сервер не присылает. */
export const serverRejectionMessage = 'Сервер отклонил значение';

/**
 * Переводит пути полей из ответа 400 в пути полей формы Ant Design. Сервер называет поле путём
 * от начала операции: `payload.fields.lines.0.text`. `prefix` задаёт часть пути, которая
 * соответствует корню формы; пути вне её пропускаются. Номер строки табличной части становится
 * числом: форма различает число и строку в пути поля.
 */
export function formFieldPaths(serverPaths: ReadonlyArray<string>, prefix: string): Array<Array<string | number>> {
    return serverPaths
        .filter((path) => path.startsWith(prefix) && path.length > prefix.length)
        .map((path) =>
            path
                .slice(prefix.length)
                .split('.')
                .map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
        );
}
