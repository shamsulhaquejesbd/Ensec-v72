/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Ensec ERP - QR Attendance Automated Overtime Request Engine
 * Shared between Express backend (server.ts) and React frontend (ERPContext.tsx).
 */

import {
  DEFAULT_SHIFT_END_TIME,
  DEFAULT_SHIFT_START_TIME,
  formatMinutesAsHHmm,
  formatTime12Hour,
  parseTimeToMinutes,
} from './geofence.ts';
import {
  EmployeeOvertimePolicy,
  OvertimeRequest,
  OvertimeStatus,
  calculateEmployeeIndividualOvertime,
} from '../types/overtime.ts';
import type { AttendanceRecord } from '../types/payroll.ts';

export const MINIMUM_AUTO_OVERTIME_MINUTES = 60;

export interface QrOvertimeEligibility {
  otStartTime24: string;
  otEndTime24: string;
  overtimeMinutes: number;
  overtimeHours: number;
  qualifiesForAutoRequest: boolean;
}

function parseFlexibleTimeMinutes(raw?: string | null): number | null {
  if (!raw || typeof raw !== 'string') return null;
  const normalized = raw
    .trim()
    .replace(/\b([ap])\.?\s*m\.?(?=\s|$)/gi, '$1M');
  return parseTimeToMinutes(normalized);
}

/**
 * Calculates automated overtime eligibility from QR attendance IN/OUT and
 * Payroll & HR Settings Default Shift Start/End Times.
 *
 * Rules:
 * - Overtime starts immediately after configured Default Shift End Time.
 * - Overtime ends at actual attendance OUT time (with overnight rollover support).
 * - Minimum qualifying overtime = 60 minutes (1 hour).
 */
export function calculateQrOvertimeEligibility(params: {
  checkInTime?: string | null;
  checkOutTime?: string | null;
  defaultShiftEndTime?: string | null;
  defaultShiftStartTime?: string | null;
  minimumOvertimeMinutes?: number;
}): QrOvertimeEligibility {
  const minThreshold =
    typeof params.minimumOvertimeMinutes === 'number' && params.minimumOvertimeMinutes > 0
      ? params.minimumOvertimeMinutes
      : MINIMUM_AUTO_OVERTIME_MINUTES;

  const shiftEndMinsRaw =
    parseFlexibleTimeMinutes(params.defaultShiftEndTime) ??
    parseFlexibleTimeMinutes(DEFAULT_SHIFT_END_TIME) ??
    18 * 60;
  const shiftStartMinsRaw =
    parseFlexibleTimeMinutes(params.defaultShiftStartTime) ??
    parseFlexibleTimeMinutes(DEFAULT_SHIFT_START_TIME) ??
    9 * 60;

  const checkInMins = parseFlexibleTimeMinutes(params.checkInTime);
  const checkOutMinsRaw = parseFlexibleTimeMinutes(params.checkOutTime);

  const shiftEndCanonical = formatMinutesAsHHmm(shiftEndMinsRaw);

  if (checkOutMinsRaw === null) {
    return {
      otStartTime24: shiftEndCanonical,
      otEndTime24: '',
      overtimeMinutes: 0,
      overtimeHours: 0,
      qualifiesForAutoRequest: false,
    };
  }

  const outCanonical = formatMinutesAsHHmm(checkOutMinsRaw);
  const isOvernightConfiguredShift = shiftEndMinsRaw < shiftStartMinsRaw;

  let effectiveShiftEnd = shiftEndMinsRaw;
  let adjCheckIn = checkInMins;
  let adjCheckOut = checkOutMinsRaw;

  if (isOvernightConfiguredShift) {
    effectiveShiftEnd = shiftEndMinsRaw + 1440;
    if (adjCheckIn !== null && adjCheckIn < shiftStartMinsRaw) {
      adjCheckIn += 1440;
    }
    if (adjCheckOut < shiftStartMinsRaw) {
      adjCheckOut += 1440;
    }
    if (adjCheckIn !== null && adjCheckOut < adjCheckIn) {
      adjCheckOut += 1440;
    }
  } else if (adjCheckIn !== null && adjCheckOut < adjCheckIn) {
    // Overnight OUT punch on a standard daytime shift (e.g. 08:30 AM -> 01:00 AM)
    adjCheckOut += 1440;
  }

  const otStartMins =
    adjCheckIn !== null && adjCheckIn > effectiveShiftEnd
      ? adjCheckIn
      : effectiveShiftEnd;

  const overtimeMinutes = Math.max(0, adjCheckOut - otStartMins);
  const overtimeHours = Math.round((overtimeMinutes / 60) * 100) / 100;

  return {
    otStartTime24: formatMinutesAsHHmm(otStartMins),
    otEndTime24: outCanonical,
    overtimeMinutes,
    overtimeHours,
    qualifiesForAutoRequest: overtimeMinutes >= minThreshold,
  };
}

export function isOvertimeRequestPendingForAutoUpdate(status?: string | null): boolean {
  const norm = String(status || '').trim();
  return norm === 'Pending Supervisor' || norm === 'Draft' || norm === 'Pending';
}

export function isOvertimeRequestApprovedStatus(status?: string | null): boolean {
  const norm = String(status || '').trim();
  return (
    norm === 'Supervisor Approved' ||
    norm === 'Production Approved' ||
    norm === 'HR Verified' ||
    norm === 'Final Approved'
  );
}

export function isOvertimeRequestRejectedStatus(status?: string | null): boolean {
  return String(status || '').trim() === 'Rejected';
}

const normCode = (val?: string | null): string => String(val || '').trim().toLowerCase();

export function findDuplicateOvertimeRequest(
  requests: OvertimeRequest[],
  employeeId?: string | null,
  employeeCode?: string | null,
  overtimeDate?: string | null,
  excludeRequestId?: string | null
): OvertimeRequest | undefined {
  const targetDate = String(overtimeDate || '').trim().slice(0, 10);
  if (!targetDate) return undefined;
  const targetEmpId = normCode(employeeId);
  const targetEmpCode = normCode(employeeCode);

  return requests.find((req) => {
    if (!req) return false;
    if (excludeRequestId && req.id === excludeRequestId) return false;
    if (String(req.status || '').trim() === 'Cancelled') return false;
    if (String(req.overtimeDate || '').trim().slice(0, 10) !== targetDate) return false;

    const rEmpId = normCode(req.employeeId);
    const rEmpCode = normCode(req.employeeCode);

    if (targetEmpId && rEmpId && rEmpId === targetEmpId) return true;
    if (targetEmpCode && rEmpCode && rEmpCode === targetEmpCode) return true;
    if (targetEmpId && rEmpCode && rEmpCode === targetEmpId) return true;
    if (targetEmpCode && rEmpId && rEmpId === targetEmpCode) return true;
    return false;
  });
}

export function generateNextOvertimeRequestNumber(
  existingRequests: OvertimeRequest[],
  year = new Date().getFullYear()
): string {
  const existingMax = existingRequests.reduce((max, r) => {
    const m = String(r.requestNumber || '').match(/(\d+)$/);
    const num = m ? parseInt(m[1], 10) : 0;
    return num > max ? num : max;
  }, 0);
  const nextSeq = Math.max(existingMax + 1, existingRequests.length + 1);
  return `OTR-${year}-${String(nextSeq).padStart(3, '0')}`;
}

export type QrOvertimeSyncAction =
  | 'CREATED'
  | 'UPDATED'
  | 'LOCKED_APPROVED'
  | 'LOCKED_REJECTED'
  | 'BELOW_THRESHOLD_NO_REQUEST'
  | 'BELOW_THRESHOLD_EXISTING_UNCHANGED';

export interface QrOvertimeSyncResult {
  action: QrOvertimeSyncAction;
  eligibility: QrOvertimeEligibility;
  request?: OvertimeRequest;
  message: string;
}

export function reconcileQrOvertimeRequest(params: {
  existingRequests: OvertimeRequest[];
  attendanceRecord: AttendanceRecord;
  employee: {
    id: string;
    code?: string;
    name: string;
    department?: string;
    designation?: string;
    employeeCategory?: string;
    basicSalaryBDT?: number;
  };
  salaryBasicBDT?: number;
  salaryGrossBDT?: number;
  policy?: Partial<EmployeeOvertimePolicy>;
  defaultShiftEndTime?: string | null;
  defaultShiftStartTime?: string | null;
  nowIso?: string;
}): QrOvertimeSyncResult {
  const {
    existingRequests,
    attendanceRecord,
    employee,
    salaryBasicBDT,
    salaryGrossBDT,
    policy,
    defaultShiftEndTime,
    defaultShiftStartTime,
    nowIso = new Date().toISOString(),
  } = params;

  const checkInTime = attendanceRecord.inTime || attendanceRecord.checkInTime || '';
  const checkOutTime = attendanceRecord.outTime || attendanceRecord.checkOutTime || '';
  const attendanceDate = String(attendanceRecord.date || '').slice(0, 10);

  const eligibility = calculateQrOvertimeEligibility({
    checkInTime,
    checkOutTime,
    defaultShiftEndTime,
    defaultShiftStartTime,
    minimumOvertimeMinutes: MINIMUM_AUTO_OVERTIME_MINUTES,
  });

  const existing = findDuplicateOvertimeRequest(
    existingRequests,
    employee.id,
    employee.code,
    attendanceDate
  );

  if (existing) {
    if (isOvertimeRequestApprovedStatus(existing.status)) {
      return {
        action: 'LOCKED_APPROVED',
        eligibility,
        request: existing,
        message: `Overtime request ${existing.requestNumber} is already ${existing.status} and locked from automatic updates.`,
      };
    }

    if (isOvertimeRequestRejectedStatus(existing.status)) {
      return {
        action: 'LOCKED_REJECTED',
        eligibility,
        request: existing,
        message: `Overtime request ${existing.requestNumber} is already Rejected and locked from automatic updates.`,
      };
    }

    if (!eligibility.qualifiesForAutoRequest) {
      return {
        action: 'BELOW_THRESHOLD_EXISTING_UNCHANGED',
        eligibility,
        request: existing,
        message: `Overtime duration (${eligibility.overtimeMinutes} mins) is under 1 hour; existing request ${existing.requestNumber} unchanged.`,
      };
    }

    if (isOvertimeRequestPendingForAutoUpdate(existing.status)) {
      const basic = Number(salaryBasicBDT ?? existing.basicSalaryBDT ?? employee.basicSalaryBDT ?? 25000);
      const effectivePolicy: Partial<EmployeeOvertimePolicy> = policy || {
        isEligible: true,
        calculationBasis: 'Basic Salary',
        standardMonthlyWorkingHours: 208,
        overtimeMultiplier: existing.overtimeMultiplier ?? 2.0,
        status: 'Active',
      };
      const costCalc = calculateEmployeeIndividualOvertime(
        basic,
        effectivePolicy,
        eligibility.overtimeHours
      );

      const outLabel = formatTime12Hour(eligibility.otEndTime24) || eligibility.otEndTime24;
      const inLabel = formatTime12Hour(checkInTime) || checkInTime;

      const updated: OvertimeRequest = {
        ...existing,
        // Keep ID, requestNumber, status, approval hierarchy, and projectPurpose untouched
        expectedEndTime: eligibility.otEndTime24,
        expectedHours: eligibility.overtimeHours,
        actualOvertimeHours: eligibility.overtimeHours,
        attendanceId: attendanceRecord.id || existing.attendanceId,
        basicSalaryBDT: basic,
        hourlyRateBDT: costCalc.hourlyRate,
        overtimeMultiplier: costCalc.multiplier,
        calculatedOvertimeAmountBDT: costCalc.totalAmountBDT,
        overtimeReason:
          existing.sourceType === 'QR_ATTENDANCE_AUTO'
            ? `Auto-generated from QR Attendance (IN: ${inLabel || '—'}, OUT updated: ${outLabel})`
            : existing.overtimeReason,
        updatedAt: nowIso,
      };

      return {
        action: 'UPDATED',
        eligibility,
        request: updated,
        message: `Updated pending Overtime Request ${existing.requestNumber} to ${eligibility.overtimeHours}h (OUT ${outLabel}).`,
      };
    }
  }

  if (!eligibility.qualifiesForAutoRequest) {
    return {
      action: 'BELOW_THRESHOLD_NO_REQUEST',
      eligibility,
      message:
        eligibility.overtimeMinutes > 0
          ? `Overtime duration (${eligibility.overtimeMinutes} mins) is under the 1-hour minimum; no request generated.`
          : 'No qualifying overtime after Default Shift End Time.',
    };
  }

  const basic = Number(salaryBasicBDT ?? employee.basicSalaryBDT ?? 25000);
  const gross = Number(salaryGrossBDT ?? (basic > 0 ? Math.round(basic * 1.6) : 40000));
  const costCalc = calculateEmployeeIndividualOvertime(
    basic,
    policy,
    eligibility.overtimeHours
  );

  const year = Number(attendanceDate.slice(0, 4)) || new Date().getFullYear();
  const reqNumber = generateNextOvertimeRequestNumber(existingRequests, year);
  const sanitizedEmpId = String(employee.id || employee.code || 'emp').replace(/[^a-zA-Z0-9_-]/g, '');
  const reqId = `otr-qr-${sanitizedEmpId}-${attendanceDate}`;

  const inLabel = formatTime12Hour(checkInTime) || checkInTime || '—';
  const outLabel = formatTime12Hour(eligibility.otEndTime24) || eligibility.otEndTime24;
  const shiftEndLabel = formatTime12Hour(eligibility.otStartTime24) || eligibility.otStartTime24;

  const created: OvertimeRequest = {
    id: reqId,
    requestNumber: reqNumber,
    employeeId: employee.id,
    employeeCode: employee.code || 'EMP-000',
    employeeName: employee.name || 'Staff Member',
    department: employee.department || 'Operations',
    designation: employee.designation || 'Staff',
    employeeCategory: employee.employeeCategory || 'Factory Employee',
    overtimeDate: attendanceDate,
    purposeCategory: 'General Operations',
    projectPurpose: '', // Must remain blank initially so authorized approver selects purpose
    sourceType: 'QR_ATTENDANCE_AUTO',
    expectedStartTime: eligibility.otStartTime24,
    expectedEndTime: eligibility.otEndTime24,
    expectedHours: eligibility.overtimeHours,
    actualOvertimeHours: eligibility.overtimeHours,
    overtimeReason: `Auto-generated from QR Attendance (IN: ${inLabel}, Shift End: ${shiftEndLabel}, OUT: ${outLabel})`,
    requestedBy: 'QR Attendance Automation',
    requestedAt: nowIso,
    status: 'Pending Supervisor',
    attendanceId: attendanceRecord.id,
    basicSalaryBDT: basic,
    grossSalaryBDT: gross,
    hourlyRateBDT: costCalc.hourlyRate,
    overtimeMultiplier: costCalc.multiplier,
    calculatedOvertimeAmountBDT: costCalc.totalAmountBDT,
    batchAllocations: [],
    isPayrollProcessed: false,
    isCostingAllocated: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    action: 'CREATED',
    eligibility,
    request: created,
    message: `Auto-generated Overtime Request ${reqNumber} (${eligibility.overtimeHours}h OT from ${shiftEndLabel} to ${outLabel}).`,
  };
}
