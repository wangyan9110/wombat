/** Format core explanation codes only; presentation does not calculate intervals or coverage. */
import type {OperationCoverageReason} from '../generated/timing-local-response.js';
import {t,type MessageKey} from './index.js';
const labels = {
 no_paired_operations:'execution.operations.reason.noPairedOperations',
 missing_window:'execution.operations.reason.missingWindow',
 unlocated_operations:'execution.operations.reason.unlocatedOperations',
 identity_gaps:'execution.operations.reason.identityGaps',
 conflicting_operations:'execution.operations.reason.conflictingOperations',
 source_partial:'execution.operations.reason.sourcePartial',
 resource_limit:'execution.operations.reason.resourceLimit',
 numeric_range:'execution.operations.reason.numericRange',
 detail_limit:'execution.operations.reason.detailLimit',
} as const satisfies Record<OperationCoverageReason,MessageKey>;
export function operationCoverageReasonText(reason:OperationCoverageReason):string {return t(labels[reason]);}
