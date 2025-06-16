const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const cron = require('node-cron');
require('dotenv').config();
const logger = require('./logger');
const {
    sendTaskDMs,
    postTaskSummary,
    fetchCompletions,
    announceCompletion,
    fetchTasks,
    deleteTask,
    getSystemResources,
    checkOverdueTasks,
    initializeOverdueColumn,
    logCompletionToSheet3,
    addTask
} = require('./taskManager');

console.log('[DEBUG] logCompletionToSheet3 type at startup:', typeof logCompletionToSheet3);
const { readSheet, updateSheet } = require('./googleSheets');

// Tutorial content
const tutorialContent = {
    stats: {
        nbame: '📊 !stats',
        description: 'Xem số nhiệm vụ đã hoàn thành và quá hạn của bạn.',
        usage: 'Gõ `!stats` để xem số nhiệm vụ đã hoàn thành và quá hạn của bạn.'
    },
    ping: {
        name: '🏓 !ping',
        description: 'Kiểm tra độ trễ của bot.',
        usage: 'Gõ `!ping` để xem thời gian phản hồi của bot.'
    },
    tasks: {
        name: '📋 !tasks',
        description: 'Xem danh sách nhiệm vụ của bạn.',
        usage: 'Gõ `!tasks` để xem các nhiệm vụ đang chờ hoàn thành.'
    },
    complete: {
        name: '✅ !complete',
        description: 'Đánh dấu nhiệm vụ đầu tiên trong danh sách là đã hoàn thành.',
        usage: 'Gõ `!complete` để đánh dấu nhiệm vụ đầu tiên là đã hoàn thành.'
    },
    rank: {
        name: '🏆 !rank',
        description: 'Xem bảng xếp hạng thành viên dựa trên số nhiệm vụ hoàn thành và quá hạn.',
        usage: 'Gõ `!rank` để xem bảng xếp hạng. Điểm = (Hoàn thành × 5) - (Quá hạn × 6)'
    },
    about: {
        name: 'ℹ️ !about',
        description: 'Tìm hiểu thông tin về bot và người tạo.',
        usage: 'Gõ `!about` để xem thông tin về bot và người tạo.'
    },
    tutorial: {
        name: '📚 !tutorial',
        description: 'Xem hướng dẫn sử dụng các lệnh của bot.',
        usage: 'Gõ `!tutorial` để xem hướng dẫn sử dụng các lệnh.'
    },
    log: {
        name: '📝 !log',
        description: 'Xem thông tin log của bot (chỉ dành cho admin).',
        usage: 'Gõ `!log` để xem thông tin log gần đây của bot.'
    }
};

function getTutorialMessage() {
    logger.info('Generating tutorial message');
    let message = '📚 **Hướng Dẫn Sử Dụng Bot** 📚\n\n';

    // Add each command's information in a specific order
    const commandOrder = ['stats', 'ping', 'tasks', 'complete', 'rank', 'about', 'tutorial', 'log'];

    commandOrder.forEach(cmdKey => {
        const cmd = tutorialContent[cmdKey];
        logger.info(`Processing command: ${cmdKey}`, cmd);
        if (cmd) {
            message += `**${cmd.name}**\n`;
            message += `📝 ${cmd.description}\n`;
            message += `💡 ${cmd.usage}\n\n`;
        } else {
            logger.warn(`Command not found: ${cmdKey}`);
        }
    });

    message += '`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`';
    logger.info('Generated tutorial message:', message);
    return message;
}

// Log environment variables (without sensitive data)
logger.info('Environment check:', {
    hasToken: !!process.env.DISCORD_TOKEN,
    hasClientId: !!process.env.DISCORD_CLIENT_ID,
    hasSheet1Id: !!process.env.GOOGLE_SHEET_1_ID,
    hasSheet2Id: !!process.env.GOOGLE_SHEET_2_ID,
    hasChannelId: !!process.env.DISCORD_PUBLIC_CHANNEL_ID,
    hasServiceAccountEmail: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    hasPrivateKey: !!process.env.GOOGLE_PRIVATE_KEY,
    sheet1Id: process.env.GOOGLE_SHEET_1_ID,
    sheet2Id: process.env.GOOGLE_SHEET_2_ID
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [
        Partials.Channel,
        Partials.Message
    ],
});

let lastCompletions = {};
let botStartTime = Date.now();

client.once('ready', async() => {
    botStartTime = Date.now();
    logger.info(`Bot logged in as ${client.user.tag}`);
    logger.info(`Bot is in ${client.guilds.cache.size} guilds`);

    try {
        // Initialize overdue column
        await initializeOverdueColumn();

        // Initial fetch
        lastCompletions = await fetchCompletions();
        logger.info('Initial completions loaded:', lastCompletions);

        // Schedule tasks
        cron.schedule('*/10 * * * *', async() => {
            try {
                await sendTaskDMs(client);
                await postTaskSummary(client);
                await checkOverdueTasks(client);
                await initializeOverdueColumn();
            } catch (error) {
                logger.error('Error in scheduled task:', error);
            }
        });

        // Monitor completions every minute
        cron.schedule('* * * * *', async() => {
            try {
                const completions = await fetchCompletions();
                for (const username in completions) {
                    if (
                        (!lastCompletions[username] && completions[username].completed > 0) ||
                        (lastCompletions[username] && completions[username].completed > lastCompletions[username].completed)
                    ) {
                        await announceCompletion(client, username, completions[username].completed);
                    }
                }
                lastCompletions = completions;
            } catch (error) {
                logger.error('Error in completion monitor:', error);
            }
        });
    } catch (error) {
        logger.error('Error in ready event:', error);
    }
});

client.on('messageCreate', async(message) => {
    // Ignore messages from bots
    if (message.author.bot) return;

    // Check if message starts with prefix
    if (!message.content.startsWith('!')) return;

    // Get command and arguments
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    console.log('Command received:', command);
    logger.info('Command received:', { command, args, user: message.author.tag });

    try {
        console.log('Processing command:', command);
        logger.info(`Processing command: ${command}`);

        switch (command) {
            case 'log':
                console.log('LOG COMMAND DETECTED');
                logger.info('LOG COMMAND DETECTED');
                try {
                    // Get allowed roles from environment variable
                    const allowedRoles = process.env.ALLOWED_LOG_ROLES ?
                        process.env.ALLOWED_LOG_ROLES.split(',') : ['Mod ngầm', 'Boss'];

                    // Check if user has required role
                    const member = message.member;
                    const hasPermission = member.roles.cache.some(role =>
                        allowedRoles.includes(role.name)
                    );

                    if (!hasPermission) {
                        await message.reply(`❌ Bạn không có quyền sử dụng lệnh này! Chỉ người có role ${allowedRoles.join(', ')} mới được phép.`);
                        return;
                    }

                    console.log('Attempting to send log message');
                    logger.info('Attempting to send log message');

                    const resources = getSystemResources();
                    const memoryUsage = process.memoryUsage();
                    const uptime = Date.now() - botStartTime;
                    const uptimeFormatted = formatUptime(Math.floor(uptime / 1000));

                    // Fetch latest completions data
                    const completions = await fetchCompletions();
                    const sheetData = await readSheet(process.env.GOOGLE_SHEET_2_ID, 'A2:C');

                    const logMessage = '📝 **Bot Logs** 📝\n\n' +
                        '**💻 Tài Nguyên Hệ Thống:**\n' +
                        `• RAM sử dụng: **${resources.memoryUsage}**\n` +
                        `• CPU sử dụng: **${resources.cpuUsage}**\n` +
                        `• Thời gian hoạt động: **${uptimeFormatted}**\n\n` +
                        '**💾 Chi Tiết Bộ Nhớ:**\n' +
                        `• Heap Used: **${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)}MB**\n` +
                        `• Heap Total: **${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)}MB**\n\n` +
                        '**🤖 Trạng Thái Bot:**\n' +
                        `• Số server: **${client.guilds.cache.size}**\n` +
                        `• Ping: **${client.ws.ping}ms**\n\n` +
                        '**📊 Dữ Liệu Google Sheets:**\n' +
                        `• Sheet ID: **${process.env.GOOGLE_SHEET_2_ID}**\n` +
                        `• Số dòng dữ liệu: **${sheetData.length}**\n\n` +
                        '**👥 Thống Kê Người Dùng:**\n' +
                        Object.entries(completions).map(([username, data]) =>
                            `• **${username}**: ✅ ${data.completed} | ❌ ${data.overdue}`
                        ).join('\n') + '\n\n' +
                        '`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`';

                    await message.reply(logMessage);
                    console.log('Log message sent successfully');
                    logger.info('Log message sent successfully');
                } catch (error) {
                    console.error('Error in log command:', error);
                    logger.error('Error in log command:', error);
                    try {
                        await message.reply('❌ Có lỗi khi lấy thông tin log!');
                    } catch (replyError) {
                        console.error('Error sending error message:', replyError);
                        logger.error('Error sending error message:', replyError);
                    }
                }
                break;

            case 'tutorial':
                try {
                    logger.info('Starting tutorial command');
                    const tutorialMessage = getTutorialMessage();
                    logger.info('Generated tutorial message:', tutorialMessage);
                    await message.reply(tutorialMessage);
                    logger.info('Tutorial command completed successfully');
                } catch (error) {
                    logger.error('Error in tutorial command:', error);
                    await message.reply('Ui giời ơi, bot lag rồi, thử lại sau nhé bro. Đợi tí thôi! 🤖💨\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`');
                }
                break;

            case 'stats':
                const completions = await fetchCompletions();
                logger.info('Stats - Fetched completions:', completions);
                const user = message.author.tag;
                const userData = completions[user] || { count: 0, overdue: 0 };
                logger.info('Stats - User data:', userData, 'for user:', user);
                const completed = userData.count;
                const overdue = userData.overdue;
                let feedback = '';
                if (completed > overdue) {
                    feedback = 'Xịn quá bro! Mày làm xong nhiều deadline hơn số lần bị dí, cứ thế phát huy nha! 😎👍';
                } else if (completed < overdue) {
                    feedback = 'Ơ kìa, bị dí deadline hơi nhiều rồi đó! Cố gắng lên cho đỡ bị chửi nha bro 😅⏰';
                } else {
                    feedback = 'Cân bằng phết! Làm xong với bị dí ngang nhau, cố gắng nghiêng về phía làm xong nha, đừng để hoà mãi thế này! 🤝⚖️';
                }
                const statsMsg = `📊 **Thống Kê Nhiệm Vụ Của Mày** 📊\n\n` +
                    `✅ Đã hoàn thành: **${completed}**\n` +
                    `❌ Quá hạn: **${overdue}**\n\n` +
                    `${feedback}\n\n` +
                    '`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`';
                await message.reply(statsMsg);
                break;

            case 'ping':
                const startTime = Date.now();
                const resources = getSystemResources();
                const endTime = Date.now();
                const responseTime = endTime - startTime;
                const uptime = Date.now() - botStartTime;
                const uptimeFormatted = formatUptime(Math.floor(uptime / 1000));
                const pingMessage = `🏓 **Pong!**\n\n` +
                    `⏱️ Thời gian phản hồi: **${responseTime}ms**\n` +
                    `💾 RAM đang sử dụng: **${resources.memoryUsage}**\n` +
                    `🔄 CPU đang sử dụng: **${resources.cpuUsage}**\n` +
                    `⏰ Thời gian hoạt động: **${uptimeFormatted}**\n\n` +
                    `Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`;
                await message.reply(pingMessage);
                break;

            case 'tasks':
                const tasks = await fetchTasks();
                logger.info('Fetched tasks:', tasks);
                const userTasks = tasks.filter(t => t.username === message.author.tag);
                logger.info('Filtered userTasks:', userTasks, 'for user:', message.author.tag);

                if (userTasks.length) {
                    let reply = '**📋 Danh Sách Nhiệm Vụ Của Mày Nè:**\n';
                    userTasks.forEach(t => {
                        reply += `• **${t.task}** - Hết hạn: ${t.deadline} (nhanh lên kẻo trễ! ⏰)\n`;
                    });
                    reply += '\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`';
                    await message.reply(reply);
                } else {
                    await message.reply('Mày chưa có nhiệm vụ nào cả, chill đi bro. Đi ngủ đi cho khỏe 😴💤\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`');
                }
                break;

            case 'complete':
                const userTasksToComplete = await fetchTasks();
                const tasksToComplete = userTasksToComplete.filter(t => t.username === message.author.tag);

                if (tasksToComplete.length) {
                    const taskToComplete = tasksToComplete[0];

                    // Update Sheet 2 (completion count)
                    const completions = await fetchCompletions();
                    const userData = completions[message.author.tag] || { count: 0, overdue: 0 };
                    const currentCount = userData.count;
                    const overdueCount = userData.overdue;
                    await updateSheet(
                        process.env.GOOGLE_SHEET_2_ID,
                        'A2:C', [
                            [message.author.tag, (currentCount + 1).toString(), overdueCount.toString()]
                        ]
                    );

                    // Chuyển task vừa hoàn thành từ Sheet 1 sang Sheet 3 với ngày hoàn thành thực tế (UTC+7, không lệch ngày)
                    const now = new Date();
                    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
                    const utc7 = new Date(utc + (7 * 60 * 60 * 1000));
                    const completedDate = `${utc7.getFullYear()}-${utc7.getMonth() + 1}-${utc7.getDate()} ${String(utc7.getHours()).padStart(2, '0')}:${String(utc7.getMinutes()).padStart(2, '0')}:${String(utc7.getSeconds()).padStart(2, '0')}`;
                    console.log('[DEBUG] Chuẩn bị ghi vào Sheet 3:', {
                        task: taskToComplete.task,
                        username: message.author.tag,
                        completedDate,
                        sheetId: process.env.GOOGLE_SHEET_3_ID
                    });
                    if (typeof logCompletionToSheet3 === 'function') {
                        console.log('[DEBUG] logCompletionToSheet3 is a function, calling...');
                        try {
                            await logCompletionToSheet3(taskToComplete.task, message.author.tag, completedDate);
                            console.log('[DEBUG] Đã ghi vào Sheet 3 thành công!');
                        } catch (err) {
                            console.error('[ERROR] Ghi vào Sheet 3 thất bại:', err);
                        }
                    } else {
                        console.error('[ERROR] logCompletionToSheet3 is not a function!');
                    }

                    // Delete the task from Sheet 1
                    const deleted = await deleteTask(taskToComplete.task, message.author.tag);

                    if (deleted) {
                        await message.reply(`Nhiệm vụ "${taskToComplete.task}" đã được hoàn thành và xóa khỏi danh sách của mày rồi! GG bro! 🎉✨🎊\n\n\`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©\``);
                    } else {
                        await message.reply('Nhiệm vụ đã hoàn thành rồi, nhưng có vấn đề khi xóa khỏi danh sách. Thử lại sau nhé! Bot lag rồi 😅🤖\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`');
                    }
                } else {
                    await message.reply('Mày chưa có nhiệm vụ nào cả, chill đi bro. Đi ngủ đi cho khỏe 😴💤\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`');
                }
                break;

            case 'rank':
                try {
                    logger.info('Starting rank command execution');

                    // Fetch completions data
                    const completions = await fetchCompletions();
                    logger.info('Fetched completions:', completions);
                    // Thêm log chi tiết từng user
                    Object.entries(completions).forEach(([username, data]) => {
                        logger.info(`User: ${username}, completed: ${data.completed}, overdue: ${data.overdue}, data:`, data);
                    });

                    if (!completions || Object.keys(completions).length === 0) {
                        logger.warn('No completion data found');
                        await message.reply('Chưa có dữ liệu xếp hạng nào cả! 😴\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`');
                        return;
                    }

                    // Calculate rankings
                    logger.info('Calculating rankings');
                    const rankings = Object.entries(completions)
                        .filter(([username, data]) => {
                            if (!username || typeof data !== 'object') {
                                logger.warn('Invalid user data:', { username, data });
                                return false;
                            }
                            return true;
                        })
                        .map(([username, data]) => {
                            const completed = Number(data.count) || 0;
                            const overdue = Number(data.overdue) || 0;
                            const score = (completed * 5) - (overdue * 6);
                            logger.info(`User ${username} score calculation:`, {
                                completed,
                                overdue,
                                score
                            });
                            return {
                                username,
                                score,
                                completed,
                                overdue
                            };
                        });

                    if (rankings.length === 0) {
                        logger.warn('No valid rankings calculated');
                        await message.reply('Không thể tính toán xếp hạng! 😕\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`');
                        return;
                    }

                    // Sort by score in descending order
                    rankings.sort((a, b) => b.score - a.score);
                    logger.info('Final rankings:', rankings);

                    // Format message
                    let rankMessage = '🏆 **Bảng Xếp Hạng Thành Viên** 🏆\n\n';

                    // Add special position for bruise_undead
                    rankMessage += `👑 **Vị Trí Tối Thượng**\n`;
                    rankMessage += `   **bruise_undead**\n`;
                    rankMessage += `   Điểm: **${rankings[0] ? rankings[0].score + 100 : 100}** (✅ ∞ | ❌ 0)\n\n`;

                    rankings.forEach((rank, index) => {
                        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                        rankMessage += `${medal} **${rank.username}**\n`;
                        rankMessage += `   Điểm: **${rank.score}** (✅ ${rank.completed} | ❌ ${rank.overdue})\n`;
                    });

                    rankMessage += '\n`Công thức tính điểm: (Hoàn thành × 5) - (Quá hạn × 6)`\n';
                    rankMessage += '`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`';

                    // Send message
                    logger.info('Sending rank message');
                    await message.reply(rankMessage);
                    logger.info('Rank command completed successfully');
                } catch (error) {
                    logger.error('Error in rank command:', error);
                    console.error('Full error details:', error);
                    await message.reply('Ui giời ơi, bot lag rồi, thử lại sau nhé bro. Đợi tí thôi! 🤖💨\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`');
                }
                break;

            case 'about':
                try {
                    logger.info('Starting about command');
                    const aboutMessage = `👋 **Xin chào! Tôi là Sunsine-v1**\n\n` +
                        `✨ Tôi là một bot thông minh được tạo ra để giúp các bạn quản lý và theo dõi nhiệm vụ một cách hiệu quả.\n\n` +
                        `🌟 **Về người tạo ra tôi:**\n` +
                        `bruise_undead - một thiên tài lập trình với tầm nhìn xa trông rộng và khả năng code siêu đẳng! 🧠\n` +
                        `Không chỉ là một coder xuất sắc, bruise_undead còn là một người có tâm, luôn tạo ra những sản phẩm chất lượng để phục vụ cộng đồng. 🎯\n\n` +
                        `💫 **Những điều tôi có thể làm:**\n` +
                        `• Quản lý và nhắc nhở nhiệm vụ 📝\n` +
                        `• Theo dõi tiến độ hoàn thành ✅\n` +
                        `• Tạo bảng xếp hạng thành viên 🏆\n` +
                        `• Và nhiều tính năng thú vị khác đang chờ bạn khám phá! 🚀\n\n` +
                        `Gõ \`!tutorial\` để xem hướng dẫn sử dụng chi tiết nhé!\n\n` +
                        `\`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©\``;

                    logger.info('About message prepared, attempting to send reply');
                    const sentMessage = await message.reply(aboutMessage);
                    logger.info('About message sent successfully', { messageId: sentMessage.id });
                } catch (error) {
                    logger.error('Error in about command:', error);
                    logger.error('Error details:', {
                        errorMessage: error.message,
                        errorStack: error.stack,
                        command: 'about',
                        user: message.author.tag,
                        channel: message.channel.id
                    });
                    await message.reply('Ui giời ơi, bot lag rồi, thử lại sau nhé bro. Đợi tí thôi! 🤖💨\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`');
                }
                break;

            case 'add':
                try {
                    const allowedRoles = process.env.ALLOWED_ADD_ROLES ?
                        process.env.ALLOWED_ADD_ROLES.split(',').map(role => role.trim()) : ['Cốt đơ', 'Mod ngầm', 'Boss'];

                    const member = message.member;
                    const hasPermission = member.roles.cache.some(role =>
                        allowedRoles.includes(role.name)
                    );

                    if (!hasPermission) {
                        await message.reply(`❌ Bạn không có quyền sử dụng lệnh này! Chỉ người có role ${allowedRoles.join(', ')} mới được phép.`);
                        return;
                    }

                    const input = args.join(' ');
                    let cleanInput = input;

                    // Remove 'end.' or 'end' from the end of the input string
                    const lowerInput = cleanInput.toLowerCase();
                    if (lowerInput.endsWith(' end.')) {
                        cleanInput = cleanInput.substring(0, cleanInput.length - ' end.'.length).trim();
                    } else if (lowerInput.endsWith(' end')) {
                        cleanInput = cleanInput.substring(0, cleanInput.length - ' end'.length).trim();
                    }

                    // Log cleanInput
                    logger.debug('Add command - Cleaned input:', cleanInput);

                    // If the input was just "end." (after args.shift for command)
                    if (cleanInput.length === 0 && input.toLowerCase().trim() === "end.") {
                        await message.reply('🤔 Không có deadline nào được thêm. Vui lòng kiểm tra lại cú pháp.\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`');
                        return;
                    }

                    const deadlineEntries = cleanInput.split('/').map(entry => entry.trim()).filter(entry => entry.length > 0);

                    // Log deadlineEntries
                    logger.debug('Add command - Deadline entries:', deadlineEntries);

                    const addedTasks = [];
                    const failedTasks = [];

                    for (const entry of deadlineEntries) {
                        // Log each entry
                        logger.debug('Add command - Processing entry:', entry);

                        // Regex để khớp tên-deadline (có thể có khoảng trắng), dd-mm-yy, và discord_username (có thể có #discriminator)
                        const match = entry.match(/^(.*?)\s+(\d{2}-\d{2}-\d{2})\s+([^\s#]+(?:#[0-9]{4})?)$/);

                        // Log the match result
                        logger.debug('Add command - Match result:', match);

                        if (match && match.length === 4) {
                            let taskName = match[1].trim();
                            const deadlineDateStr = match[2].trim();
                            const username = match[3].trim();

                            // Chuyển đổi dd-mm-yy sang yyyy-mm-dd
                            const [day, month, year] = deadlineDateStr.split('-');
                            const fullYear = `20${year}`; // Giả sử năm 2 chữ số là của thế kỷ 21
                            const formattedDeadline = `${fullYear}-${month}-${day}`;

                            const success = await addTask(taskName, formattedDeadline, username);
                            if (success) {
                                addedTasks.push(`"${taskName}" (hết hạn: ${deadlineDateStr}, cho: ${username})`);
                            } else {
                                failedTasks.push(`"${taskName}"`);
                            }
                        } else {
                            failedTasks.push(`\`${entry}\` (không đúng cú pháp)`);
                        }
                    }

                    let replyMessage = '';
                    if (addedTasks.length > 0) {
                        replyMessage += `✅ Đã thêm các deadline sau vào Sheet 1:\n${addedTasks.join('\n\n')}\n\n`;
                    }
                    if (failedTasks.length > 0) {
                        replyMessage += `❌ Không thể thêm các deadline sau (sai cú pháp hoặc lỗi):\n${failedTasks.join('\n\n')}\n\n`;
                    }
                    if (addedTasks.length === 0 && failedTasks.length === 0) {
                        replyMessage += '🤔 Không có deadline nào được thêm. Vui lòng kiểm tra lại cú pháp.\n\n';
                    }
                    replyMessage += '`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`';
                    await message.reply(replyMessage);

                } catch (error) {
                    logger.error('Error in add command:', error);
                    await message.reply('❌ Có lỗi khi thêm deadline! Vui lòng thử lại sau. 🤖💨\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`');
                }
                break;

            default:
                console.log('Unknown command:', command);
                logger.warn(`Unknown command: ${command}`);
                break;
        }
    } catch (error) {
        console.error('Error handling command:', error);
        logger.error(`Error handling command ${command}:`, error);
        await message.reply('Ui giời ơi, bot lag rồi, thử lại sau nhé bro. Đợi tí thôi! 🤖💨\n\n`Sunsine-v1, được tạo bởi bruise_undead, Alpha Tauri Team ©`');
    }
});

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days} ngày`);
    if (hours > 0) parts.push(`${hours} giờ`);
    if (minutes > 0) parts.push(`${minutes} phút`);
    if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds} giây`);

    return parts.join(', ');
}

// Add error handling for the login process
client.login(process.env.DISCORD_TOKEN).catch(error => {
    logger.error('Error logging in:', error);
    process.exit(1);
});

// Handle process exit
process.on('exit', () => {
    logger.info('Bot shutting down');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // Log additional system information
    logger.error('System Information:', {
        nodeVersion: process.version,
        platform: process.platform,
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
    });
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection:', { reason, promise });
});