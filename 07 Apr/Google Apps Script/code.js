/**
 * Backend script (Code.gs) for the Expenses Dashboard Web App.
 * Handles serving the HTML interface and fetching/processing data
 * from the Google Sheet.
 */

// --- Global Settings ---
const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId(); // Assumes script is bound to the sheet
const SHEET_NAME = "statement_1"; // The name of your sheet with transactions
const HEADER_ROWS = 1; // Number of header rows in your sheet
const TOP_N_CATEGORIES = 9; // Number of top categories to show individually before grouping into "Other"
const TRANSFER_CATEGORY_NAME = "Transfer"; // Exact name used in your sheet for transfers (case-sensitive)

// --- Column Indices (0-based) - DOUBLE-CHECK THESE MATCH YOUR SHEET ---
const COL_TRANS_DATE = 3;       // Column D: "Transaction Date"
const COL_DESCRIPTION = 4;      // Column E: "Description"
const COL_CATEGORY = 7;         // Column H: "Category"
const COL_MONEY_OUT = 9;        // Column J: "Money Out"
// const COL_MONEY_IN = 8;      // Column I: "Money In" (If needed later)

// --- Web App Entry Point ---
function doGet(e) {
  try {
    // Logger.log("doGet started."); // Optional: Keep for debugging initial load

    const template = HtmlService.createTemplateFromFile('index');
    if (!template) {
        Logger.log("ERROR: HtmlService.createTemplateFromFile('index') returned null or undefined.");
        return ContentService.createTextOutput("Error: Could not create HTML template. Check file name 'index.html'.");
    }

    const htmlOutput = template.evaluate();

    if (!htmlOutput || typeof htmlOutput.append !== 'function') {
         Logger.log("ERROR: template.evaluate() did not return a valid HtmlOutput object. Type was: " + typeof htmlOutput);
         return ContentService.createTextOutput("Error: Template evaluation failed. Check server logs and index.html syntax.");
    }

    htmlOutput.setTitle('Ministric Dashboard - Expenses')
              .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) // Necessary for embedding or certain scenarios
              .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');

    // Logger.log("Returning HtmlOutput."); // Optional: Keep for debugging initial load
    return htmlOutput;

  } catch (error) {
    // Log detailed error for server-side debugging
    Logger.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    Logger.log("FATAL ERROR in doGet: " + error.message);
    Logger.log("Stack Trace: " + error.stack);
    Logger.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    // Provide a generic error to the client
    return ContentService.createTextOutput("Server Error in doGet: " + error.message + ". Please check the Apps Script logs.");
  }
}

/**
 * Allows including content from other HTML files (like CSS or JS)
 * if you choose to separate them later.
 * Not currently used if all CSS/JS is within index.html.
 * Usage in HTML: <?!= include('Stylesheet'); ?>
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}


// --- Data Fetching and Processing Function ---
/**
 * Reads transaction data from the sheet, processes it into a monthly
 * summary structure suitable for the dashboard frontend.
 * Excludes "Transfer" category from spending totals and Top N calculation.
 * Groups categories beyond Top N into "Other".
 *
 * @returns {Object} An object where keys are "Month Year" strings
 *                   (e.g., "April 2024") and values contain
 *                   { total: number (excluding transfers),
 *                     categories: Array (Top N + Other),
 *                     details: Object (all transactions by original category) }.
 *                   Returns { error: string } if processing fails.
 */
function getDataForDashboard() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      throw new Error(`Sheet "${SHEET_NAME}" not found.`);
    }

    const dataRange = sheet.getDataRange();
    // Check if there's data beyond the header
    if (dataRange.getNumRows() <= HEADER_ROWS) {
      Logger.log("No data found below header row(s).");
      return {}; // Return empty object if only headers exist
    }

    // Get data values, excluding header row(s)
    const values = dataRange.offset(HEADER_ROWS, 0, dataRange.getNumRows() - HEADER_ROWS).getValues();
    // Get display values (especially for dates) to handle formatting inconsistencies
    const displayValues = dataRange.offset(HEADER_ROWS, 0, dataRange.getNumRows() - HEADER_ROWS).getDisplayValues();

    const processedData = {}; // Main object to hold processed data by month
    const monthNames = ["January", "February", "March", "April", "May", "June",
                        "July", "August", "September", "October", "November", "December"];

    // --- Iterate through each row of transaction data ---
    values.forEach((row, index) => {
      // Extract data using defined column indices
      const category = row[COL_CATEGORY] ? String(row[COL_CATEGORY]).trim() : "Uncategorized";
      let amount = row[COL_MONEY_OUT]; // Get value from "Money Out" column
      const description = row[COL_DESCRIPTION] ? String(row[COL_DESCRIPTION]).trim() : "N/A";
      // Use display value for date to get it as seen in the sheet
      const transactionDateStr = displayValues[index][COL_TRANS_DATE];

      // --- Data Cleaning & Validation ---
      // Skip row if category is missing
      if (!category) {
         // Logger.log(`Skipping row ${index + HEADER_ROWS + 1}: Blank Category`);
         return; // 'continue' equivalent for forEach
      }

      // Parse amount from "Money Out" - skip if not a valid number or zero
      amount = parseFloat(amount);
      if (isNaN(amount) || amount === 0) {
         // Logger.log(`Skipping row ${index + HEADER_ROWS + 1}: Invalid or zero amount in Money Out ('${row[COL_MONEY_OUT]}')`);
         return; // Skip row
      }
      // Ensure amount is positive for consistent calculations
      amount = Math.abs(amount);

      // Parse the transaction date string
      let transactionDate;
      try {
        // Use regex to handle potential time component if present, extract YYYY-MM-DD
        const dateMatch = transactionDateStr.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) throw new Error("Could not extract date part");
        // Parse just the date part to avoid timezone issues with Date object constructor
        transactionDate = new Date(dateMatch[1] + 'T00:00:00Z'); // Treat as UTC midnight

        if (isNaN(transactionDate.getTime())) { // Check if date parsing failed
             throw new Error("Invalid date format parsed");
        }
      } catch (e) {
        Logger.log(`Skipping row ${index + HEADER_ROWS + 1}: Could not parse date "${transactionDateStr}". Error: ${e.message}`);
        return; // Skip row if date is invalid
      }

      // --- Aggregation by Month ---
      const year = transactionDate.getUTCFullYear(); // Use UTC methods
      const month = transactionDate.getUTCMonth(); // 0-indexed (0 = January)
      const day = transactionDate.getUTCDate();
      const monthKey = `${monthNames[month]} ${year}`; // e.g., "April 2024"
      const formattedDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; // YYYY-MM-DD

      // Initialize month structure if it doesn't exist
      if (!processedData[monthKey]) {
        processedData[monthKey] = {
          total: 0,           // Total spending (will exclude transfers)
          categoriesMap: {},  // Temporary map for *expense* category amounts
          detailsMap: {}      // Holds *all* transaction details by original category
        };
      }

      // --- Store Transaction Details for *all* categories ---
      if (!processedData[monthKey].detailsMap[category]) {
        processedData[monthKey].detailsMap[category] = [];
      }
      processedData[monthKey].detailsMap[category].push({
        date: formattedDate, // Use YYYY-MM-DD format
        description: description,
        amount: amount
      });

      // --- Handle Expenses vs. Transfers ---
      if (category === TRANSFER_CATEGORY_NAME) {
        // It's a transfer: Details are stored, but amount is ignored for expense totals/ranking.
        // Logger.log(`Transfer detected in ${monthKey}: ${description} - ${amount}`);
      } else {
        // It's an expense: Add amount to the monthly expense total and the expense categories map.
        processedData[monthKey].total += amount;

        if (!processedData[monthKey].categoriesMap[category]) {
          processedData[monthKey].categoriesMap[category] = 0;
        }
        processedData[monthKey].categoriesMap[category] += amount;
      }
    }); // End forEach row loop

    // --- Final Formatting Step (Top N + Other aggregation, Sort Details) ---
    for (const monthKey in processedData) {
      const monthData = processedData[monthKey];

      // 1. Process *Expense* Categories for Top N + "Other" display list
      const expenseCategoriesArray = Object.entries(monthData.categoriesMap)
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount); // Sort expense categories by amount descending

      const finalDisplayCategories = [];
      let otherTotal = 0;

      expenseCategoriesArray.forEach((category, index) => {
        if (index < TOP_N_CATEGORIES) {
          finalDisplayCategories.push(category); // Keep Top N expense categories
        } else {
          otherTotal += category.amount; // Sum the rest into "Other"
        }
      });

      // Add the "Other" category if it has a value
      if (otherTotal > 0) {
        finalDisplayCategories.push({ name: "Other", amount: otherTotal });
      }

      // Assign the final list of categories to be displayed on the frontend
      monthData.categories = finalDisplayCategories;

      // 2. Assign the full details map (includes Transfers and all original categories)
      //    Also sort transactions within each category's details list by date descending
      for (const categoryKey in monthData.detailsMap) {
           monthData.detailsMap[categoryKey].sort((a, b) => new Date(b.date) - new Date(a.date));
      }
      monthData.details = monthData.detailsMap; // Assign the sorted details map

      // Cleanup temporary map used for expense aggregation
      delete monthData.categoriesMap;
    } // End final formatting loop

    // Logger.log("Processed Data (Final Structure): " + JSON.stringify(processedData, null, 2)); // Optional: Log final structure for debugging
    return processedData;

  } catch (error) {
    Logger.log(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
    Logger.log(`Error in getDataForDashboard: ${error.message}`);
    Logger.log(`Stack: ${error.stack}`);
    Logger.log(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
    // Return an error object to the frontend for handling
    return { error: `Failed to process spreadsheet data: ${error.message}` };
  }
}