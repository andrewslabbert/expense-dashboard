
// --- Global Settings ---
const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId(); // Assumes script is bound to the sheet
const SHEET_NAME = "statement_1"; // The name of your sheet with transactions
const HEADER_ROWS = 1; // Number of header rows in your sheet
const TOP_N_CATEGORIES = 9; // Number of top categories to show individually before grouping into "Other"
const TRANSFER_CATEGORY_NAME = "Transfer"; // Exact name used in your sheet for transfers (case-sensitive)
const CYCLE_START_DAY = 22; // Day of the month the cycle starts (e.g., 22 means cycle is 22nd to 21st)

// --- Column Indices (0-based) - DOUBLE-CHECK THESE MATCH YOUR SHEET ---
// Consider implementing dynamic column finding based on headers for robustness
const COL_TRANS_DATE = 3;       // Column D: "Transaction Date"
const COL_DESCRIPTION = 4;      // Column E: "Description"
const COL_CATEGORY = 7;         // Column H: "Category"
const COL_MONEY_OUT = 9;        // Column J: "Money Out"
// const COL_MONEY_IN = 8;      // Column I: "Money In" (If needed later)
