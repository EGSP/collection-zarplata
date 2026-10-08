/**
 * Схема оболочки: какие подсистемы видит пользователь слева и какие объекты в них лежат.
 *
 * Объекты указываются импортированными билдерами, а не строками: переименование или удаление
 * объекта сразу даёт ошибку компиляции здесь. Объект, не указанный в схеме, в окнах подсистем
 * не показывается, но открывается по адресу и по ссылке из другой записи.
 */
import { shell } from '../server/ui/shell.js';
import { Nomenclature } from './catalogs/nomenclature.catalog.js';
import { PhysicalPersons } from './catalogs/physical-persons.catalog.js';
import { Sample } from './catalogs/sample.catalog.js';
import { PeriodClosing } from './documents/period-closing.document.js';
import { SampleDocument } from './documents/sample.document.js';
import { ExternalLinks } from './information-registers/external-links.information-register.js';
import { SampleInformation } from './information-registers/sample.information-register.js';
import { SampleRegister } from './registers/sample.register.js';

export const applicationShell = shell()
    .subsystem('masterData', (subsystem) => subsystem
        .title('НСИ')
        .group('Справочники', [PhysicalPersons, Nomenclature, Sample])
        .group('Документы', [PeriodClosing, SampleDocument])
        .group('Регистры', [SampleRegister, ExternalLinks, SampleInformation]));
