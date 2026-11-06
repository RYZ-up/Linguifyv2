import { services } from '../../server/firebase.mjs';
import { purgeExpiredGuests } from '../../server/guest-cleanup.mjs';

// Scheduled every hour: guest accounts older than 24 h are deleted with their data (see server/guest-cleanup.mjs).
export default async function purgeGuests() {
  try {
    const { deleted, orphans } = await purgeExpiredGuests(services(), Date.now());
    console.log(`purge-guests : ${deleted} invité(s) supprimé(s), ${orphans} classement(s) orphelin(s)`);
  } catch (error) {
    console.error('purge-guests failed:', error?.code || error?.name || 'UnknownError');
  }
}
export const config = { schedule: '@hourly' };
