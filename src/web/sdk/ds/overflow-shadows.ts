import { theme } from 'antd';
import { useLayoutEffect, type RefObject } from 'react';

/**
 * Следит, есть ли невидимое содержимое по выбранной оси от области прокрутки, и отмечает это
 * атрибутами рамки: по ним CSS показывает тени у краёв. Пересчёт идёт при прокрутке и при смене
 * размеров области и её содержимого.
 */
export function useOverflowShadows(frame: RefObject<HTMLDivElement | null>, scroller: RefObject<HTMLDivElement | null>, axis: 'horizontal' | 'vertical' = 'horizontal') {
    const { token } = theme.useToken();
    useLayoutEffect(() => {
        const outer = frame.current;
        if (outer === null) return;
        outer.classList.add('overflow-shadows');
        outer.setAttribute('data-overflow-axis', axis);
        outer.style.setProperty('--overflow-shadow-color', token[overflowShadowColorToken]);
        return () => { outer.classList.remove('overflow-shadows'); outer.removeAttribute('data-overflow-axis'); outer.style.removeProperty('--overflow-shadow-color'); };
    }, [frame, axis, token[overflowShadowColorToken]]);
    useLayoutEffect(() => {
        const outer = frame.current;
        const area = scroller.current;
        if (outer === null || area === null) return;
        const update = () => {
            // Округление: при дробном масштабе страницы прокрутка до края даёт не ровно ноль.
            const position = axis === 'horizontal' ? area.scrollLeft : area.scrollTop;
            const visible = axis === 'horizontal' ? area.clientWidth : area.clientHeight;
            const total = axis === 'horizontal' ? area.scrollWidth : area.scrollHeight;
            const start = position > 1;
            const end = position + visible < total - 1;
            outer.toggleAttribute('data-overflow-start', start);
            outer.toggleAttribute('data-overflow-end', end);
        };
        update();
        area.addEventListener('scroll', update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(area);
        if (area.firstElementChild !== null) observer.observe(area.firstElementChild);
        return () => {
            area.removeEventListener('scroll', update);
            observer.disconnect();
        };
    }, [axis]);
}

/** Одинаковые размер и градиент для таблиц, навигации и тел модальных окон. */
export const overflowShadowSize = 24;
export const overflowShadowColorToken = 'colorTextTertiary' as const;

/** Направление затемнения от скрытого края к видимому содержимому. */
function shadowGradient(direction: string, color: string): string {
    return `linear-gradient(to ${direction}, ${color}, transparent)`;
}

/**
 * Модальное окно уже имеет прокручиваемое тело: дополнительные обёртки не нужны.
 * Локальные слои фона закрывают общие градиенты у достигнутого края прокрутки.
 */
export function overflowShadowBackground(background: string, color: string): string {
    const edge = overflowShadowSize;
    return [
        `linear-gradient(${background} 30%, transparent) center top / 100% ${3 * edge}px no-repeat local`,
        `linear-gradient(transparent, ${background} 70%) center bottom / 100% ${3 * edge}px no-repeat local`,
        `${shadowGradient('bottom', color)} center top / 100% ${edge}px no-repeat scroll`,
        `${shadowGradient('top', color)} center bottom / 100% ${edge}px no-repeat scroll`,
    ].join(',');
}

// Накладки находятся вне прокручиваемого тела: заливки строк таблицы не перекрывают тень.
// Цвет приходит от текущей темы через хук, геометрия и правила показа общие.
if (typeof document !== 'undefined' && document.getElementById('overflow-shadow-styles') === null) {
    const element = document.createElement('style');
    element.id = 'overflow-shadow-styles';
    const color = 'var(--overflow-shadow-color)';
    element.textContent = `
        .overflow-shadows::before, .overflow-shadows::after { content: ""; position: absolute; pointer-events: none; opacity: 0; z-index: 1; }
        .overflow-shadows[data-overflow-axis="horizontal"]::before, .overflow-shadows[data-overflow-axis="horizontal"]::after { inset-block: 0; width: ${overflowShadowSize}px; }
        .overflow-shadows[data-overflow-axis="horizontal"]::before { left: 0; background: ${shadowGradient('right', color)}; }
        .overflow-shadows[data-overflow-axis="horizontal"]::after { right: 0; background: ${shadowGradient('left', color)}; }
        .overflow-shadows[data-overflow-axis="vertical"]::before, .overflow-shadows[data-overflow-axis="vertical"]::after { inset-inline: 0; height: ${overflowShadowSize}px; }
        .overflow-shadows[data-overflow-axis="vertical"]::before { top: 0; background: ${shadowGradient('bottom', color)}; }
        .overflow-shadows[data-overflow-axis="vertical"]::after { bottom: 0; background: ${shadowGradient('top', color)}; }
        .overflow-shadows[data-overflow-start]::before, .overflow-shadows[data-overflow-end]::after { opacity: 1; }
    `;
    document.head.append(element);
}
