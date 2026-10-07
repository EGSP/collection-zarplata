/** Пробные текущие сведения для ручной проверки составного ключа и ресурсов разных видов. */
import { informationRegister } from '../../server/metadata/index.js';
import { Sample } from '../catalogs/sample.catalog.js';

/** У пары «источник, внешний объект» есть строковое значение и ссылка на запись приложения. */
export const SampleInformation = informationRegister('sample')
    .title('Пробный регистр сведений')
    .dimension('source', (field) => field.string().title('Источник').maximumLength(100))
    .dimension('externalObject', (field) => field.string().title('Внешний объект').maximumLength(100))
    .resource('description', (field) => field.string().title('Описание').maximumLength(500))
    .resource('item', (field) => field.reference(() => Sample).title('Элемент справочника'));
