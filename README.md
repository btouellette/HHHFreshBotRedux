# HHHFreshBotRedux

This bot compiles [FRESH] posts submitted to /r/hiphopheads. If you want to subscribe, check out these links! - [[Daily](http://www.reddit.com/message/compose/?to=HHHFreshBotRedux&subject=subscribe&message=daily)] [[Weekly](http://www.reddit.com/message/compose/?to=HHHFreshBotRedux&subject=subscribe&message=weekly)]

Posts are also viewable on this repo's GitHub Pages site: https://btouellette.github.io/HHHFreshBotRedux/

Or on the bot's user page on reddit: https://www.reddit.com/user/HHHFreshBotRedux

### Functionality:
* Saves all [FRESH] posts to database, only posts with +25 score sent out in messages
* Reads messages sent to inbox
	* If it's a subscribe request, it subscribes the user to either the daily or weekly round up (possible to subscribe to both if you send each one once)
	* If it's a unsubscribe request, it unsubscribes the user from both round ups
* Send out the daily round up to all subscribed users
* Send out the weekly round up to all subscribed users
* ~~Post the weekly round up to /r/hiphopheads~~ (bot banned by mods in favor of a closed source fork of hizinfiz's bot)
* Post the weekly round up to /r/HHHFreshBotRedux
* Save the weeks [FRESH] posts to this GitHub repo

Inspired by hizinfiz's [HHHFreshBot](https://github.com/hizinfiz/HHHFreshBot) (in spirit and look if not in code)

### Setup

* Development environment is running in a [cloud9](https://c9.io) test environment upgraded to PostgreSQL 10 and Node 10.12.0 (instructions in app.js)
* Production environment is running on [Heroku](heroku.com) using [Heroku Scheduler](https://devcenter.heroku.com/articles/scheduler)
* When starting the bot up for the first time start within 3-4 days of a Sunday as the Reddit search API will only return the most recent ~250 results and if the results don't go back to the previous Sunday the week calculations will use the earliest day returned as the week start

### License

MIT ([See LICENSE](https://github.com/btouellette/HHHFreshBotRedux/blob/master/LICENSE))
