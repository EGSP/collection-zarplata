/**
 * Свойства форм объекта: списка, формы записи и формы новой записи. Их получает и стандартная
 * форма, и собственная форма конфигурации (`defineObjectForm`): реестр форм проверяет компонент
 * по виду формы в объявлении.
 */
import type { FormView, ObjectView } from '../../../server/ui/descriptions';
import type { RecordData } from '../../data-provider/records';
import type { FormValues } from './record-values';

/**
 * Место показа формы: `page` — вкладка с собственным адресом, `dialog` — модальное окно поверх
 * страницы. Модальность видом формы не является: одна и та же форма может вывести в окне
 * сокращённую раскладку, а во вкладке полную.
 */
export type FormPresentation = 'page' | 'dialog';

/** Свойства формы списка. Список показывается только во вкладке. */
export interface ListFormProperties {
    readonly object: ObjectView;
}

/** Свойства формы новой записи. */
export interface NewFormProperties {
    readonly object: ObjectView;
    /** Описание формы: поля, группы и действия, доступные пользователю. */
    readonly view: FormView;
    readonly presentation: FormPresentation;
    /**
     * Значения новой записи от того, кто открыл форму, поверх значений по умолчанию. Например,
     * поле ссылки передаёт введённый текст наименованием записи, которую создаёт из поля.
     */
    readonly initial?: FormValues | undefined;
}

/** Свойства формы существующей записи. */
export interface RecordFormProperties {
    readonly object: ObjectView;
    readonly view: FormView;
    /** Запись, с которой открыта форма. Дальше форма ведёт записанное состояние сама. */
    readonly record: RecordData;
    /**
     * Читает запись с сервера заново. Нужна после собственного действия: оно могло изменить запись,
     * а в ответе её не возвращает.
     */
    readonly reload: () => Promise<RecordData>;
    readonly presentation: FormPresentation;
}
