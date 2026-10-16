/**
 * Клиентский состав групп. Главный экран не показывает данных: на нём плитки перехода к рабочим
 * местам, разложенные по сетке. Блок «Текущая смена» стоит над списком смен, набор
 * пробных компонентов — над списком пробного документа. Блоки незакрытых рассрочек и отвесов
 * выводит страница «Рабочее место продавца».
 */
import { defineShellGroups, shellGroup, ShellGroups } from '../web/sdk';
import { Objects } from './objects.generated';
import CurrentShift from './shell-components/current-shift';
import SampleSummary from './shell-components/sample-summary';
import SampleHint from './shell-components/sample-hint';
import SellerWorkplaceTile from './shell-components/seller-workplace-tile';

/** Плитки рабочих мест на главном экране: ширину плитки задаёт сетка группы. */
const homeTiles = shellGroup('home/tiles', 'grid');
const listSamples = shellGroup('sample/list', 'horizontal');
const summary = { component: SampleSummary, requiredObjects: [Objects.informationRegister.sample] };
const currentShift = { component: CurrentShift, requiredObjects: [Objects.document.shift] };
const hint = { component: SampleHint, requiredObjects: [Objects.informationRegister.sample] };

/** Группы и компоненты в порядке добавления, известные до монтирования вкладок. */
export const configurationShellGroups = defineShellGroups([
    { parent: ShellGroups.home, content: homeTiles },
    { parent: homeTiles, content: { component: SellerWorkplaceTile } },
    { parent: ShellGroups.list(Objects.document.shift), content: currentShift },
    { parent: ShellGroups.list(Objects.document.sample), content: listSamples },
    { parent: listSamples, content: summary },
    { parent: listSamples, content: hint },
]);
