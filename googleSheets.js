"use strict";
const { google } = require("googleapis");
const logger = require('./logger');
require("dotenv").config();

// Validate required environment variables
const requiredEnvVars = [
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_SHEET_1_ID',
  'GOOGLE_SHEET_2_ID',
  'GOOGLE_SHEET_3_ID'
];

// Check for missing environment variables
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  logger.error('Missing required environment variables:', missingEnvVars);
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Initialize Google Auth
let auth;
try {
  auth = new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  logger.info('Google Auth initialized successfully');
} catch (error) {
  logger.error('Failed to initialize Google Auth:', error);
  throw error;
}

const sheets = google.sheets({ version: "v4", auth });

async function readSheet(spreadsheetId, range) {
  try {
    logger.info('Starting readSheet:', { spreadsheetId, range });
    
    if (!spreadsheetId) {
      logger.error('Missing spreadsheetId');
      throw new Error('Missing spreadsheetId');
    }

    if (!auth) {
      logger.error('Google Auth not initialized');
      throw new Error('Google Auth not initialized');
    }

    logger.info('Making API request to Google Sheets');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    
    logger.info('Received response from Google Sheets');
    const values = response.data.values || [];
    
    if (values.length === 0) {
      logger.warn('No data found in sheet:', { spreadsheetId, range });
      return [];
    }
    
    logger.info('Sheet data read:', { 
      spreadsheetId, 
      range,
      rowCount: values.length,
      firstRow: values[0],
      lastRow: values[values.length - 1]
    });
    
    return values;
  } catch (error) {
    logger.error('Error reading sheet:', { 
      spreadsheetId, 
      range, 
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function appendSheet(sheetId, range, values) {
  try {
    logger.debug('Appending to sheet:', { sheetId, range, values });
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range,
      valueInputOption: "USER_ENTERED",
      resource: { values },
    });
    logger.info('Successfully appended to sheet:', { sheetId, rowCount: values.length });
  } catch (error) {
    logger.error('Error appending to sheet:', { sheetId, range, error });
    throw error;
  }
}

async function updateSheet(spreadsheetId, range, values) {
  try {
    logger.debug('Updating sheet:', { spreadsheetId, range, values });
    
    // First, read existing data
    const existingData = await readSheet(spreadsheetId, range);
    
    // If updating Sheet 2 (completions)
    if (spreadsheetId === process.env.GOOGLE_SHEET_2_ID) {
      // Find if user already exists
      const userIndex = existingData.findIndex(row => row[0] === values[0][0]);
      
      if (userIndex !== -1) {
        // Update existing user's completion count
        existingData[userIndex][1] = values[0][1];
        logger.info('Updating existing user completion:', { 
          username: values[0][0], 
          newCount: values[0][1] 
        });
        
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: 'RAW',
          resource: { values: existingData },
        });
      } else {
        // Append new user
        logger.info('Adding new user completion:', { 
          username: values[0][0], 
          count: values[0][1] 
        });
        
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: 'RAW',
          resource: { values },
        });
      }
    } else {
      // For Sheet 1, clear the range first
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range,
      });
      
      // Then update with new values if there are any
      if (values && values.length > 0) {
        logger.info('Updating Sheet 1:', { rowCount: values.length });
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: 'RAW',
          resource: { values },
        });
      }
    }
    
    logger.info('Successfully updated sheet:', { spreadsheetId, range });
  } catch (error) {
    logger.error('Error updating sheet:', { spreadsheetId, range, error });
    throw error;
  }
}

module.exports = { readSheet, appendSheet, updateSheet }; 