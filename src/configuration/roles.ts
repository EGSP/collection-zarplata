/**
 * Роли конфигурации: полный доступ, работа продавца, чтение и проверка пробной политики.
 *
 * Доступ к данным задаёт типизированная схема, страницы и платформенные операции описывает `Rights`:
 * право несуществующего объекта или действия — ошибка компиляции.
 */
import { accessSchema } from '../server/authorization/access-schema.js';
import { role } from '../server/authorization/roles.js';
import { Rights } from './configuration.generated.js';

import { Discounts } from './catalogs/discounts.catalog.js';
import { Employees } from './catalogs/employees.catalog.js';
import { ExternalLinks } from './information-registers/external-links.information-register.js';
import { InstallmentDebts } from './registers/installment-debts.register.js';
import { InstallmentRates } from './catalogs/installment-rates.catalog.js';
import { MoneyReceipts } from './registers/money-receipts.register.js';
import { Nomenclature } from './catalogs/nomenclature.catalog.js';
import { PaymentReceivers } from './catalogs/payment-receivers.catalog.js';
import { PeriodClosing } from './documents/period-closing.document.js';
import { PhysicalPersons } from './catalogs/physical-persons.catalog.js';
import { Refund } from './documents/refund.document.js';
import { Sale } from './documents/sale.document.js';
import { SaleInstallment } from './documents/sale-installment.document.js';
import { SalesNetOfReturns } from './registers/sales-net-of-returns.register.js';
import { Sample } from './catalogs/sample.catalog.js';
import { SampleDelegate } from './catalogs/sample-delegate.catalog.js';
import { SampleDocument } from './documents/sample.document.js';
import { SampleRegister } from './registers/sample.register.js';
import { Shift } from './documents/shift.document.js';
import { UnarrangedInstallments } from './registers/unarranged-installments.register.js';
import { Weighing } from './documents/weighing.document.js';

/** Наборы прав, назначаемые пользователям по имени роли. */
export const roles = [
    role('administrator')
        .title('Администратор')
        .grantAll(),
    // Просмотр полного дерева и оснований доступа без прав на прикладные данные и управление пользователями.
    role('accessAuditor')
        .title('Просмотр прав доступа')
        .grant(Rights.page.accessRights.open, Rights.platform.authorization.read),
    role('seller')
        .title('Продавец')
        .grant(Rights.page.sellerWorkplace.open)
        .access(accessSchema()
            .object(PhysicalPersons, access => access.level('edit'))
            .object(Employees, access => access.level('read'))
            .object(Nomenclature, access => access.level('read'))
            .object(Discounts, access => access.level('read'))
            .object(PaymentReceivers, access => access.level('read'))
            .object(InstallmentRates, access => access.level('read')))
        // Закрытие смены проводит её вложенным действием: одного права на закрытие недостаточно.
        .access(accessSchema()
            .object(Shift, access => access.level('edit').post('allow').action('close', 'allow')))
        .access(accessSchema()
            .object(Sale, access => access.function('figures', 'allow').level('edit').post('allow').action('cancel', 'allow').action('changesState', 'allow').action('saveChanges', 'allow').action('sellWithInstallment', 'allow'))
            .object(Weighing, access => access.level('edit').post('allow').action('applySale', 'allow'))
            // Ленту продаж и возвратов на рабочем месте читает функция возврата `sellerFeed`.
            .object(Refund, access => access.level('edit').post('allow').action('returnedGoods', 'allow').action('saleRefunds', 'allow').action('settlementTerms', 'allow').function('sellerFeed', 'allow'))
            .object(SaleInstallment, access => access.level('edit').post('allow').action('pay', 'allow').action('settleByBank', 'allow').function('figures', 'allow')))
        // Итоги регистров нужны рабочему месту и формам; право закрытия рассрочки продавцу не даётся.
        .access(accessSchema()
            .object(SalesNetOfReturns, access => access.level('read'))
            .object(InstallmentDebts, access => access.level('read'))
            .object(MoneyReceipts, access => access.level('read'))
            .object(UnarrangedInstallments, access => access.level('read')))
        // Продавцы видят начисление всех сотрудников, но период не закрывают: права на «Закрыть период» нет.
        .grant(Rights.page.payroll.open)
        .access(accessSchema()
            .object(PeriodClosing, access => access.level('read').action('payrollPreview', 'allow')))
        // Сводку за период продавец видит так же, как зарплату: отчёт только читает.
        .grant(Rights.page.periodSummary.open)
        .access(accessSchema()
            .object(PeriodClosing, access => access.action('periodSummary', 'allow'))),
    role('reader')
        .title('Только чтение')
        // Пробные сведения исключены, чтобы проверять скрытие клиентских блоков без запрещённых запросов.
        .access(accessSchema()
            .object(PhysicalPersons, access => access.level('read'))
            .object(Employees, access => access.level('read'))
            .object(Nomenclature, access => access.level('read'))
            .object(ExternalLinks, access => access.level('read'))
            .object(Sample, access => access.level('read'))
            .object(SampleDelegate, access => access.level('read'))
            .object(Shift, access => access.level('read'))
            .object(SampleDocument, access => access.level('read'))
            .object(PeriodClosing, access => access.level('read'))
            .object(SampleRegister, access => access.level('read')))
        // Продажи: чтение документов и справочника и рабочее место, на котором без права записи нет кнопок создания.
        .grant(Rights.page.sellerWorkplace.open)
        .access(accessSchema()
            .object(Discounts, access => access.level('read'))
            .object(PaymentReceivers, access => access.level('read'))
            .object(InstallmentRates, access => access.level('read'))
            .object(Sale, access => access.level('read'))
            .object(SaleInstallment, access => access.level('read'))
            .object(Weighing, access => access.level('read'))
            .object(Refund, access => access.level('read').action('returnedGoods', 'allow').action('saleRefunds', 'allow').action('settlementTerms', 'allow')))
        // Регистры продаж: по ним читаются итоги по продажам, рассрочкам, сменам и способам оплаты.
        .access(accessSchema()
            .object(SalesNetOfReturns, access => access.level('read'))
            .object(InstallmentDebts, access => access.level('read'))
            .object(MoneyReceipts, access => access.level('read'))
            .object(UnarrangedInstallments, access => access.level('read')))
        // Суммы рассрочек на формах продажи и рассрочки считает функция: без права формы их не покажут.
        .access(accessSchema()
            .object(Sale, access => access.function('figures', 'allow'))
            .object(SaleInstallment, access => access.function('figures', 'allow'))
            // Ленту продаж и возвратов на рабочем месте читает функция возврата.
            .object(Refund, access => access.function('sellerFeed', 'allow'))),
    role('sampleEditor')
        .title('Запись пробного документа')
        // Права на действие «Принять строки» нет: на этой роли проверяется политика, которая его требует.
        .access(accessSchema()
            .object(Sample, access => access.level('read'))
            .object(SampleDelegate, access => access.level('read'))
            .object(SampleDocument, access => access.level('edit'))),
    role('sampleDocumentReader')
        .title('Чтение пробного документа без справочников')
        // Права на пробный справочник нет: на этой роли проверяется, что ссылка на него показана как «Нет доступа».
        .access(accessSchema()
            .object(SampleDocument, access => access.level('read'))
            .object(SampleRegister, access => access.level('read'))),
];
