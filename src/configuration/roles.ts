/** Роли магазина и доступ к операциям рабочего места продавца. */
import { accessSchema } from '../server/authorization/access-schema.js';
import { role } from '../server/authorization/roles.js';
import { Payroll } from './pages/payroll.page.js';
import { PeriodSummary } from './pages/period-summary.page.js';
import { SellerWorkplace } from './pages/seller-workplace.page.js';

import { AppliedCoupons } from './registers/applied-coupons.register.js';
import { CashDay } from './documents/cash-day.document.js';
import { Certificate } from './documents/certificate.document.js';
import { CertificateBalances } from './registers/certificate-balances.register.js';
import { Coupons } from './catalogs/coupons.catalog.js';
import { Discounts } from './catalogs/discounts.catalog.js';
import { Employees } from './catalogs/employees.catalog.js';
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
import { Shift } from './documents/shift.document.js';
import { UnarrangedInstallments } from './registers/unarranged-installments.register.js';
import { Weighing } from './documents/weighing.document.js';

/** Обе прикладные роли выполняют одни и те же ежедневные операции магазина. */
function storeRole(name: string, title: string) {
    return role(name)
        .title(title)
        .readOnly()
        .access(accessSchema()
            .page(SellerWorkplace, 'allow')
            .object(PhysicalPersons, access => access.level('edit'))
            .object(Employees, access => access.level('read'))
            .object(Nomenclature, access => access.level('read'))
            .object(Discounts, access => access.level('read'))
            // Купон продавец применяет в продаже: окно купона проверяет его действием справочника.
            .object(Coupons, access => access.level('read').action('application', 'allow'))
            .object(PaymentReceivers, access => access.level('read'))
            .object(InstallmentRates, access => access.level('read')))
        // Закрытие смены проводит её вложенным действием: одного права на закрытие недостаточно.
        .access(accessSchema()
            .object(Shift, access => access.level('edit').post('allow').action('close', 'allow')))
        .access(accessSchema()
            .object(Sale, access => access.function('figures', 'allow').function('periodFigures', 'allow').level('edit').post('allow').action('cancel', 'allow').action('changesState', 'allow').action('saveChanges', 'allow').action('sellWithInstallment', 'allow'))
            // Вкладку «Отвесы» на рабочем месте читает функция отвеса `heldGoods`.
            .object(Weighing, access => access.level('edit').post('allow').action('applySale', 'allow').function('heldGoods', 'allow'))
            // Ленту продаж и возвратов на рабочем месте читает функция возврата `sellerFeed`.
            .object(Refund, access => access.level('edit').post('allow').action('returnedGoods', 'allow').action('saleRefunds', 'allow').action('settlementTerms', 'allow').function('sellerFeed', 'allow'))
            .object(SaleInstallment, access => access.level('edit').post('allow').action('pay', 'allow').action('settleByBank', 'allow').function('figures', 'allow'))
            // Сертификаты обоих видов выдаёт и продавец; вкладку «Сертификаты» читает функция `activeCertificates`.
            .object(Certificate, access => access.level('edit').post('allow').action('exchange', 'allow').action('application', 'allow').function('activeCertificates', 'allow')))
        // Проведение проверяет предел возврата по движениям продажи.
        .access(accessSchema()
            .object(SalesNetOfReturns, access => access.level('read'))
            .object(InstallmentDebts, access => access.level('read'))
            .object(UnarrangedInstallments, access => access.level('read'))
            .object(AppliedCoupons, access => access.level('read'))
            .object(CertificateBalances, access => access.level('read')))
        // Продавцы видят начисление всех сотрудников, но период не закрывают: права на «Закрыть период» нет.
        .access(accessSchema()
            .page(Payroll, 'allow')
            .object(PeriodClosing, access => access.level('read').action('payrollPreview', 'allow')))
        // Сводку за период и кассовую сводку продавец видит так же, как зарплату: отчёты только читают.
        .access(accessSchema()
            .page(PeriodSummary, 'allow')
            .object(CashDay, access => access.level('read').functions('allow'))
            .object(PeriodClosing, access => access.action('periodSummary', 'allow').action('cashSummary', 'allow')));
}

/** При запуске сервер собирает права этих ролей из конфигурации. */
export const roles = [
    role('administrator').title('Администратор').readOnly().grantAll(),
    storeRole('seller', 'Продавец'),
    storeRole('manager', 'Управляющий')
        .access(accessSchema()
            .object(SaleInstallment, access => access.action('close', 'allow'))
            .object(CashDay, access => access.action('recordReview', 'allow'))
            // Закрытие периода записывает и проводит документ вложенным действием.
            .object(PeriodClosing, access => access.level('edit').post('allow').action('closePeriod', 'allow'))
            .object(Coupons, access => access.level('edit').function('applications', 'allow'))
            .object(PaymentReceivers, access => access.level('edit'))
            // Движения денег нужны управляющему для сверки; продавец видит итоги в сводке.
            .object(MoneyReceipts, access => access.level('read'))),
];
