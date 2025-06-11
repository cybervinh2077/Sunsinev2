const { readSheet, updateSheet, appendSheet } = require('./googleSheets');
const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('./logger');
const os = require('os');
require('dotenv').config();

const SHEET1_ID = process.env.GOOGLE_SHEET_1_ID;
const SHEET2_ID = process.env.GOOGLE_SHEET_2_ID;
const TASKS_RANGE = 'A2:C'; // Task Name | Deadline | Discord Username
const COMPLETIONS_RANGE = 'A2:C'; // Discord Username | Completed Count | Overdue Count

// Memory optimization functions
const MEMORY_THRESHOLD = parseInt(process.env.MEMORY_THRESHOLD) || 80; // 80% memory usage threshold
const MEMORY_WARNING_THRESHOLD = parseInt(process.env.MEMORY_WARNING_THRESHOLD) || 70;
const CACHE_CLEANUP_INTERVAL = parseInt(process.env.CACHE_CLEANUP_INTERVAL) || 30 * 60 * 1000; // 30 minutes
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 5 * 60 * 1000; // 5 minutes
let memoryCache = new Map();
let lastCleanup = Date.now();

function optimizeMemory() {
  const { memoryUsage } = getSystemResources();
  const usagePercent = parseFloat(memoryUsage);
  
  // Log warning if memory usage is high
  if (usagePercent > MEMORY_WARNING_THRESHOLD) {
    logger.warn('High memory usage detected:', {
      usagePercent,
      threshold: MEMORY_WARNING_THRESHOLD,
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal
    });
  }
  
  // Force garbage collection if memory usage is very high
  if (usagePercent > MEMORY_THRESHOLD) {
    if (global.gc) {
      global.gc();
      logger.info('Forced garbage collection due to high memory usage');
    }
    
    // Clear memory cache
    memoryCache.clear();
    lastCleanup = Date.now();
    logger.info('Cleared memory cache due to high memory usage');
  }
}

// Cache management
function setCache(key, value, ttl = CACHE_TTL) {
  memoryCache.set(key, {
    value,
    expiry: Date.now() + ttl
  });
}

function getCache(key) {
  const item = memoryCache.get(key);
  if (!item) return null;
  
  if (Date.now() > item.expiry) {
    memoryCache.delete(key);
    return null;
  }
  
  return item.value;
}

// Periodic cache cleanup
function startCacheCleanup() {
  setInterval(() => {
    const now = Date.now();
    if (now - lastCleanup >= CACHE_CLEANUP_INTERVAL) {
      for (const [key, item] of memoryCache.entries()) {
        if (now > item.expiry) {
          memoryCache.delete(key);
        }
      }
      lastCleanup = now;
      logger.info('Performed periodic cache cleanup');
    }
  }, 60 * 1000); // Check every minute
}

// Optimize task fetching with caching
async function fetchTasks() {
  const cacheKey = 'tasks';
  const cachedTasks = getCache(cacheKey);
  
  if (cachedTasks) {
    return cachedTasks;
  }
  
  try {
    const rows = await readSheet(SHEET1_ID, TASKS_RANGE);
    logger.debug('Fetched tasks from sheet:', rows);
    const tasks = rows.map(([task, deadline, username]) => ({ task, deadline, username }));
    setCache(cacheKey, tasks);
    return tasks;
  } catch (error) {
    logger.error('Error fetching tasks:', error);
    return [];
  }
}

// Optimize completions fetching with caching
async function fetchCompletions() {
  const cacheKey = 'completions';
  const cachedCompletions = getCache(cacheKey);
  
  if (cachedCompletions) {
    return cachedCompletions;
  }
  
  try {
    const rows = await readSheet(SHEET2_ID, COMPLETIONS_RANGE);
    const completions = {};
    rows.forEach(([username, count, overdue]) => {
      completions[username] = {
        count: parseInt(count) || 0,
        overdue: parseInt(overdue) || 0
      };
    });
    setCache(cacheKey, completions);
    return completions;
  } catch (error) {
    logger.error('Error fetching completions:', error);
    return {};
  }
}

async function initializeOverdueColumn() {
  try {
    const rows = await readSheet(SHEET2_ID, COMPLETIONS_RANGE);
    if (!rows || !Array.isArray(rows)) {
      logger.warn('No completion data found or invalid format');
      return;
    }

    // Remove any duplicate entries by username
    const uniqueRows = rows.reduce((acc, row) => {
      const [username] = row;
      if (username && !acc.some(r => r[0] === username)) {
        acc.push(row);
      }
      return acc;
    }, []);

    // Ensure all rows have 3 columns with proper values
    const updatedRows = uniqueRows.map(row => {
      const [username, count, overdue] = row;
      return [
        username || '',
        count ? count.toString() : '0',
        overdue ? overdue.toString() : '0'
      ];
    });

    // Update sheet with formatted rows
    await updateSheet(SHEET2_ID, COMPLETIONS_RANGE, updatedRows);
    logger.info('Initialized overdue count column');
  } catch (error) {
    logger.error('Error initializing overdue column:', error);
  }
}

async function deleteTask(taskName, username) {
  try {
    // Get all current tasks
    const rows = await readSheet(SHEET1_ID, TASKS_RANGE);
    logger.debug('Current tasks before deletion:', rows);

    // Filter out the task to delete
    const updatedRows = rows.filter(([task, deadline, user]) => {
      const shouldKeep = !(task === taskName && user === username);
      logger.debug('Task comparison:', { task, user, taskName, username, shouldKeep });
      return shouldKeep;
    });
    logger.debug('Updated rows after deletion:', updatedRows);

    // Clear the current data
    await updateSheet(SHEET1_ID, TASKS_RANGE, []);
    
    // Add the updated data back
    if (updatedRows.length > 0) {
      // Preserve the exact format of each row
      const formattedRows = updatedRows.map(row => {
        // Ensure we keep the exact same format for each column
        return [
          String(row[0] || ''), // Task name
          String(row[1] || ''), // Deadline
          String(row[2] || '')  // Username
        ];
      });

      // Update the sheet with the filtered rows
      await updateSheet(SHEET1_ID, TASKS_RANGE, formattedRows);
      
      // Verify the update
      const verifyRows = await readSheet(SHEET1_ID, TASKS_RANGE);
      logger.debug('Verification after deletion:', verifyRows);
      
      // Double check that the task was actually deleted
      const taskStillExists = verifyRows.some(([task, _, user]) => 
        task === taskName && user === username
      );
      
      if (taskStillExists) {
        logger.error('Task deletion verification failed:', { taskName, username });
        return false;
      }
    }

    return true;
  } catch (error) {
    logger.error('Error deleting task:', error);
    return false;
  }
}

// Utility functions for time calculations
function parseDeadline(deadlineStr) {
  try {
    return new Date(deadlineStr);
  } catch (error) {
    logger.error('Error parsing deadline:', error);
    return null;
  }
}

function isNewDeadline(deadline) {
  const now = new Date();
  const deadlineDate = parseDeadline(deadline);
  if (!deadlineDate) return false;
  
  // Consider it new if it's within the last 10 minutes
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
  return deadlineDate >= tenMinutesAgo;
}

function isTwelveHoursLeft(deadline) {
  const now = new Date();
  const deadlineDate = parseDeadline(deadline);
  if (!deadlineDate) return false;
  
  const twelveHoursFromNow = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const elevenHoursFromNow = new Date(now.getTime() + 11 * 60 * 60 * 1000);
  
  return deadlineDate >= elevenHoursFromNow && deadlineDate <= twelveHoursFromNow;
}

function isOverdue(deadline) {
  const now = new Date();
  const deadlineDate = parseDeadline(deadline);
  if (!deadlineDate) return false;
  return now > deadlineDate;
}

// Sửa lại updateOverdueCount để chỉ ghi primitive value vào sheet
async function updateOverdueCount(username) {
  try {
    // Get all current rows
    const rows = await readSheet(SHEET2_ID, COMPLETIONS_RANGE);
    if (!rows || !Array.isArray(rows)) {
      logger.warn('No completion data found or invalid format');
      return null;
    }

    // Remove any duplicate entries by username
    const uniqueRows = rows.reduce((acc, row) => {
      const [rowUsername] = row;
      if (rowUsername && !acc.some(r => r[0] === rowUsername)) {
        acc.push(row);
      }
      return acc;
    }, []);

    // Find if user exists
    const userIndex = uniqueRows.findIndex(row => row[0] === username);
    let updatedRows;

    if (userIndex !== -1) {
      // Update existing user
      let [_, count, overdue] = uniqueRows[userIndex];
      // Nếu count là object, lấy giá trị completed
      if (typeof count === 'object' && count !== null) {
        count = count.completed || 0;
      }
      const newOverdueCount = (parseInt(overdue, 10) || 0) + 1;
      uniqueRows[userIndex] = [
        username,
        count ? count.toString() : '0',
        newOverdueCount.toString()
      ];
      updatedRows = uniqueRows;
    } else {
      // Add new user with 0 completed and 1 overdue
      updatedRows = [...uniqueRows, [username, '0', '1']];
    }

    // Update Sheet 2 with all rows
    await updateSheet(SHEET2_ID, COMPLETIONS_RANGE, updatedRows);
    logger.info('Updated overdue count:', { username, updatedRows });
    return userIndex !== -1 ? parseInt(updatedRows[userIndex][2], 10) : 1;
  } catch (error) {
    logger.error('Error updating overdue count:', error);
    return null;
  }
}

async function checkOverdueTasks(client) {
  const tasks = await fetchTasks();
  logger.info('Checking for overdue tasks:', tasks);
  
  for (const { task, deadline, username } of tasks) {
    if (!task || !deadline || !username) {
      logger.warn('Skipping invalid task:', { task, deadline, username });
      continue;
    }

    if (isOverdue(deadline)) {
      const user = await findUserByUsername(client, username);
      if (user) {
        try {
          // Update overdue count
          const overdueCount = await updateOverdueCount(username);
          
          // Send DM about overdue task
          const message = `⚠️ **CẢNH BÁO: DEADLINE ĐÃ QUÁ HẠN!**\n\n` +
            `**${task}**\n` +
            `⏰ Hạn chót: ${deadline}\n\n` +
            `Bro ơi, deadline đã quá hạn rồi! Nhanh tay hoàn thành đi nhé! 🏃‍♂️💨\n` +
            `Số lần quá hạn của mày: **${overdueCount}** lần\n\n` +
            `Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`;
          
          await user.send(message);
          logger.info('Sent overdue notification:', { username, task, overdueCount });
        } catch (e) {
          logger.error(`Failed to handle overdue task for ${username}:`, e);
        }
      } else {
        logger.warn('User not found for overdue task:', username);
      }
    }
  }
}

async function sendTaskDMs(client) {
  const tasks = await fetchTasks();
  logger.info('Sending task DMs for tasks:', tasks);
  
  for (const { task, deadline, username } of tasks) {
    // Skip if any required field is missing or empty
    if (!task || !deadline || !username) {
      logger.warn('Skipping invalid task:', { task, deadline, username });
      continue;
    }

    // Only send DM if it's a new deadline or 12 hours left
    if (!isNewDeadline(deadline) && !isTwelveHoursLeft(deadline)) {
      continue;
    }

    const user = await findUserByUsername(client, username);
    if (user) {
      try {
        let message = '';
        if (isNewDeadline(deadline)) {
          message = `🎯 **Nhiệm Vụ Mới Nè Bro!**\n\n**${task}**\n⏰ Hạn chót: ${deadline}\n\nNhanh tay hoàn thành đi nhé! 💪✨`;
        } else {
          message = `⚠️ **CẢNH BÁO: CÒN 12 TIẾNG NỮA THÔI!**\n\n**${task}**\n⏰ Hạn chót: ${deadline}\n\nNhanh lên kẻo trễ deadline đó bro! 🏃‍♂️💨`;
        }
        message += '\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`';
        
        await user.send(message);
        logger.info('Successfully sent DM to user:', { username, task, isNew: isNewDeadline(deadline) });
      } catch (e) {
        logger.error(`Failed to DM ${username}:`, e);
      }
    } else {
      logger.warn('User not found:', username);
    }
  }
}

async function postTaskSummary(client) {
  try {
    const channel = await client.channels.fetch(process.env.DISCORD_PUBLIC_CHANNEL_ID);
    const tasks = await fetchTasks();
    if (!tasks.length) {
      logger.info('No tasks to summarize');
      return;
    }
    
    let summary = '**Danh Sách Công Việc Đang Hoạt Động:**\n';
    for (const { task, deadline, username } of tasks) {
      summary += `• **${task}** (bởi <@${username}>) - Hạn chót: ${deadline}\n`;
    }
    
    await channel.send(summary);
    logger.info('Posted task summary to channel');
  } catch (error) {
    logger.error('Error posting task summary:', error);
  }
}

async function announceCompletion(client, username, count) {
  try {
    const channel = await client.channels.fetch(process.env.DISCORD_PUBLIC_CHANNEL_ID);
    await channel.send(`🎉 <@${username}> đã hoàn thành một công việc! Tổng số công việc đã hoàn thành: **${count}**`);
    logger.info('Announced completion:', { username, count });
  } catch (error) {
    logger.error('Error announcing completion:', error);
  }
}

async function findUserByUsername(client, username) {
  let user = null;
  try {
    if (/^\d+$/.test(username)) {
      user = await client.users.fetch(username).catch(() => null);
    } else {
      user = client.users.cache.find(u => u.tag === username);
    }
    if (!user) {
      logger.warn('User not found:', username);
    }
    return user;
  } catch (error) {
    logger.error('Error finding user:', error);
    return null;
  }
}

// Enhanced system resources monitoring
function getSystemResources() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryUsage = (usedMemory / totalMemory * 100).toFixed(2);
  
  const cpuUsage = os.loadavg()[0].toFixed(2);
  const uptime = Math.floor(os.uptime());
  
  // Check memory usage and trigger optimization if needed
  if (parseFloat(memoryUsage) > MEMORY_THRESHOLD) {
    optimizeMemory();
  }
  
  return {
    memoryUsage: `${memoryUsage}%`,
    cpuUsage: `${cpuUsage}%`,
    uptime: formatUptime(uptime),
    heapUsed: process.memoryUsage().heapUsed,
    heapTotal: process.memoryUsage().heapTotal
  };
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days} ngày`);
  if (hours > 0) parts.push(`${hours} giờ`);
  if (minutes > 0) parts.push(`${minutes} phút`);
  
  return parts.join(' ');
}

// Ghi thông tin deadline hoàn thành vào Sheet 3
async function logCompletionToSheet3(taskName, username, completedDate) {
  try {
    const sheetId = process.env.GOOGLE_SHEET_3_ID;
    console.log('[DEBUG] logCompletionToSheet3 input:', { taskName, username, completedDate, sheetId });
    if (!sheetId) {
      console.error('[DEBUG] GOOGLE_SHEET_3_ID is missing!');
      throw new Error('GOOGLE_SHEET_3_ID is missing!');
    }
    if (!taskName || !username || !completedDate) {
      console.error('[DEBUG] Dữ liệu truyền vào không hợp lệ:', { taskName, username, completedDate });
      throw new Error('Dữ liệu truyền vào không hợp lệ');
    }
    const values = [[taskName, username, completedDate]];
    console.log('[DEBUG] appendSheet values:', values);
    try {
      const result = await appendSheet(
        sheetId,
        'A:C',
        values
      );
      console.log('[DEBUG] appendSheet result:', result);
      console.log('[DEBUG] Successfully logged completion to Sheet 3:', { taskName, username, completedDate });
    } catch (appendError) {
      console.error('[DEBUG] Error in appendSheet:', appendError);
      throw appendError;
    }
  } catch (error) {
    console.error('[DEBUG] Error logging completion to Sheet 3:', error);
    throw error;
  }
}

// Chuyển tất cả các dòng từ Sheet 1 sang Sheet 3 với ngày hoàn thành là ngày hiện tại
async function migrateSheet1ToSheet3() {
  try {
    const rows = await readSheet(process.env.GOOGLE_SHEET_1_ID, 'A2:C');
    if (!rows || rows.length === 0) {
      logger.info('[MIGRATE] Không có dữ liệu trong Sheet 1 để chuyển.');
      return;
    }
    const d = new Date();
    const completedDate = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
    const dataToInsert = rows.map(([task, member]) => [task, member, completedDate]);
    await appendSheet(process.env.GOOGLE_SHEET_3_ID, 'A2:C', dataToInsert);
    logger.info(`[MIGRATE] Đã chuyển ${dataToInsert.length} dòng từ Sheet 1 sang Sheet 3.`);
  } catch (error) {
    logger.error('[MIGRATE] Lỗi khi chuyển dữ liệu từ Sheet 1 sang Sheet 3:', error);
  }
}

// Initialize memory optimization
startCacheCleanup();

module.exports = {
  fetchTasks,
  fetchCompletions,
  sendTaskDMs,
  postTaskSummary,
  announceCompletion,
  deleteTask,
  getSystemResources,
  checkOverdueTasks,
  initializeOverdueColumn,
  logCompletionToSheet3,
  migrateSheet1ToSheet3,
  optimizeMemory,
  // Export memory optimization variables
  MEMORY_THRESHOLD,
  MEMORY_WARNING_THRESHOLD,
  CACHE_CLEANUP_INTERVAL,
  CACHE_TTL,
  memoryCache,
  lastCleanup
}; 