/**
 * Общие правила модальных окон. Окно не выходит за пределы экрана: по ширине оно не шире экрана
 * без полей, а по высоте шапка и кнопки остаются на месте, и прокручивается только тело окна.
 * Когда в теле есть невидимое содержимое, у верхнего или нижнего края тела видна тень, как у края
 * прокрутки таблицы, поэтому пользователь знает, что окно можно прокрутить.
 *
 * Правила задаются один раз в корне приложения, а не в каждом окне:
 *
 * ```tsx
 * <ConfigProvider theme={applicationTheme}>
 *     <DialogStyles />
 *     …
 * </ConfigProvider>
 * ```
 *
 * Тени сделаны без измерений: два слоя фона прокручиваются вместе с содержимым и закрывают тени
 * у края, до которого содержимое прокручено, а два слоя теней стоят на месте. Поэтому тень видна
 * только с той стороны, где ещё есть содержимое.
 */
import { theme } from 'antd';
import { spacing } from './layout';

/** Отступ окна от верхнего края экрана у Ant Design и запас снизу: вместе они ограничивают высоту окна. */
const dialogTop = 100;

/** Правила окон для текущей темы: фон тела совпадает с фоном окна, иначе слои фона были бы видны. */
export function DialogStyles() {
    const { token } = theme.useToken();
    const background = token.colorBgElevated;
    const shadow = token.colorFill;
    const edge = spacing[5];
    const css = [
        `.ant-modal { max-width: calc(100vw - ${2 * edge}px); }`,
        `.ant-modal .ant-modal-container { display: flex; flex-direction: column; max-height: calc(100dvh - ${dialogTop + spacing[6]}px); }`,
        `.ant-modal .ant-modal-header, .ant-modal .ant-modal-footer { flex: none; }`,
        [
            `.ant-modal .ant-modal-body { flex: 1 1 auto; min-height: 0; overflow: auto; background:`,
            `linear-gradient(${background} 30%, transparent) center top / 100% ${3 * edge}px no-repeat local,`,
            `linear-gradient(transparent, ${background} 70%) center bottom / 100% ${3 * edge}px no-repeat local,`,
            `radial-gradient(farthest-side at 50% 0, ${shadow}, transparent) center top / 100% ${edge}px no-repeat scroll,`,
            `radial-gradient(farthest-side at 50% 100%, ${shadow}, transparent) center bottom / 100% ${edge}px no-repeat scroll; }`,
        ].join(' '),
    ].join('\n');
    return <style>{css}</style>;
}
