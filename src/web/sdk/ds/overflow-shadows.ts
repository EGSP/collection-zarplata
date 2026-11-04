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
            // Толщина полос прокрутки: тени стоят над содержимым, а не над полосами. Иначе тень
            // ложилась на полосу у правого или нижнего края и выглядела тенью самой полосы.
            outer.style.setProperty('--overflow-scrollbar-inline', `${area.offsetWidth - area.clientWidth}px`);
            outer.style.setProperty('--overflow-scrollbar-block', `${area.offsetHeight - area.clientHeight}px`);
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
// Слой накладок выше закреплённых строк области прокрутки, например заголовка дня в ленте
// (`z-index` до 2): тень под закреплённой строкой видна, а не прячется за её фоном.
// Цвет приходит от текущей темы через хук, геометрия и правила показа общие.
// Области, которой нужны тени по обеим осям, ставят две вложенные рамки вокруг одного элемента
// прокрутки: каждая рамка рисует тени своей оси. Переменная `--overflow-shadow-start` сдвигает
// верхнюю тень вниз, например под закреплённый заголовок таблицы: тень на заголовке выглядела бы
// так, будто скрыт сам заголовок.
if (typeof document !== 'undefined' && document.getElementById('overflow-shadow-styles') === null) {
    const element = document.createElement('style');
    element.id = 'overflow-shadow-styles';
    const color = 'var(--overflow-shadow-color)';
    element.textContent = `
        .overflow-shadows::before, .overflow-shadows::after { content: ""; position: absolute; pointer-events: none; opacity: 0; z-index: 3; }
        .overflow-shadows[data-overflow-axis="horizontal"]::before, .overflow-shadows[data-overflow-axis="horizontal"]::after { top: 0; bottom: var(--overflow-scrollbar-block, 0px); width: ${overflowShadowSize}px; }
        .overflow-shadows[data-overflow-axis="horizontal"]::before { left: 0; background: ${shadowGradient('right', color)}; }
        .overflow-shadows[data-overflow-axis="horizontal"]::after { right: var(--overflow-scrollbar-inline, 0px); background: ${shadowGradient('left', color)}; }
        .overflow-shadows[data-overflow-axis="vertical"]::before, .overflow-shadows[data-overflow-axis="vertical"]::after { left: 0; right: var(--overflow-scrollbar-inline, 0px); height: ${overflowShadowSize}px; }
        .overflow-shadows[data-overflow-axis="vertical"]::before { top: var(--overflow-shadow-start, 0px); background: ${shadowGradient('bottom', color)}; }
        .overflow-shadows[data-overflow-axis="vertical"]::after { bottom: var(--overflow-scrollbar-block, 0px); background: ${shadowGradient('top', color)}; }
        .overflow-shadows[data-overflow-start]::before, .overflow-shadows[data-overflow-end]::after { opacity: 1; }
    `;
    document.head.append(element);
}
