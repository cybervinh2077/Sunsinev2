# Discord Task Bot with Google Sheets Integration

## Features
- Periodically DMs users their assigned tasks from Google Sheet 1
- Posts a summary of all active tasks in a public channel
- Monitors Google Sheet 2 for task completions, announces in public channel, and tracks completions per user
- (Optional) Assigns roles or points based on completions

## Setup Instructions

### 1. Clone & Install
```
git clone <your-repo-url>
cd <project-folder>
npm install
```

### 2. Google Sheets API Setup
- Go to [Google Cloud Console](https://console.cloud.google.com/)
- Create a project, enable Google Sheets API
- Create a Service Account, generate a JSON key
- Share both Google Sheets with the service account email
- Note your Sheet IDs (from the URL)

### 3. Environment Variables
Set these in a `.env` file (or in Replit Secrets):
```
DISCORD_TOKEN=your_discord_bot_token
DISCORD_PUBLIC_CHANNEL_ID=your_public_channel_id
GOOGLE_SHEET_1_ID=your_sheet_1_id
GOOGLE_SHEET_2_ID=your_sheet_2_id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account_email
GOOGLE_PRIVATE_KEY="your_private_key"
```
- For `GOOGLE_PRIVATE_KEY`, copy from the JSON key, replace all newlines with `\n` if using `.env`.

### 4. Google Sheets Format
- **Sheet 1:**
  - Columns: Task Name | Deadline | Discord Username (ID or tag)
- **Sheet 2:**
  - Columns: Discord Username (ID or tag) | Completed Count

### 5. Deploy on Replit
- Import the repo to Replit
- Add environment variables in the Secrets tab
- Click "Run"

## Customization
- To assign roles or points, add logic in `index.js` where marked.
- To change the summary format, edit `taskManager.js`.

## Notes
- The bot must have permission to DM users and post in the public channel.
- For Discord Username, using user ID is most reliable.

---

**Questions?** Open an issue or contact the maintainer. 