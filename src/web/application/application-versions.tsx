import { useStore } from '@tanstack/react-store';
import { Button, Modal, Typography } from 'antd';
import { useEffect } from 'react';
import { checkVersionsOnWake, clientVersions, dismissVersionUpdate, versionUpdate } from '../common/application-versions';

/**
 * Подпись сообщает версии загруженной страницы, даже если сервер уже обновлён или недоступен.
 */
export function ApplicationVersionsText() {
    return (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Платформа {clientVersions.platform} · Конфигурация {clientVersions.configuration}
        </Typography.Text>
    );
}

/** Общее окно стоит вне проверки входа и сохраняет открытые формы до явной перезагрузки. */
export function ApplicationVersionUpdateNotice() {
    const update = useStore(versionUpdate);
    useEffect(() => {
        const onVisible = () => {
            if (document.visibilityState === 'visible') checkVersionsOnWake();
        };
        window.addEventListener('focus', checkVersionsOnWake);
        window.addEventListener('online', checkVersionsOnWake);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            window.removeEventListener('focus', checkVersionsOnWake);
            window.removeEventListener('online', checkVersionsOnWake);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);
    return (
        <Modal
            open={update !== null && !update.dismissed}
            title="Вышло обновление"
            onCancel={dismissVersionUpdate}
            footer={<Button type="primary" onClick={() => window.location.reload()}>Обновить страницу</Button>}
        >
            <Typography.Paragraph>
                Обновите страницу, чтобы работать в новой версии. Если сейчас что-то заполняете, сначала сохраните, а окно можно закрыть.
            </Typography.Paragraph>
        </Modal>
    );
}
