import type { ThemeConfig } from 'antd';

/** Значения недоступных полей остаются читаемыми: режим просмотра отличается фоном и рамкой. */
const readableDisabledField = { colorTextDisabled: 'rgba(0, 0, 0, 0.75)' };

/**
 * Тема Ant Design для всех страниц клиента: приложения и графа модулей. Длительности анимаций
 * вдвое короче стандартных 0,1, 0,2 и 0,3 секунды: при стандартных подсветка под курсором
 * и появление выпадающих списков и окон заметно отстают от действия пользователя.
 *
 * Длительности заданы напрямую, а не через `motionUnit`: Ant Design округляет производные
 * значения до десятых долей секунды, и шаг 0,05 дал бы прежние 0,1 секунды.
 */
export const applicationTheme: ThemeConfig = {
    token: {
        motionDurationFast: '0.05s',
        motionDurationMid: '0.1s',
        motionDurationSlow: '0.15s',
    },
    // Общая тема применяется и к ячейкам табличных частей, и к полям обычных форм.
    // Цвет задаётся компонентам ввода: недоступные кнопки сохраняют привычное оформление.
    components: {
        Input: readableDisabledField,
        InputNumber: readableDisabledField,
        Select: { ...readableDisabledField, multipleItemColorDisabled: readableDisabledField.colorTextDisabled },
        DatePicker: { ...readableDisabledField, multipleItemColorDisabled: readableDisabledField.colorTextDisabled },
        Checkbox: readableDisabledField,
        Radio: readableDisabledField,
        Switch: readableDisabledField,
        Segmented: readableDisabledField,
    },
};
