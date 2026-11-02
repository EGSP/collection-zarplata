/**
 * Название поля формы: основной цвет текста и жирное начертание, пока поле можно заполнить.
 * Невидимая жирная копия резервирует ширину, чтобы fluid-поле не сдвигалось при первом символе.
 * Копия исключена из дерева доступности: название читается один раз.
 */
import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';
import { Text } from '../ds/text';

export interface FieldLabelProperties {
    readonly children: ReactNode;
    /** Пустота значения передаётся вызывающим кодом: название не читает данные формы. */
    readonly empty?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly readOnly?: boolean | undefined;
}

/** Пустыми считаются также необязательные поля; число 0 и false являются значениями. */
export function isEmptyFieldValue(value: unknown): boolean {
    return value == null || value === '' || Array.isArray(value) && value.length === 0;
}

/** Одинаковое название для подписи над полем и сегмента перед значением. */
export function FieldLabel({ children, empty = false, disabled, readOnly = false }: FieldLabelProperties) {
    const { componentDisabled } = ConfigProvider.useConfig();
    const strong = empty && !(disabled ?? componentDisabled) && !readOnly;
    return (
        <span style={{ display: 'inline-grid', verticalAlign: 'baseline' }}>
            <span aria-hidden style={{ gridArea: '1 / 1', visibility: 'hidden' }}><Text strong>{children}</Text></span>
            <span style={{ gridArea: '1 / 1' }}><Text strong={strong}>{children}</Text></span>
        </span>
    );
}
