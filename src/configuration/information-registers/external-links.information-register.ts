/** Внешние адреса записей: одна тройка источника указывает на одну запись приложения. */
import { informationRegister } from '../../server/metadata/index.js';

/** Целевая запись хранится общей ссылкой, пригодной для перехода из списка в карточку. */
export const ExternalLinks = informationRegister('externalLinks')
    .title('Внешние связи')
    .dimension('externalSystem', (field) => field.string().title('Внешняя система').maximumLength(100))
    .dimension('sourceObject', (field) => field.string().title('Вид объекта источника').maximumLength(200))
    .dimension('externalIdentifier', (field) => field.string().title('Внешний идентификатор').maximumLength(200))
    .resource('record', (field) => field.reference().title('Объект').required());
