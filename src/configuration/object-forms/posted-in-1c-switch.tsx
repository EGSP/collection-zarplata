import { ConfigProvider, Switch, theme } from 'antd';
import { useImperativeHandle, useRef } from 'react';
import type { InputProperties } from '../../web/sdk';

/**
 * Ячейка «Проведено в 1С» в строке товара: переключатель «Да» / «Нет» вместо флажка. Подпись
 * на переключателе читается без заголовка колонки, а включённый переключатель окрашен в жёлтый
 * цвет: так проведённые в 1С товары отличаются от остальных с первого взгляда.
 *
 * Жёлтый взят из золотой палитры Ant Design: на светло-жёлтом белая подпись «Да» не читалась бы.
 */
export function PostedIn1CSwitch({ value, onChange, disabled, id, ref }: InputProperties<unknown>) {
    const { token } = theme.useToken();
    const control = useRef<HTMLButtonElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => control.current?.focus() }));
    return (
        <ConfigProvider theme={{ components: { Switch: { colorPrimary: token.gold6, colorPrimaryHover: token.gold5 } } }}>
            <Switch
                ref={control}
                {...(id === undefined ? {} : { id })}
                checked={value === true}
                disabled={disabled === true}
                checkedChildren="Да"
                unCheckedChildren="Нет"
                onChange={(checked) => onChange?.(checked)}
            />
        </ConfigProvider>
    );
}
