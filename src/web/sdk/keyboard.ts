/**
 * Обход формы уступает клавиши открытому списку или календарю: первый Enter выбирает
 * значение, следующий переводит фокус. Проверка делается до обработчика самого виджета,
 * поскольку выбор может закрыть список в том же событии.
 */
export function hasOpenPicker(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.getAttribute('aria-expanded') === 'true'
        || target.closest('[data-picker-open="true"]') !== null;
}

/**
 * Открыто ли модальное окно поверх экрана. Такое окно получает сочетания само, чтобы Escape
 * не закрыл и окно, и запись под ним.
 *
 * `screen` — корневой элемент экрана, который спрашивает. Окно, внутри которого экран показан,
 * поверх него не лежит и не учитывается: иначе форма в модальном окне сочла бы себя закрытой
 * собственным окном и отключила бы свои сочетания. Без `screen` учитывается любое видимое окно.
 */
export function hasOpenDialog(screen: Element | null = null): boolean {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .some((dialog) => dialog.getClientRects().length > 0 && (screen === null || !dialog.contains(screen)));
}
