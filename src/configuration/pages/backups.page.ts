import { page } from '../../server/ui/pages.js';

/** Резервные копии базы: право страницы не заменяет права чтения и создания копий. */
export const Backups = page('backups').title('Резервные копии');
