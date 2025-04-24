
/**
 * Web App Entry Point: Serves the main dashboard HTML page.
 * @param {Object} e - The event parameter for a GET request.
 * @returns {HtmlOutput} The HTML page to be served.
 */
// In Code.gs or Server.gs
function doGet(e) {
  try {
    // Use createTemplateFromFile because Dashboard.html now contains <?!= ... ?> scriptlets
    const template = HtmlService.createTemplateFromFile('Dashboard');
    const htmlOutput = template.evaluate(); // evaluate() processes the scriptlets

    htmlOutput.setTitle('Expense Dashboard')
              .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
              .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');

    return htmlOutput;

  } catch (error) {
    Logger.log("FATAL ERROR in doGet: " + error.message + "\n" + error.stack);
    return ContentService.createTextOutput("Server Error in doGet: " + error.message + ". Please check the Apps Script logs.");
  }
}
