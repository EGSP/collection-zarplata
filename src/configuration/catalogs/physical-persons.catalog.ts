/** Физические лица для учёта: ФИО хранится в стандартном наименовании. */
import { catalog } from '../../server/metadata/index.js';

/** Неизвестный пол и отсутствующие контакты допускаются без выдуманных значений. */
export const PhysicalPersons = catalog('physicalPersons')
    .title('Физические лица')
    .field('gender', (field) => field.string().title('Пол').choices(['Мужской', 'Женский']))
    .field('birthDate', (field) => field.date().title('Дата рождения'))
    .field('phoneNumber', (field) => field.string().title('Номер телефона').maximumLength(100))
    .form((form) => form.title('name', 'ФИО'));
