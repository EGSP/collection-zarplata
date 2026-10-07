import { useMutation } from '@tanstack/react-query';
import { Button, Card, Flex, Form, Input, type InputRef, Layout, Typography } from 'antd';
import { useRef } from 'react';
import { login } from './session';

interface LoginForm {
    readonly pin: string;
}

/**
 * Экран входа: единственное поле — PIN, по которому сервер определяет пользователя.
 *
 * Экран показывается на месте страницы, закрытой проверкой входа. После успешного входа он
 * никуда не переходит: меняется состояние сессии, и проверка открывает саму страницу. Отказ
 * сервера показывается под полем, а поле очищается, чтобы PIN можно было сразу набрать заново.
 */
export function LoginPage() {
    const [form] = Form.useForm<LoginForm>();
    const input = useRef<InputRef>(null);
    const submit = useMutation({
        mutationFn: login,
        onError: (error) => {
            form.setFields([{ name: 'pin', value: '', errors: [error.message] }]);
            // Нажатие кнопки мышью уводит фокус с поля.
            input.current?.focus();
        },
    });

    return (
        <Layout>
            <Flex justify="center" align="center" style={{ minHeight: '100vh' }}>
                <Card style={{ width: 360 }}>
                    <Typography.Title level={4} style={{ textAlign: 'center' }}>
                        Учёт зарплаты и продаж
                    </Typography.Title>
                    <Form
                        form={form}
                        layout="vertical"
                        requiredMark={false}
                        onFinish={({ pin }) => {
                            // Enter отправляет форму и во время запроса, а сервер считает неудачные попытки входа.
                            if (!submit.isPending) submit.mutate(pin);
                        }}
                        // Поле проверяется только при отправке, поэтому сообщение о прошлой попытке убирается при вводе.
                        onValuesChange={() => form.setFields([{ name: 'pin', errors: [] }])}
                    >
                        <Form.Item
                            name="pin"
                            label="PIN"
                            // Те же границы проверяет сервер; здесь они избавляют от лишнего запроса.
                            rules={[{ required: true, pattern: /^[0-9]{4,12}$/, message: 'PIN содержит от 4 до 12 цифр' }]}
                            normalize={(value: string) => value.replace(/\D/g, '')}
                            validateTrigger="onSubmit"
                        >
                            <Input.Password ref={input} size="large" inputMode="numeric" maxLength={12} autoComplete="off" autoFocus />
                        </Form.Item>
                        <Button type="primary" htmlType="submit" size="large" block loading={submit.isPending}>
                            Войти
                        </Button>
                    </Form>
                </Card>
            </Flex>
        </Layout>
    );
}
