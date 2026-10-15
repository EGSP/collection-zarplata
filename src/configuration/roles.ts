/**
 * Роли конфигурации: полный доступ, работа продавца, чтение и проверка пробной политики.
 *
 * Права берутся из объекта `Rights`, который генератор реестра строит из файлов объектов:
 * право несуществующего объекта или действия — ошибка компиляции.
 */
import { role } from '../server/authorization/roles.js';
import { Rights } from './configuration.generated.js';

/** Наборы прав, назначаемые пользователям по имени роли. */
export const roles = [
    role('administrator')
        .title('Администратор')
        .grantAll(),
    role('seller')
        .title('Продавец')
        .grant(Rights.page.sellerWorkplace.open)
        .grant(Rights.catalog.physicalPersons.read, Rights.catalog.physicalPersons.write,
            Rights.catalog.employees.read, Rights.catalog.nomenclature.read, Rights.catalog.discounts.read,
            // Без чтения приёмников продавец не выберет приёмника в оплате.
            Rights.catalog.paymentReceivers.read)
        // Закрытие смены проводит её вложенным действием: одного права на закрытие недостаточно.
        .grant(Rights.document.shift.read, Rights.document.shift.write, Rights.document.shift.post, Rights.document.shift.actions.close)
        .grant(Rights.document.sale.read, Rights.document.sale.write, Rights.document.sale.post, Rights.document.sale.actions.createInstallment, Rights.document.sale.actions.sellWithInstallment,
            Rights.document.weighing.read, Rights.document.weighing.write, Rights.document.weighing.post, Rights.document.weighing.actions.applySale,
            Rights.document.refund.read, Rights.document.refund.write, Rights.document.refund.post,
            Rights.document.installment.read, Rights.document.installment.write, Rights.document.installment.post, Rights.document.installment.actions.pay,
            // Рассрочку по продаже создаёт действие продажи вложенной записью: одного права на действие недостаточно.
            Rights.document.saleInstallment.read, Rights.document.saleInstallment.write, Rights.document.saleInstallment.post, Rights.document.saleInstallment.actions.pay)
        // Итоги регистров нужны рабочему месту и формам; право закрытия обеих рассрочек продавцу не даётся.
        .grant(Rights.register.sales.read, Rights.register.customerSettlements.read, Rights.register.moneyReceipts.read, Rights.register.saleInstallments.read),
    role('reader')
        .title('Только чтение')
        // Пробные сведения исключены, чтобы проверять скрытие клиентских блоков без запрещённых запросов.
        .grant(Rights.catalog.physicalPersons.read, Rights.catalog.employees.read, Rights.catalog.nomenclature.read, Rights.informationRegister.externalLinks.read, Rights.catalog.sample.read, Rights.catalog.sampleDelegate.read, Rights.document.shift.read, Rights.document.sample.read, Rights.document.periodClosing.read, Rights.register.sample.read)
        // Продажи: чтение документов и справочника и рабочее место, на котором без права записи нет кнопок создания.
        .grant(Rights.catalog.discounts.read, Rights.catalog.paymentReceivers.read, Rights.document.sale.read, Rights.document.installment.read, Rights.document.saleInstallment.read, Rights.document.weighing.read, Rights.document.refund.read, Rights.page.sellerWorkplace.open)
        // Регистры продаж: по ним читаются итоги по продажам, рассрочкам, сменам и способам оплаты.
        .grant(Rights.register.sales.read, Rights.register.customerSettlements.read, Rights.register.moneyReceipts.read, Rights.register.saleInstallments.read),
    role('sampleEditor')
        .title('Запись пробного документа')
        // Права на действие «Принять строки» нет: на этой роли проверяется политика, которая его требует.
        .grant(Rights.catalog.sample.read, Rights.catalog.sampleDelegate.read, Rights.document.sample.read, Rights.document.sample.write),
    role('sampleDocumentReader')
        .title('Чтение пробного документа без справочников')
        // Права на пробный справочник нет: на этой роли проверяется, что ссылка на него показана как «Нет доступа».
        .grant(Rights.document.sample.read, Rights.register.sample.read),
];
