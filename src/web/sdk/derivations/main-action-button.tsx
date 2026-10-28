/**
 * Кнопка главного действия формы: «Продать», «Оформить возврат», «Отвесить». Формы продажи,
 * возврата и отвеса раньше повторяли один и тот же inline-стиль высоты, отступа и шрифта.
 * Теперь размер задан здесь один раз: изменение его меняет все формы.
 *
 * ```tsx
 * <MainActionButton type="primary" icon={<Icons.sell />} onClick={sell}>Продать</MainActionButton>
 * ```
 *
 * Вид кнопки выбирает форма: у главного действия обычно `primary`, у второго крупного действия
 * рядом с ним, например «Вывесить» в отвесе, — `default`.
 */
import { Button, type ButtonProperties } from '../ds/button';

/** Свойства кнопки главного действия: всё, кроме размера, который задан компонентом. */
export type MainActionButtonProperties = Omit<ButtonProperties, 'size'>;

/** Крупная кнопка главного действия формы, 64 px (`xl` по шкале Carbon). */
export function MainActionButton(properties: MainActionButtonProperties) {
    return <Button {...properties} size="xl" />;
}
