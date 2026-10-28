import { theme } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Text } from './text';

/** Свойства плитки перехода. */
export interface TileProperties {
    /** Заголовок плитки: название страницы, к которой она ведёт. */
    readonly title: string;
    /** Адрес приложения, например из `pagePath` или `objectPath`. Переход по нему открывает вкладку. */
    readonly to: string;
    /** Крупный рисунок в нижнем правом углу, обычно пиктограмма из `Pictograms`. */
    readonly pictogram?: ReactNode;
}

/**
 * Плитка перехода в духе clickable tile из Carbon: заголовок сверху слева, пиктограмма внизу
 * справа. Вся плитка служит ссылкой.
 *
 * Carbon ставит в правый нижний угол стрелку перехода. Здесь на её месте пиктограмма раздела:
 * так решено для главного экрана, где плитка ведёт на рабочее место. На то, что плитка
 * нажимается, указывают затемнение фона при наведении и указатель мыши.
 *
 * Плитка — ссылка `Link`, а не кнопка с обработчиком: вкладку определяет адрес, поэтому переход
 * по ссылке открывает её, а ссылку можно открыть и в новом окне браузера. Рамки у плитки нет,
 * её выделяет фон; при наведении фон темнеет, при фокусе с клавиатуры появляется обводка.
 * Углы скруглены радиусом карточек Ant Design, а не прямые, как в Carbon: плитка стоит рядом
 * с карточками приложения и должна выглядеть с ними единообразно.
 *
 * Плитка занимает всю ширину своего места, а высоту получает из соотношения сторон. Поэтому
 * размер задаёт сетка: в группе `shellGroup(имя, 'grid')` или в `Col` плитка получает ширину
 * колонки и не растягивается на всю страницу.
 */
export function Tile({ title, to, pictogram }: TileProperties) {
    const { token } = theme.useToken();
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    return (
        <Link
            to={to}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            // Обводка нужна только при фокусе с клавиатуры: щелчок мышью её не показывает.
            onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
            onBlur={() => setFocused(false)}
            style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: token.padding,
                width: '100%',
                // Без явной высоты блок с соотношением сторон растёт по содержимому,
                // поэтому в узкой колонке заголовок и пиктограмма не выходят за плитку.
                aspectRatio: '2 / 1',
                padding: token.padding,
                boxSizing: 'border-box',
                borderRadius: token.borderRadiusLG,
                color: token.colorText,
                textDecoration: 'none',
                // Затемнение при наведении накладывается поверх фона: полупрозрачный цвет заливки
                // сам по себе показал бы под плиткой фон страницы.
                background: hovered ? `linear-gradient(${token.colorFillSecondary}, ${token.colorFillSecondary}), ${token.colorBgContainer}` : token.colorBgContainer,
                outline: focused ? `2px solid ${token.colorPrimary}` : 'none',
                outlineOffset: -2,
                transition: `background ${token.motionDurationMid}`,
            }}
        >
            {/* Заголовок обычного начертания, как заголовки Carbon: крупный размер выделяет его без жирности. */}
            <Text.Heading variant="03">{title}</Text.Heading>
            {/* Пиктограммы Carbon крупнее иконок действий: размер берётся из шкалы размеров темы. */}
            <span aria-hidden style={{ alignSelf: 'flex-end', fontSize: token.sizeXXL, lineHeight: 0 }}>
                {pictogram}
            </span>
        </Link>
    );
}
