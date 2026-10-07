import { App } from 'antd';
import { useEffect, type RefObject } from 'react';
import { useBlocker } from 'react-router';

/**
 * Спрашивает подтверждение, когда пользователь уходит с формы с несохранёнными изменениями.
 *
 * Уход внутри приложения (кнопка «Закрыть», меню, кнопка браузера «Назад») останавливает
 * блокировщик React Router, и подтверждение спрашивает окно приложения. Закрытие вкладки
 * и переход на другой сайт приложение остановить не может: там подтверждение показывает сам
 * браузер своим текстом.
 *
 * Признак изменений передаётся ссылкой, а не значением: форма сбрасывает его сразу после записи
 * и тут же меняет адрес, а значение из состояния к этому моменту ещё не обновилось бы.
 */
export function useLeaveGuard(changed: RefObject<boolean>): void {
    const { modal } = App.useApp();
    // Смена строки запроса или состояния того же адреса уходом не считается.
    const blocker = useBlocker(({ currentLocation, nextLocation }) => changed.current && currentLocation.pathname !== nextLocation.pathname);

    useEffect(() => {
        if (blocker.state !== 'blocked') return;
        modal.confirm({
            closable: true,
            title: 'Закрыть форму без сохранения?',
            content: 'На форме есть несохранённые изменения. Если уйти, они будут потеряны.',
            okText: 'Уйти без сохранения',
            cancelText: 'Остаться',
            onOk: () => blocker.proceed(),
            onCancel: () => blocker.reset(),
        });
        // Окно открывается один раз на остановленный переход: объект блокировщика пересоздаётся при отрисовках.
    }, [blocker.state]);

    useEffect(() => {
        const confirmUnload = (event: BeforeUnloadEvent) => {
            if (changed.current) event.preventDefault();
        };
        window.addEventListener('beforeunload', confirmUnload);
        return () => window.removeEventListener('beforeunload', confirmUnload);
    }, [changed]);
}
