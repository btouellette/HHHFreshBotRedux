'use strict';
const snoowrap = require('snoowrap');
const schedule = require('node-schedule');
const pg       = require('pg');
const winston  = require('winston');

// console.log('Node version is: ' + process.version);

const config = {
  reddit: {
    USER_AGENT:    'HHHFreshBotRedux 1.0 by /u/novamute',
    CLIENT_ID:     process.env.REDDIT_CLIENT_ID, // public identifier for the app in OAuth (something not guessable preferably)
    CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    USERNAME:      process.env.REDDIT_USERNAME,
    PASSWORD:      process.env.REDDIT_PASSWORD
  },
  DB_URL:    process.env.DB_URL,
  LOG_LEVEL: process.env.LOG_LEVEL
};

const logger = winston.createLogger({
  level: config.LOG_LEVEL || 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(info => {
      return `${info.timestamp} - ${info.level} - ${info.message}`;
    })
  ),
  transports: [new winston.transports.Console()]
});

const reddit = new snoowrap({
  userAgent:    config.reddit.USER_AGENT,
  clientId:     config.reddit.CLIENT_ID,
  clientSecret: config.reddit.CLIENT_SECRET,
  username:     config.reddit.USERNAME,
  password:     config.reddit.PASSWORD
});

const DB = {
  client: new pg.Client({ connectionString: config.DB_URL }),
  
  getMaxTimestamp: function() {
    return DB.client.query("SELECT COALESCE(MAX(time), EXTRACT(epoch from now() - interval '1 hour')) as max_time FROM posts;").then(res => res.rows[0].max_time);
  },
  
  init: async function() {
    // Connect and create tables
    await DB.client.connect();
    return Promise.all([
      DB.client.query('CREATE TABLE IF NOT EXISTS subscriptions(username TEXT, type TEXT);'),
      DB.client.query('CREATE TABLE IF NOT EXISTS posts(day DATE, id TEXT PRIMARY KEY, title TEXT, permalink TEXT, url TEXT, time INT);')
    ]);
  },
  
  close: function() {
    DB.client.end();
  }
};

const FreshBot = {
  scheduleJob: function() {
    // This rule is standard cron syntax for midnight every day.
    // See http://stackoverflow.com/a/5398044/1252653
    var rule = '0 0 * * *';

    // Kick off the job
    schedule.scheduleJob(rule, function() {
      console.log('ping!'); 
    });
  },
  
  getNewPosts: async function() {
    let maxTimeInDB = await DB.getMaxTimestamp();
    let secondsBehind = new Date() / 1000 - maxTimeInDB;
    let timeFilter = secondsBehind >= 604800 ? 'month' : 
                     secondsBehind >= 86400  ? 'week' : 
                     secondsBehind >= 3600   ? 'day' : 
                                               'hour';
    let redditPosts = reddit.search({ query: '[FRESH',
                                      subreddit: 'hiphopheads',
                                      sort: 'new',
                                      time: timeFilter });
    let newPosts = redditPosts.filter(record => record.created_utc >= maxTimeInDB);
    logger.debug(JSON.stringify(await newPosts));
    return newPosts;
  },

  init: async function() {
    let freshPosts = FreshBot.getNewPosts();
    await DB.init();
    //FreshBot.scheduleJob();
  }
};

process.on('unhandledRejection', (reason, p) => {
  // Unhandled promise rejection, since we already have fallback handler for unhandled errors (see below), throw and let him handle that
  throw reason;
});
process.on('uncaughtException', (error) => {
  logger.error(error);
  process.exit(1);
});

FreshBot.init();