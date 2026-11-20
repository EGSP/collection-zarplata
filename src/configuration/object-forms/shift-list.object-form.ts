import { defineObjectForm } from '../../server/metadata/object-forms.js';
import { Objects } from '../objects.generated.js';

/** Подключает форму списка смен с отдельной колонкой состава. */
export const ShiftList = defineObjectForm({ object: Objects.document.shift, kind: 'list' });
