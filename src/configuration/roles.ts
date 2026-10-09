/**
 * Роли конфигурации. Пока прикладных объектов нет, здесь описаны две роли для пробных объектов;
 * настоящий набор ролей появится вместе с прикладными объектами.
 *
 * Права берутся из объекта `Rights`, который генератор реестра строит из файлов объектов:
 * право несуществующего объекта или действия — ошибка компиляции.
 */
import { role } from '../server/authorization/roles.js';
import { Rights } from './configuration.generated.js';

export const roles = [
    role('administrator')
        .title('Администратор')
        .grantAll(),
    role('reader')
        .title('Только чтение')
        // Пробные сведения исключены, чтобы проверять скрытие клиентских блоков без запрещённых запросов.
        .grant(Rights.catalog.physicalPersons.read, Rights.catalog.employees.read, Rights.catalog.nomenclature.read, Rights.informationRegister.externalLinks.read, Rights.catalog.sample.read, Rights.catalog.sampleDelegate.read, Rights.document.shift.read, Rights.document.sample.read, Rights.document.periodClosing.read, Rights.register.sample.read)
        // Продажи: чтение документов и справочника и рабочее место, на котором без права записи нет кнопок создания.
        .grant(Rights.catalog.discounts.read, Rights.document.sale.read, Rights.document.installment.read, Rights.document.weighing.read, Rights.document.refund.read, Rights.page.sellerWorkplace.open),
];
