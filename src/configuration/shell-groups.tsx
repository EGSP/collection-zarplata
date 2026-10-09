/**
 * Клиентский состав групп. Блок «Текущая смена» и набор пробных компонентов показаны в двух местах:
 * на главном экране и над списком своего документа.
 */
import { defineShellGroups, shellGroup, ShellGroups } from '../web/sdk';
import { Objects } from './objects.generated';
import CurrentShift from './shell-components/current-shift';
import SampleSummary from './shell-components/sample-summary';
import SampleHint from './shell-components/sample-hint';

const homeSamples = shellGroup('sample/home', 'horizontal');
const listSamples = shellGroup('sample/list', 'horizontal');
const summary = { component: SampleSummary, requiredObjects: [Objects.informationRegister.sample] };
const currentShift = { component: CurrentShift, requiredObjects: [Objects.document.shift] };
const hint = { component: SampleHint, requiredObjects: [Objects.informationRegister.sample] };

/** Группы и компоненты в порядке добавления, известные до монтирования вкладок. */
export const configurationShellGroups = defineShellGroups([
    { parent: ShellGroups.home, content: currentShift },
    { parent: ShellGroups.list(Objects.document.shift), content: currentShift },
    { parent: ShellGroups.home, content: homeSamples },
    { parent: homeSamples, content: summary },
    { parent: homeSamples, content: hint },
    { parent: ShellGroups.list(Objects.document.sample), content: listSamples },
    { parent: listSamples, content: summary },
    { parent: listSamples, content: hint },
]);
