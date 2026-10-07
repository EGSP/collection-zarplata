import { Flex, Spin } from 'antd';

/**
 * Признак ожидания по центру области или, с `fullPage`, всего окна. Появляется с задержкой,
 * чтобы короткие ожидания, например проверка входа без запроса к серверу, не вызывали мигания.
 */
export function Pending({ fullPage = false }: { readonly fullPage?: boolean }) {
    return (
        <Flex justify="center" align="center" style={{ height: fullPage ? '100vh' : '100%' }}>
            <Spin size="large" delay={200} />
        </Flex>
    );
}
