import 'dotenv/config';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { REST } from '@discordjs/rest';
import express from 'express';
import cron from 'node-cron';

import config from './config/application.js';
import { initializeDatabase } from './utils/database.js';
import { getGuildConfig } from './services/guildConfig.js';
import { getServerCounters, saveServerCounters, updateCounter } from './services/serverstatsService.js';
import { logger, startupLog, shutdownLog } from './utils/logger.js';
import { checkBirthdays } from './services/birthdayService.js';
import { checkGiveaways } from './services/giveawayService.js';
import { loadCommands, registerCommands as registerSlashCommands } from './handlers/commandLoader.js';

class TitanBot extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildBans,
      ],
    });

    this.config = config;
    this.commands = new Collection();
    this.events = new Collection();
    this.buttons = new Collection();
    this.selectMenus = new Collection();
    this.modals = new Collection();
    this.cooldowns = new Collection();
    this.db = null;
    this.rest = new REST({ version: '10' }).setToken(config.bot.token);
  }

  async start() {
    try {
      startupLog('Starting TitanBot...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      startupLog('Initializing database...');
      const dbInstance = await initializeDatabase();
      this.db = dbInstance.db;

      startupLog('Starting web server...');
      this.startWebServer();

      startupLog('Loading commands...');
      await loadCommands(this);

      startupLog('Loading handlers...');
      await this.loadHandlers();

      startupLog('Logging into Discord...');
      await this.login(this.config.bot.token);

      startupLog('Registering slash commands...');
      await this.registerCommands();

      startupLog(`ONLINE ✅ | ${this.commands.size} commands loaded`);

      this.setupCronJobs();

      // ================================
      // ✅ YOUR POSTGRES RANK COMMAND
      // ================================
      this.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const content = message.content;

        if (!content.startsWith('?postgeSQL')) return;
        if (!content.includes('give.rank')) return;

        const userMatch = content.match(/user\.r"?([^"\s]+)"?/);
        const rankMatch = content.match(/r\.([^\s"]+)/);

        if (!userMatch || !rankMatch) {
          return message.reply(
            '❌ Usage: ?postgeSQL give.rank user.r"xdpann" r.Diamond'
          );
        }

        const user = userMatch[1];
        const rank = rankMatch[1];

        const isId = /^\d+$/.test(user);

        try {
          let result;

          // ✅ FIXED QUERY WITH RESULT CHECK
          if (isId) {
            result = await this.db.query(
              "UPDATE users SET rank = $1 WHERE user_id = $2",
              [rank, user]
            );
          } else {
            result = await this.db.query(
              "UPDATE users SET rank = $1 WHERE username = $2",
              [rank, user]
            );
          }

          // 🔥 IMPORTANT FIX: check if user exists
          if (!result || result.rowCount === 0) {
            return message.reply(`❌ User not found in database: ${user}`);
          }

          return message.reply(`✅ Rank updated: ${user} → ${rank}`);

        } catch (err) {
          console.error("POSTGRES ERROR:", err);
          return message.reply(`❌ PostgreSQL error: ${err.message}`);
        }
      });

    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  }

  startWebServer() {
    const app = express();
    const port = this.config.api?.port || 3000;

    app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });

    app.listen(port, () => {
      startupLog(`Web server running on ${port}`);
    });
  }

  setupCronJobs() {
    cron.schedule('0 6 * * *', () => checkBirthdays(this));
    cron.schedule('* * * * *', () => checkGiveaways(this));
  }

  async loadHandlers() {
    const handlers = [
      { path: 'events', type: 'default', required: true },
      { path: 'interactions', type: 'default', required: true }
    ];

    for (const handler of handlers) {
      const module = await import(`./handlers/${handler.path}.js`);
      await module.default(this);
    }
  }

  async registerCommands() {
    await registerSlashCommands(this, this.config.bot.guildId);
  }

  async shutdown(reason = 'UNKNOWN') {
    shutdownLog(`Shutting down (${reason})`);
    this.destroy();
    process.exit(0);
  }
}

const bot = new TitanBot();

bot.start().catch(err => {
  console.error(err);
  process.exit(1);
});
