import { Objects } from '../objects.generated';
import { InstallmentDebts } from './open-installments';

/**
 * Блок «Рассрочки по продажам» на главном экране и на рабочем месте продавца. Стоит отдельно
 * от блока «Рассрочки»: документы разные, и права на их чтение выдаются по отдельности.
 */
export default function OpenSaleInstallments() {
    return <InstallmentDebts object={Objects.document.saleInstallment} title="Рассрочки по продажам" empty="Незакрытых рассрочек по продажам нет" />;
}
