import { ConfigProvider, Switch } from 'antd';
import { useImperativeHandle, useRef } from 'react';
import { useAccountingColors, type InputProperties } from '../../web/sdk';

/**
 * Ячейка «Проведено в 1С» в строке товара: переключатель «Да» / «Нет» вместо флажка. Подпись
 * на переключателе читается без заголовка колонки, а включённый переключатель окрашен цветом
 * предупреждения, как зона «Проведено в 1С» в сводке периода: так проведённые в 1С товары
 * отличаются от остальных с первого взгляда.
 *
 * Берётся насыщенный оттенок (`solid`): на светлом фоне предупреждения белая подпись «Да» не читалась бы.
 */
export function PostedIn1CSwitch({ value, onChange, disabled, id, ref }: InputProperties<unknown>) {
    const warning = useAccountingColors().warning;
    const control = useRef<HTMLButtonElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => control.current?.focus() }));
    return (
        <ConfigProvider theme={{ components: { Switch: { colorPrimary: warning.solid, colorPrimaryHover: warning.solidHover } } }}>
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
