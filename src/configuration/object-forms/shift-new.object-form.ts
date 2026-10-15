/**
 * Объявление формы новой смены: в модальном окне смену открывают датой и составом без рамок групп
 * и таблицы состава. Компонент лежит в соседнем файле `shift-new.object-form-component.tsx`.
 */
import { defineObjectForm } from '../../server/metadata/object-forms.js';
import { Objects } from '../objects.generated.js';

/** Заменяет только форму новой записи: открытая смена показывается стандартной формой. */
export const ShiftNew = defineObjectForm({ object: Objects.document.shift, kind: 'new' });
