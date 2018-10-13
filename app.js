'use strict';
const snoowrap = require('snoowrap');
const pg       = require('pg');
const pgformat = require('pg-format');
const winston  = require('winston');

// Built for PostgreSQL 10 and Node 10.12.0
//
// To upgrade c9.io to PostgreSQL 10:
//    sudo apt-get install -y dpkg
//    sudo service postgresql stop
//    sudo apt-get --purge remove postgresql\*
//    sudo echo "deb http://apt.postgresql.org/pub/repos/apt/ trusty-pgdg main" >> /etc/apt/sources.list.d/pgdg.list
//    wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc > pgkey
//    sudo apt-key add pgkey
//    rm pgkey
//    sudo apt-get update
//    sudo apt-get install postgresql-10
//    sudo su - postgres
//    psql
//    CREATE ROLE ubuntu SUPERUSER LOGIN REPLICATION CREATEDB CREATEROLE;
//    CREATE DATABASE ubuntu OWNER ubuntu;
//    CREATE DATABASE freshbot OWNER ubuntu;
//    \password ubuntu
//    \q
//    exit
//
// SELECT VERSION();
//
// To upgrade c9.io to Node 10.12.0:
//    nvm install 10
//    nvm alias default 10
//
// console.log('Node version is: ' + process.version);

const config = {
  reddit: {
    USER_AGENT:    process.env.REDDIT_USER_AGENT,
    CLIENT_ID:     process.env.REDDIT_CLIENT_ID, // get ID and secret for app from https://www.reddit.com/prefs/apps/
    CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    USERNAME:      process.env.REDDIT_USERNAME,
    PASSWORD:      process.env.REDDIT_PASSWORD,
    ADMIN:         process.env.REDDIT_ADMIN_USER
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
  
  getMaxTimestamp: async function() {
    return DB.client.query("SELECT COALESCE(MAX(created_utc), EXTRACT(epoch from now() - interval '1 hour')) as max_time FROM posts").then(res => res.rows[0].max_time);
  },
  
  getMinDate: async function() {
    //TODO: remove coalesce
    return DB.client.query("SELECT COALESCE(MIN(day), current_date) as min_date FROM posts").then(res => res.rows[0].min_date);
  },
  
  getMinUnsentDate: async function() {
    //TODO: remove coalesce
    return DB.client.query("SELECT COALESCE(MIN(day), current_date) as min_date FROM posts WHERE daily_sent = false").then(res => res.rows[0].min_date);
  },
  
  getWeeklySubscribers: async function() {
    return DB.client.query("SELECT DISTINCT username FROM subscriptions WHERE type = 'weekly'").then(res => res.rows.map(row => row.username));
  },
  
  getDailySubscribers: async function() {
    return DB.client.query("SELECT DISTINCT username FROM subscriptions WHERE type = 'daily'").then(res => res.rows.map(row => row.username));
  },
  
  insertPosts: async function(posts) {
    logger.debug('Adding ' + posts.length + ' new posts to DB');
    const postsAsArray = posts.map(post => ([post.day, post.id, post.title, post.permalink, post.url, post.created_utc, post.score]));
    const query = pgformat('INSERT INTO posts(day, id, title, permalink, url, created_utc, score) VALUES %L ON CONFLICT(id) DO NOTHING', postsAsArray);
    //return DB.client.query(query);
  },
  
  subscribeUserToDaily: async function(user) {
    logger.debug(pgformat("INSERT INTO subscriptions(username, type) VALUES (%L, 'daily')", user));
    return DB.client.query(pgformat("INSERT INTO subscriptions(username, type) VALUES (%L, 'daily')", user));
  },
  
  subscribeUserToWeekly: async function(user) {
    logger.debug(pgformat("INSERT INTO subscriptions(username, type) VALUES (%L, 'weekly')", user));
    return DB.client.query(pgformat("INSERT INTO subscriptions(username, type) VALUES (%L, 'weekly')", user));
  },
  
  unsubscribeUser: async function(user) {
    logger.debug(pgformat("DELETE FROM subscriptions WHERE username = %L", user));
    return DB.client.query(pgformat("DELETE FROM subscriptions WHERE username = %L", user));
  },
  
  markDaySent: async function(date) {
    return DB.client.query(pgformat('UPDATE posts SET daily_sent = true WHERE day = %L', date.toYYYYMMDD()));
  },
  
  purgeDays: async function(startDate, endDate) {
    return DB.client.query(pgformat('DELETE FROM posts WHERE day BETWEEN %L AND %L', startDate.toYYYYMMDD(), endDate.toYYYYMMDD()));
  },
  
  init: async function() {
    logger.debug('Initializing DB');
    // Connect and create tables
    await DB.client.connect();
    return Promise.all([
      DB.client.query('CREATE TABLE IF NOT EXISTS subscriptions(username TEXT, type TEXT)')
        .then(DB.client.query('CREATE INDEX IF NOT EXISTS subscriptions_type_idx ON subscriptions (type)')),
      DB.client.query('CREATE TABLE IF NOT EXISTS posts(day DATE, id TEXT PRIMARY KEY, title TEXT, permalink TEXT, url TEXT, created_utc INT, score INT, daily_sent BOOLEAN DEFAULT FALSE)')
        .then(DB.client.query('CREATE INDEX IF NOT EXISTS posts_day_idx ON posts (day)'))
        .then(DB.client.query('CREATE INDEX IF NOT EXISTS posts_created_utc_idx ON posts (created_utc)'))
    ]);
  },
  
  close: async function() {
    return DB.client.end();
  }
};

const Template = {
  footer: `

---

^(This post was generated by a bot)

^Subscribe ^to ^roundups: ^[[Daily](http://www.reddit.com/message/compose/?to=HHHFreshBotRedux&subject=subscribe&message=daily)] ^[[Weekly](http://www.reddit.com/message/compose/?to=HHHFreshBotRedux&subject=subscribe&message=weekly)] ^[[Unsubscribe](http://www.reddit.com/message/compose/?to=HHHFreshBotRedux&subject=unsubscribe&message=remove)]

^[[Info/Source](https://github.com/btouellette/HHHFreshBotRedux)] ^[[Feedback](http://www.reddit.com/message/compose/?to=${config.reddit.ADMIN}&amp;subject=%2Fu%2FHHHFreshBotRedux%20feedback;message=If%20you%20are%20providing%20feedback%20about%20a%20specific%20post%2C%20please%20include%20the%20link%20to%20that%20post.%20Thanks!)]`,
};
Template.replyToUnknown = "I couldn't understand this message. Please use one of the links below to subscribe, unsubscribe, or send feedback!" + Template.footer;
Template.dailySubSuccess = 'You have been subscribed to the daily mailing list!' + Template.footer;
Template.weeklySubSuccess = 'You have been subscribed to the weekly mailing list!' + Template.footer;
Template.unsubscribeSuccess = 'You have been unsubscribed from all mailing lists. Sorry to see you go!' + Template.footer;

const FreshBot = {
  getNewPosts: async function(maxTimeInDB) {
    logger.debug('Fetching new posts');
    
    const secondsBehind = new Date() / 1000 - maxTimeInDB;
    const timeFilter = secondsBehind >= 604800 ? 'month' : 
                       secondsBehind >= 86400  ? 'week' : 
                       secondsBehind >= 3600   ? 'day' : 
                                                 'hour';
                                                 
    return reddit.search({ query: '[FRESH',
                           subreddit: 'hiphopheads',
                           sort: 'new',
                           time: timeFilter })
                 .filter(post => post.created_utc >= maxTimeInDB) // filter out any posts already inserted into the DB
                 .map(post => ({  
                   day: new Date(post.created_utc * 1000).toYYYYMMDD(),
                   id: post.id,
                   title: post.title,
                   permalink: post.permalink,
                   url: post.url,
                   created_utc: post.created_utc,
                   score: post.score
                 }));
  },
  
  fetchNewPosts: async function() {
    // See how far we've loaded so far
    const maxTimeInDB = await DB.getMaxTimestamp();
    const startDate = new Date(maxTimeInDB * 1000);
    logger.debug('Previously fetched up to ' + startDate);
    
    // Get any new posts since then and add to posts table in DB
    await DB.insertPosts(await FreshBot.getNewPosts(maxTimeInDB));
  },
  
  processPrivateMessagesForUser: async function(PMs) {
    // Process PMs in order received
    const sortedPMs = PMs.sort((a, b) => { return a.created_utc - b.created_utc; });
    debugger;
    for (let i = 0, len = sortedPMs.length; i < len; i++) {
      const currentPM = sortedPMs[i];
      if (currentPM.subject === 'subscribe' && currentPM.body === 'daily') {
        await DB.subscribeUserToDaily(currentPM.author.name).then(() => { return currentPM.reply(Template.dailySubSuccess); });
        console.log('daily');
      } else if (currentPM.subject === 'subscribe' && currentPM.body === 'weekly') {
        await DB.subscribeUserToWeekly(currentPM.author.name).then(() => { return currentPM.reply(Template.weeklySubSuccess); });
        console.log('weekly');
      } else if (currentPM.subject === 'unsubscribe' && currentPM.body === 'remove') {
        await DB.unsubscribeUser(currentPM.author.name).then(() => { return currentPM.reply(Template.unsubscribeSuccess); });
        console.log('remove');
      } else {
        await currentPM.reply(Template.replyToUnknown);
        console.log('???');
      }
    }
  },
  
  processPrivateMessages: async function() {
    const newMessages = await reddit.getUnreadMessages();
    const newPMs = newMessages.filter(msg => !msg.was_comment);
    
    logger.debug('Processing ' + newPMs.length + ' new PMs');
    
    // Group PMs to handle PMs from different users in parallel
    const groupedPMs = newPMs.reduce((r, pm) => { 
      r[pm.author.name] = r[pm.author.name] || [];
      r[pm.author.name].push(pm);
      return r;
    }, Object.create(null));
    
    const doneProcessingPMs = [];
    for (var username in groupedPMs) {
      doneProcessingPMs.push(FreshBot.processPrivateMessagesForUser(groupedPMs[username]));
    }
    
    //doneProcessingPMs.push(reddit.markMessagesAsRead(newMessages));
    
    return Promise.all(doneProcessingPMs);
  },
  
  generateDailyMessages: async function(endDate) {
    // Generate daily messages to subscribers
    const minUnsentDate = await DB.getMinUnsentDate();
    logger.debug('Daily messages sent up to ' + minUnsentDate);
    
    // Check if daily messages needs to be sent
    const sentDaysDone = [];
    for (let dayStart = new Date(minUnsentDate); dayStart.addDays(1).addHours(6) < endDate; dayStart = dayStart.addDays(1)) {
      // We've loaded 6 hours into a new day, send daily messages and post
      const dayEnd = dayStart.addDays(1);
      logger.debug('Processing day between ' + dayStart + ' and ' + dayEnd);
      
      //TODO
      
      // Update DB to mark this day sent
      sentDaysDone.push(DB.markDaySent(minUnsentDate));
    }
    return Promise.all(sentDaysDone);
  },
  
  generateWeeklyMessagesAndPost: async function(endDate) {
    // Generate weekly messages to subscribers and post to r/hiphopheads
    // Check if weekly messages and post needs to be sent
    const sentWeeksDone = [];
    for (let weekStart = await DB.getMinDate(); weekStart.addDays(7).addHours(6) < endDate; weekStart = weekStart.addDays(7)) {
      // We've loaded 6 hours into a new week, send weekly messages and post
      const weekEnd = weekStart.addDays(7);
      logger.debug('Processing week between ' + weekStart + ' and ' + weekEnd);
      
      //TODO
      // Character limit of 40k on self posts, if exceeded add remaining in comments
      
      // Purge DB of previous week's data
      sentWeeksDone.push(DB.purgeDays(weekStart, weekEnd));
    }
    return Promise.all(sentWeeksDone);
  },

  start: async function() {
    logger.debug('Starting');
    
    // Start up DB connection then fetch new reddit posts
    await DB.init();
    await FreshBot.fetchNewPosts();
    
    // Process incoming messages and record any new subscriptions/unsubscriptions
    // Let all users register before moving on to creating posts
    await FreshBot.processPrivateMessages();
    
    const endDate = await DB.getMaxTimestamp().then(ts => new Date(ts * 1000));
    logger.debug('Loaded posts up to ' + endDate);
    
    await FreshBot.generateDailyMessages(endDate);
    // Wait on days to be completed before moving to week processing as week processing will purge DB
    await FreshBot.generateWeeklyMessagesAndPost(endDate);
    
    await DB.close();
    process.exit(0);
  }
};

Date.prototype.addDays = function (days) {
  var newDate = new Date(this);
  newDate.setDate(newDate.getDate() + days);
  return newDate;
};

Date.prototype.addHours = function (hours) {
  var newDate = new Date(this);
  newDate.setHours(newDate.getHours() + hours);
  return newDate;
};

Date.prototype.toYYYYMMDD = function () {
  return this.toISOString().slice(0,10).replace(/-/g,"");
};

process.on('unhandledRejection', (reason, p) => {
  // Unhandled promise rejection, since we already have fallback handler for unhandled errors (see below), throw and let him handle that
  throw reason;
});
process.on('uncaughtException', (error) => {
  logger.error(error);
  process.exit(1);
});

FreshBot.start();
// https://devcenter.heroku.com/articles/scheduler
// Make sure process is scaled to worker=1 so that it doesn't kick off multiple jobs at the same time