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

/** Окно поверх формы получает сочетания само, чтобы Escape не закрыл и окно, и запись. */
export function hasOpenDialog(): boolean {
    return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
        .some((dialog) => dialog.getClientRects().length > 0);
}
