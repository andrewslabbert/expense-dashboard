/**
 * Reads transaction data from the sheet, processes it into a cycle-based
 * summary structure suitable for the dashboard frontend.
 * Cycles start on CYCLE_START_DAY.
 * Excludes "Transfer" category from spending totals and Top N calculation.
 * Groups categories beyond Top N into "Other".
 *
 * @returns {Object} An object where keys are cycle key strings
 *                   (e.g., "2024-04-22_to_2024-05-21") and values contain
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
    if (dataRange.getNumRows() <= HEADER_ROWS) {
      Logger.log("No data found below header row(s).");
      return {}; // Return empty object if only headers exist
    }

    // Get data values, excluding header row(s)
    const values = dataRange.offset(HEADER_ROWS, 0, dataRange.getNumRows() - HEADER_ROWS).getValues();
    const displayValues = dataRange.offset(HEADER_ROWS, 0, dataRange.getNumRows() - HEADER_ROWS).getDisplayValues();

    const processedData = {};
    // const monthNames = [...] // No longer needed for keys

    values.forEach((row, index) => {
      const category = row[COL_CATEGORY] ? String(row[COL_CATEGORY]).trim() : "Uncategorized";
      let amount = row[COL_MONEY_OUT];
      const description = row[COL_DESCRIPTION] ? String(row[COL_DESCRIPTION]).trim() : "N/A";
      const transactionDateStr = displayValues[index][COL_TRANS_DATE];

      // --- Data Cleaning & Validation ---
      if (!category) {
         return; // Skip row if category is blank
      }

      amount = parseFloat(amount);
      if (isNaN(amount) || amount === 0) {
         return; // Skip row if invalid or zero amount
      }
      amount = Math.abs(amount);

      let transactionDate;
      try {
        // Use regex to find the likely date part first
        const dateMatch = transactionDateStr.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!dateMatch) throw new Error(`Could not extract date part from "${transactionDateStr}"`);
        const datePart = dateMatch[1]; // e.g., "2024-05-15"

        // Construct date object treating the extracted part as UTC midnight
        transactionDate = new Date(datePart + 'T00:00:00Z');

        if (isNaN(transactionDate.getTime())) {
             throw new Error(`Invalid date constructed from "${datePart}" (original: "${transactionDateStr}")`);
        }
      } catch (e) {
        Logger.log(`Skipping row ${index + HEADER_ROWS + 1}: Could not parse date. Error: ${e.message}. Original value: "${transactionDateStr}"`);
        return; // Skip row if date is invalid
      }

      // --- Determine Cycle Key ---
      const cycleKey = getCycleKey(transactionDate);
      if (!cycleKey) {
          Logger.log(`Skipping row ${index + HEADER_ROWS + 1}: Cannot determine cycle key for date: ${transactionDateStr}`);
          return; // Skip if we couldn't determine the cycle
      }

      // Keep the YYYY-MM-DD format for individual transaction dates within details
      const formattedDate = `${transactionDate.getUTCFullYear()}-${String(transactionDate.getUTCMonth() + 1).padStart(2, '0')}-${String(transactionDate.getUTCDate()).padStart(2, '0')}`;

      // --- Aggregation by Cycle Key ---
      if (!processedData[cycleKey]) {
          processedData[cycleKey] = {
              total: 0,
              categoriesMap: {},
              detailsMap: {}
          };
      }

      // --- Store Transaction Details (Use cycleKey) ---
      if (!processedData[cycleKey].detailsMap[category]) {
          processedData[cycleKey].detailsMap[category] = [];
      }
      processedData[cycleKey].detailsMap[category].push({
          date: formattedDate,
          description: description, // Use original description from row
          amount: amount
      });

      // --- Handle Expenses vs. Transfers (Use cycleKey) ---
      if (category !== TRANSFER_CATEGORY_NAME) {
          processedData[cycleKey].total += amount;
          if (!processedData[cycleKey].categoriesMap[category]) {
              processedData[cycleKey].categoriesMap[category] = 0;
          }
          processedData[cycleKey].categoriesMap[category] += amount;
      }
    }); // End forEach row loop

    // --- Final Formatting Step ---
    for (const cycleKey in processedData) {
      const cycleData = processedData[cycleKey]; // Use cycleKey and assign to cycleData

      const expenseCategoriesArray = Object.entries(cycleData.categoriesMap)
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount);

      const finalDisplayCategories = [];
      let otherTotal = 0;

      expenseCategoriesArray.forEach((category, index) => {
        if (index < TOP_N_CATEGORIES) {
          finalDisplayCategories.push(category);
        } else {
          otherTotal += category.amount;
        }
      });

      if (otherTotal > 0) {
        finalDisplayCategories.push({ name: "Other", amount: otherTotal });
      }
      cycleData.categories = finalDisplayCategories; // Assign final list to cycleData

      // Sort details within each category and assign final details map
      for (const categoryKey in cycleData.detailsMap) {
           cycleData.detailsMap[categoryKey].sort((a, b) => new Date(b.date) - new Date(a.date));
      }
      cycleData.details = cycleData.detailsMap; // Assign final details to cycleData

      delete cycleData.categoriesMap; // Cleanup temporary map from cycleData
    } // End Final Formatting Loop

        // Explicitly remove Transfer details before sending to client
    for (const cycleKey in processedData) {
        if (processedData[cycleKey] && processedData[cycleKey].details && processedData[cycleKey].details[TRANSFER_CATEGORY_NAME]) {
             // Logger.log(`Removing transfer details for cycle: ${cycleKey}`); // Optional: for debugging
             delete processedData[cycleKey].details[TRANSFER_CATEGORY_NAME];
        }
    }

    // Logger.log("Processed Data: " + JSON.stringify(processedData, null, 2));
    return processedData;

  } catch (error) {
    Logger.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    Logger.log(`Error in getDataForDashboard: ${error.message}`);
    Logger.log(`Stack: ${error.stack}`);
    Logger.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    return { error: `Failed to process spreadsheet data: ${error.message}` }; // Return error object
  }
} // *** End of getDataForDashboard function ***


/**
 * Calculates the cycle key string (YYYY-MM-DD_to_YYYY-MM-DD) for a given date.
 * Cycles run from CYCLE_START_DAY of month A to (CYCLE_START_DAY - 1) of month B.
 *
 * @param {Date} date The transaction date object (should be UTC).
 * @returns {string} The cycle key string, e.g., "2024-04-22_to_2024-05-21".
 *                   Returns empty string if date is invalid.
 */
function getCycleKey(date) {
  if (!date || isNaN(date.getTime())) {
    Logger.log("getCycleKey received invalid date.");
    return "";
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed (0=Jan, 11=Dec)
  const day = date.getUTCDate();

  let cycleStartDate, cycleEndDate;

  if (day >= CYCLE_START_DAY) {
    // Cycle starts in the current month
    cycleStartDate = new Date(Date.UTC(year, month, CYCLE_START_DAY));
    // Cycle ends in the next month (Date.UTC handles month rollover)
    cycleEndDate = new Date(Date.UTC(year, month + 1, CYCLE_START_DAY - 1));
  } else {
    // Cycle started in the previous month (Date.UTC handles month rollover)
    cycleStartDate = new Date(Date.UTC(year, month - 1, CYCLE_START_DAY));
    // Cycle ends in the current month
    cycleEndDate = new Date(Date.UTC(year, month, CYCLE_START_DAY - 1));
  }

  // Helper to format date part as YYYY-MM-DD
  const formatDatePart = (d) => {
      // Check if the date object is valid before formatting
      if (!d || isNaN(d.getTime())) {
          Logger.log("formatDatePart received invalid date object.");
          return "YYYY-MM-DD"; // Return placeholder or throw error
      }
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dy = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${dy}`;
  };

  return `${formatDatePart(cycleStartDate)}_to_${formatDatePart(cycleEndDate)}`;
}]