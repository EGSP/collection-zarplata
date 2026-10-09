/**
 * Схема оболочки: какие подсистемы видит пользователь слева и какие объекты и страницы в них лежат.
 *
 * Объекты и страницы указываются импортированными билдерами, а не строками: переименование или
 * удаление сразу даёт ошибку компиляции здесь. Объект или страница, не указанные в схеме, в окнах
 * подсистем не показываются, но открываются по адресу, а запись объекта ещё и по ссылке из другой записи.
 */
import { shell } from '../server/ui/shell.js';
import { Discounts } from './catalogs/discounts.catalog.js';
import { Employees } from './catalogs/employees.catalog.js';
import { Nomenclature } from './catalogs/nomenclature.catalog.js';
import { PhysicalPersons } from './catalogs/physical-persons.catalog.js';
import { SampleDelegate } from './catalogs/sample-delegate.catalog.js';
import { Sample } from './catalogs/sample.catalog.js';
import { Installment } from './documents/installment.document.js';
import { PeriodClosing } from './documents/period-closing.document.js';
import { Refund } from './documents/refund.document.js';
import { Sale } from './documents/sale.document.js';
import { SampleSelection } from './documents/sample-selection.document.js';
import { SampleDocument } from './documents/sample.document.js';
import { Shift } from './documents/shift.document.js';
import { Weighing } from './documents/weighing.document.js';
import { ExternalLinks } from './information-registers/external-links.information-register.js';
import { SampleInformation } from './information-registers/sample.information-register.js';
import { SampleWorkplace } from './pages/sample-workplace.page.js';
import { SellerWorkplace } from './pages/seller-workplace.page.js';
import { SampleRegister } from './registers/sample.register.js';

export const applicationShell = shell()
    .subsystem('sales', (subsystem) => subsystem
        .title('Продажи')
        .group('Рабочие места', [SellerWorkplace])
        .group('Документы', [Sale, Weighing, Refund, Installment])
        .group('Справочники', [Discounts]))
    .subsystem('masterData', (subsystem) => subsystem
        .title('НСИ')
        .group('Справочники', [PhysicalPersons, Employees, Nomenclature, Sample, SampleDelegate])
        .group('Документы', [Shift, PeriodClosing, SampleDocument, SampleSelection])
        .group('Регистры', [SampleRegister, ExternalLinks, SampleInformation])
        .group('Рабочие места', [SampleWorkplace]));
