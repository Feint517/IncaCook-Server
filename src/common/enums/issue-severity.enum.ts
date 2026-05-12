export enum IssueSeverity {
  /** Driver cannot continue (restaurant closed, no buyer at door, …). */
  Abort = 'ABORT',
  /** Mid-job concern; delivery still proceeds. */
  Report = 'REPORT',
}
