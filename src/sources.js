import { MODE } from './config.js';
import * as liveQuickbooks from './connectors/quickbooks.js';
import * as liveMicrosoft from './connectors/microsoft.js';
import * as offline from './connectors/offline.js';

export const quickbooks = MODE === 'live' ? liveQuickbooks : offline.quickbooks;
export const microsoft = MODE === 'live' ? liveMicrosoft : offline.microsoft;
