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
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  MIN_SCORE: process.env.MIN_SCORE || 25
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
  
  setScore: async function(id, score) {
    const query = pgformat('UPDATE posts SET score = %L WHERE id = %L', score, id);
    logger.debug(query);
    return DB.client.query(query);
  },
  
  getAllPosts: async function() {
    return DB.client.query('SELECT * FROM posts').then(res => res.rows);
  },
  
  getPostsForDay: async function(date) {
    const query = pgformat('SELECT * FROM posts WHERE day = %L AND score >= %L ORDER BY score DESC', date.toYYYYMMDD(), config.MIN_SCORE);
    logger.debug(query);
    return DB.client.query(query).then(res => res.rows);
  },
  
  getPostsForWeek: async function(startDate, endDate) {
    const query = pgformat('SELECT * FROM posts WHERE day >= %L AND day < %L AND score >= %L ORDER BY day ASC, score DESC', startDate.toYYYYMMDD(), endDate.toYYYYMMDD(), config.MIN_SCORE);
    logger.debug(query);
    return DB.client.query(query).then(res => res.rows);
  },
  
  insertPosts: async function(posts) {
    logger.info('Adding ' + posts.length + ' new posts to DB');
    const postsAsArray = posts.map(post => ([post.day, post.id, post.title, post.permalink, post.url, post.created_utc, post.score]));
    const query = pgformat('INSERT INTO posts(day, id, title, permalink, url, created_utc, score) VALUES %L ON CONFLICT(id) DO UPDATE SET score = EXCLUDED.score', postsAsArray);
    logger.debug(query);
    //return DB.client.query(query);
  },
  
  subscribeUserToDaily: async function(user) {
    const query = pgformat("INSERT INTO subscriptions(username, type) VALUES (%L, 'daily')", user);
    logger.debug(query);
    return DB.client.query(query);
  },
  
  subscribeUserToWeekly: async function(user) {
    const query = pgformat("INSERT INTO subscriptions(username, type) VALUES (%L, 'weekly')", user);
    logger.debug(query);
    return DB.client.query(query);
  },
  
  unsubscribeUser: async function(user) {
    const query = pgformat("DELETE FROM subscriptions WHERE username = %L", user);
    logger.debug(query);
    return DB.client.query(query);
  },
  
  markDaySent: async function(date) {
    const query = pgformat('UPDATE posts SET daily_sent = true WHERE day = %L', date.toYYYYMMDD());
    logger.debug(query);
    return DB.client.query(query);
  },
  
  purgeDays: async function(startDate, endDate) {
    const query = pgformat('DELETE FROM posts WHERE day >= %L AND day < %L', startDate.toYYYYMMDD(), endDate.toYYYYMMDD());
    logger.debug(query);
    return DB.client.query(query);
  },
  
  init: async function() {
    logger.info('Initializing DB');
    // Connect and create tables
    await DB.client.connect();
    return Promise.all([
      DB.client.query('CREATE TABLE IF NOT EXISTS subscriptions(username TEXT, type TEXT)')
        .then(() => DB.client.query('CREATE INDEX IF NOT EXISTS subscriptions_type_idx ON subscriptions (type)')),
      DB.client.query('CREATE TABLE IF NOT EXISTS posts(day DATE, id TEXT PRIMARY KEY, title TEXT, permalink TEXT, url TEXT, created_utc INT, score INT, daily_sent BOOLEAN DEFAULT FALSE)')
        .then(() => DB.client.query('CREATE INDEX IF NOT EXISTS posts_day_idx ON posts (day)'))
        .then(() => DB.client.query('CREATE INDEX IF NOT EXISTS posts_created_utc_idx ON posts (created_utc)'))
    ]);
  },
  
  close: async function() {
    return DB.client.end();
  }
};

const Template = {
  introDaily: 'Welcome to The Daily Freshness! Fresh /r/hiphopheads posts delivered right to your inbox each day.\n\n',
  introWeekly: 'Welcome to The Weekly Freshness! Fresh /r/hiphopheads posts delivered right to your inbox each week.\n\n',
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
    logger.info('Fetching new posts');
    
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
    logger.info('Previously fetched up to ' + startDate);
    
    // Get any new posts since then and add to posts table in DB
    return DB.insertPosts(await FreshBot.getNewPosts(maxTimeInDB));
  },
  
  processPrivateMessagesForUser: async function(PMs) {
    // Process PMs in order received
    const sortedPMs = PMs.sort((a, b) => { return a.created_utc - b.created_utc; });

    for (let i = 0, len = sortedPMs.length; i < len; i++) {
      const currentPM = sortedPMs[i];
      if (currentPM.subject === 'subscribe' && currentPM.body === 'daily') {
        await DB.subscribeUserToDaily(currentPM.author.name).then(() => currentPM.reply(Template.dailySubSuccess));
        logger.info('Subscribed ' + currentPM.author.name + ' to daily');
      } else if (currentPM.subject === 'subscribe' && currentPM.body === 'weekly') {
        await DB.subscribeUserToWeekly(currentPM.author.name).then(() => currentPM.reply(Template.weeklySubSuccess));
        logger.info('Subscribed ' + currentPM.author.name + ' to weekly');
      } else if (currentPM.subject === 'unsubscribe' && currentPM.body === 'remove') {
        await DB.unsubscribeUser(currentPM.author.name).then(() => currentPM.reply(Template.unsubscribeSuccess));
        logger.info('Unsubscribed ' + currentPM.author.name);
      } else {
        await currentPM.reply(Template.replyToUnknown);
        logger.info('Unhandled private message from ' + currentPM.author.name);
      }
    }
  },
  
  processPrivateMessages: async function() {
    const newMessages = await reddit.getUnreadMessages();
    const newPMs = newMessages.filter(msg => !msg.was_comment);
    
    logger.info('Processing ' + newPMs.length + ' new PMs');
    
    // Group PMs to handle PMs from different users in parallel
    const groupedPMs = newPMs.reduce((r, pm) => { 
      r[pm.author.name] = r[pm.author.name] || [];
      r[pm.author.name].push(pm);
      return r;
    }, Object.create(null));
    
    // Send to each user
    const doneProcessingPMs = [];
    for (var username in groupedPMs) {
      doneProcessingPMs.push(FreshBot.processPrivateMessagesForUser(groupedPMs[username]));
    }
    
    // Mark any messages as read
    if (newMessages.length > 0) {
      doneProcessingPMs.push(reddit.markMessagesAsRead(newMessages));
    }
    
    return Promise.all(doneProcessingPMs);
  },
  
  sendDailyMessages: async function(posts) {
    //TODO
    // Character limit of 40k on self posts, 10k on message, if exceeded add remaining in comments or second message
  },
  
  sendWeeklyMessages: async function(posts) {
    //TODO
  },
  
  makeWeeklyPost: async function(posts) {
    //TODO
  },
  
  generateDailyMessages: async function(endDate) {
    // Generate daily messages to subscribers
    const minUnsentDate = await DB.getMinUnsentDate();
    logger.info('Daily messages sent up to ' + minUnsentDate);
    
    // Check if daily messages needs to be sent
    const sentDaysDone = [];
    for (let dayStart = new Date(minUnsentDate); dayStart.addDays(1).addHours(6) < endDate; dayStart = dayStart.addDays(1)) {
      // We've loaded 6 hours into a new day, send daily messages and post
      const dayEnd = dayStart.addDays(1);
      logger.info('Processing day between ' + dayStart + ' and ' + dayEnd);
      
      // Get days posts and send any messages
      const postsFetched = DB.getPostsForDay(dayStart);
      sentDaysDone.push(postsFetched.then(posts => FreshBot.sendDailyMessages(posts)));
      
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
      logger.info('Processing week between ' + weekStart + ' and ' + weekEnd);
      
      // Get weeks posts, send messages, and post to r/hiphopheads
      const postsFetched = DB.getPostsForWeek(weekStart, weekEnd);
      sentWeeksDone.push(postsFetched.then(posts => FreshBot.sendWeeklyMessages(posts)));
      sentWeeksDone.push(postsFetched.then(posts => FreshBot.makeWeeklyPost(posts)));
      
      // Purge DB of previous week's data
      sentWeeksDone.push(DB.purgeDays(weekStart, weekEnd));
    }
    return Promise.all(sentWeeksDone);
  },
  
  updateScores: async function () {
    // Get all posts and for each check whether the score recorded matches the score currently on reddit
    const posts = await DB.getAllPosts();
    
    const updateDone = [];
    posts.forEach(async post => {
      const newScore = await reddit.getSubmission(posts.id).score;
      if (posts.score !== newScore) {
        // Update the DB with the new score if it didn't match
        updateDone.push(DB.setScore(post.id, newScore));
      }
    });
    
    return Promise.all(updateDone);
  },
  
  start: async function() {
    logger.info('Starting');
    
    // Start up DB connection
    await DB.init();
    
    // 1) Process incoming messages and record any new subscriptions/unsubscriptions. Let all users register before moving on to creating posts/messages
    // 2) Update scores on previously loaded posts
    // 3) Populate new posts into database
    await Promise.all([
      FreshBot.processPrivateMessages(),
      FreshBot.updateScores(),
      FreshBot.fetchNewPosts()
    ]);
    
    const endDate = await DB.getMaxTimestamp().then(ts => new Date(ts * 1000));
    logger.info('Loaded posts up to ' + endDate);
    
    // Wait on days to be completed before moving to week processing as week processing will purge DB
    await FreshBot.generateDailyMessages(endDate);
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