import { Flex, Spin } from 'antd';

/**
 * Признак ожидания по центру области или, с `fullPage`, всего окна. Появляется с задержкой,
 * чтобы короткие ожидания, например проверка входа без запроса к серверу, не вызывали мигания.
 */
export function Pending({ fullPage = false, label }: { readonly fullPage?: boolean; readonly label?: string }) {
    return (
        <Flex vertical gap="small" justify="center" align="center" style={{ height: fullPage ? 'var(--application-height, 100dvh)' : '100%' }}>
            <Spin size="large" delay={200} />
            {label !== undefined && <span role="status">{label}</span>}
        </Flex>
    );
}
