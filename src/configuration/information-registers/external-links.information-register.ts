/** Внешние адреса записей: одна тройка источника указывает на одну запись приложения. */
import { informationRegister } from '../../server/metadata/index.js';

/** Целевой объект хранится отдельно от guid, поскольку ссылка может вести в любой справочник. */
export const ExternalLinks = informationRegister('externalLinks')
    .title('Внешние связи')
    .dimension('externalSystem', (field) => field.string().title('Внешняя система').maximumLength(100))
    .dimension('sourceObject', (field) => field.string().title('Вид объекта источника').maximumLength(200))
    .dimension('externalIdentifier', (field) => field.string().title('Внешний идентификатор').maximumLength(200))
    .resource('targetObject', (field) => field.string().title('Целевой справочник').required())
    .resource('recordGuid', (field) => field.string().title('Идентификатор записи').required());
