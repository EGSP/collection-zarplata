/** Встроенные справочники входят в общую проверку метаданных и расчёт доступа. */
import { Users } from '../users/object.js';
export const platformObjectBuilders = [Users] as const;
