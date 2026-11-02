import { theme } from 'antd';
import { useState, type MouseEventHandler, type ReactNode } from 'react';
import { spacing } from '../ds/layout';

/** Свойства плитки, выполняющей одно действие без перехода по адресу. */
export interface ActionTileProperties {
    /** Главное действие выделяется акцентным цветом; остальные используют фон плитки. */
    readonly type?: 'primary' | 'default';
    readonly icon?: ReactNode;
    readonly onClick: MouseEventHandler<HTMLButtonElement>;
    /** Подпись называет действие: например, «Продать» или «Оформить возврат». */
    readonly children: string;
}

/**
 * Кликабельная плитка действия: вся поверхность нажимается, значок слева перед подписью,
 * как у остальных действий интерфейса.
 * В отличие от `Tile`, адреса у неё нет: нативная кнопка вызывает обработчик и поддерживает
 * Enter и пробел. Высота увеличена на треть относительно прежних 64 px, шрифт `fontSizeXL`
 * совпадает с основной кнопкой продажи. Ширину задаёт колонка сетки.
 */
export function ActionTile({ type = 'default', icon, onClick, children }: ActionTileProperties) {
    const { token } = theme.useToken();
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    const primary = type === 'primary';
    const background = primary ? token.colorPrimary : token.colorBgContainer;

    return (
        <button
            type="button"
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            // Щелчок мышью не требует обводки; клавиатурный фокус должен оставаться видимым.
            onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
            onBlur={() => setFocused(false)}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: spacing[5],
                width: '100%',
                // Минимум вместо фиксированной высоты позволяет подписи переноситься при увеличении текста.
                minHeight: 64 * 4 / 3,
                padding: spacing[5],
                boxSizing: 'border-box',
                border: 0,
                borderRadius: token.borderRadiusLG,
                fontFamily: token.fontFamily,
                fontSize: token.fontSizeXL,
                lineHeight: token.lineHeight,
                textAlign: 'left',
                color: primary ? token.colorTextLightSolid : token.colorText,
                background: hovered
                    ? primary ? token.colorPrimaryHover : `linear-gradient(${token.colorFillSecondary}, ${token.colorFillSecondary}), ${background}`
                    : background,
                outline: focused ? `2px solid ${token.colorPrimary}` : 'none',
                outlineOffset: 2,
                cursor: 'pointer',
                transition: `background ${token.motionDurationMid}`,
            }}
        >
            {/* Иконка поддерживает подпись и не дублируется в доступном имени плитки. */}
            {icon !== undefined && <span aria-hidden style={{ display: 'flex', flexShrink: 0, fontSize: token.fontSizeHeading3 }}>{icon}</span>}
            <span>{children}</span>
        </button>
    );
}
