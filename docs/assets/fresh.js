//TODO: check if media is available and don't add card if not
//TODO: fix reddit HTML escaping of title
//TODO: don't allow multiple embeds to play at once (reload embed/iframe if you click inside another?), consider not using reddit embeds so we get more control over this and sizing
//TODO: filter on score
//TODO: infinite scroll, hash anchor links to days (and to start back where you were), unload previous days after some number of posts?
//TODO: loading indicator (don't infinite scroll while loading)
//TODO: iframe performance? maybe click to generate reddit embed?
//TODO: remember last visit and provide link to that day?
//TODO: https://stackoverflow.com/questions/5315659/jquery-change-hash-fragment-identifier-while-scrolling-down-page

/*global fetch*/
/*global infinity*/
/*global Cookies*/
/*global $*/

Date.prototype.addDays = function (days) {
  const newDate = new Date(this);
  newDate.setDate(newDate.getDate() + days);
  return newDate;
};
Date.prototype.addHours = function (hours) {
  const newDate = new Date(this);
  newDate.setHours(newDate.getHours() + hours);
  return newDate;
};
Date.prototype.toYYYYMMDD = function () {
  return this.toISOString().slice(0,10).replace(/-/g,"");
};
String.prototype.fromYYYYMMDDtoDate = function () {
  return new Date(Date.UTC(this.substring(0, 4), this.substring(4, 6) - 1, this.substring(6, 8)));
};

function debounced(delay, fn) {
  let timerId;
  return function (...args) {
    if (timerId) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      fn(...args);
      timerId = null;
    }, delay);
  };
}

async function findFirstYYYYMMDD() {
    let yyyymmdd = null;
    let currentDate = new Date();
    while (!yyyymmdd) {
        let currentJSON = 'daily/' + currentDate.toYYYYMMDD() + '.json';
        await fetch(currentJSON).then(res => { if(res.ok) { yyyymmdd = currentDate.toYYYYMMDD(); }});
        currentDate = currentDate.addDays(-1);
    }
    console.log(yyyymmdd);
    return yyyymmdd;
}

const $container = $("#embed-container");
const listView = new infinity.ListView($container);

let minScore = Cookies.get('minScore') || 25;
$("#min-score-input").on("keyup keydown change", debounced(1000, function() {
    const newValue = $("#min-score-input").val();
    const oldValue = minScore;
    if (oldValue != newValue) {
        if (newValue > oldValue) {
            $(".grid-item").filter(function() {
                const score = parseInt($(this).data("score"));
                return score > oldValue && score <= newValue;
            }).show();
        } else {
            $(".grid-item").filter(function() {
                const score = parseInt($(this).data("score"));
                return score >= oldValue && score < newValue;
            }).hide();
        }
        minScore = newValue;
        Cookies.set('minScore', newValue);
    }
}));

let firstYYYYMMDD = null;
findFirstYYYYMMDD().then(yyyymmdd => {
    firstYYYYMMDD = yyyymmdd;
    if (window.location.hash) {
        yyyymmdd = window.location.hash.substr(1);
    }
    fetch('daily/' + yyyymmdd + '.json').then(res => {
        if (res.ok) {
            res.json().then(json => {
                console.log(json);
                const dateString = yyyymmdd.fromYYYYMMDDtoDate().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
                const $dayContainer = $(`<div class="day-container"><h2 id="${yyyymmdd}">${dateString}</h2></div>`);
                listView.append($dayContainer);
                json.forEach(post => {
                    //TODO: add these in more slowly (on scroll?) to give embeds in view more time to load properly
                    const $newElement = $(`<div class="grid-item" data-score="${post.score}"${post.score < minScore ? ' style="display: none;"' : ''}><blockquote class="reddit-card" data-card-created="${Math.floor(Date.now() / 1000)}"><a href="https://www.reddit.com${post.permalink}?ref=share&ref_source=embed"></a></blockquote></div>`);
                    listView.append($newElement);
                });
            });
        } else {
            console.log('Request for daily/' + yyyymmdd + '.json failed');
        }
    });
});

$(window).scroll(function() {
   if($(window).scrollTop() + $(window).height() > $(document).height() - 200) {
       alert("near bottom!");
   }
});