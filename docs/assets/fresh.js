//TODO: check if media is available and don't add card if not
//TODO: unload previous days after some number of posts?
//TODO: remember last visit and provide link to that day?

/*global fetch*/
/*global history*/
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

function getYoutubeID(url){
    var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#\&\?\/]*).*/;
    var match = url.match(regExp);
    if (!match || match[7].length !== 11) {
        console.log('Failed to extract Youtube ID from ' + url);
        return false;
    }
    return match[7];
}

function getScoreDataAttr(post) {
    return `data-score="${post.score}"${post.score < minScore ? ' style="display: none;"' : ''}`;
}

function replaceYoutubeWithIFrame() {
    var iframe = document.createElement("iframe");
    var embed = "https://www.youtube.com/embed/ID?autoplay=1";
    iframe.setAttribute("src", embed.replace("ID", this.dataset.id));
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("allowfullscreen", "1");
    this.parentNode.style.backgroundColor = 'transparent';
    this.parentNode.replaceChild(iframe, this);
}

function replaceSoundcloudWithIframe(newHTML, wrapper) {
    wrapper.parentNode.style.backgroundColor = 'transparent';
    $(wrapper).replaceWith($(newHTML));
}

function removeFreshTag(title) {
    var regExp = /[\[\(\{]\s*FRESH.*?[\]\)\}]\s*(.*)/;
    var match = title.match(regExp);
    if (!match || !match.length > 0) {
        return title.trim();
    }
    return match[1].trim();
}

async function findFirstYYYYMMDD() {
    let yyyymmdd = null;
    let currentDate = new Date();
    while (!yyyymmdd) {
        let currentJSON = 'daily/' + currentDate.toYYYYMMDD() + '.json';
        await fetch(currentJSON).then(res => { if(res.ok) { yyyymmdd = currentDate.toYYYYMMDD(); }});
        currentDate = currentDate.addDays(-1);
    }
    return yyyymmdd;
}

let firstYYYYMMDD = null, lastYYYYMMDD = null;
const $container = $("#embed-container");
let minScore = parseInt(Cookies.get('minScore'), 10) || 25;

$("#min-score-input").val(minScore);
$("#min-score-input").on("keyup keydown change", debounced(1000, function() {
    const newValue = parseInt($("#min-score-input").val(), 10);
    const oldValue = minScore;
    if (oldValue != newValue) {
        if (newValue < oldValue) {
            $(".grid-item").filter(function() {
                const score = parseInt($(this).data("score"), 10);
                return score >= newValue && score < oldValue;
            }).show();
        } else {
            $(".grid-item").filter(function() {
                const score = parseInt($(this).data("score"), 10);
                return score > oldValue && score <= newValue;
            }).hide();
        }
        minScore = newValue;
        Cookies.set('minScore', newValue);
    }
}));

let isPopulating = false;
function populatePage(yyyymmdd) {
    isPopulating = true;
    // Spinner disabled for now as this loads very fast
    // $container.append($('<div class="spinner-container"><div class="spinner"><div class="bounce1"></div><div class="bounce2"></div><div class="bounce3"></div></div></div>'));
    fetch('daily/' + yyyymmdd + '.json').then(res => {
        if (res.ok) {
            res.json().then(json => {
                lastYYYYMMDD = yyyymmdd;
                
                const dateString = yyyymmdd.fromYYYYMMDDtoDate().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
                const $dayContainer = $(`<div class="day-container"><h2 id="${yyyymmdd}">${dateString}</h2></div>`);
                $container.append($dayContainer);
                
                json.forEach(post => {
                    //TODO: if wrapper fails add reddit embed
                    const wrapStart = `<div class="grid-item" ${getScoreDataAttr(post)}><div class="embedly-card"><div class="embedly-card-hug">`;
                    const wrapEnd = '</div></div></div>';
                    
                    if (post.url.includes('youtube.com') || post.url.includes('youtu.be')) {
                        
                        // YouTube embeds
                        //TODO: if fetch on thumbnail fails don't add to list
                        const ytID = getYoutubeID(post.url);
                        const $newElement = $(wrapStart + `<div class="player youtube-player" data-id="${ytID}"><div data-id="${ytID}"><span>${removeFreshTag(post.title)}</span><img src="https://i.ytimg.com/vi/${ytID}/hqdefault.jpg"><div class="play"></div></div></div>` + wrapEnd);
                        $container.append($newElement);
                        $newElement.find('.youtube-player > div').on('click', replaceYoutubeWithIFrame);
                        
                    } else if (post.url.includes('soundcloud.com')) {
                        
                        const widget_options = '';
                        $.getJSON('https://soundcloud.com/oembed.json?url=' + post.url + widget_options)
                         .done(function (oembedData) { 
                            if (oembedData.thumbnail_url.includes('placeholder')) {
                                const soundcloudClientID = 'LvWovRaJZlWCHql0bISuum8Bd2KX79mb';
                                $.getJSON(`https://api.soundcloud.com/resolve.json?client_id=${soundcloudClientID}&url=${post.url}`)
                                 .done(function (resolveData) {
                                    $.getJSON(`https://api.soundcloud.com/${resolveData.kind}s/${resolveData.id}?client_id=${soundcloudClientID}`)
                                     .done(function (trackData) {
                                        let artwork_url = trackData.artwork_url;
                                        let count = 0;
                                        while (!artwork_url && trackData.tracks && count < trackData.tracks.length) {
                                            artwork_url = trackData.tracks[count].artwork_url;
                                            count++;
                                        }
                                        //TODO: see if we can get higher res images here from URL manipulation
                                        artwork_url = artwork_url || oembedData.thumbnail_url;
                                        const $newElement = $(wrapStart + `<div class="player soundcloud-player"><div><span>${removeFreshTag(post.title)}</span><img src="${artwork_url}"><div class="play"></div></div></div>` + wrapEnd);
                                        $container.append($newElement);
                                        $newElement.find('.soundcloud-player > div').on('click', function() { replaceSoundcloudWithIframe(oembedData.html, this); });
                                    });
                                });
                            } else {
                                const $newElement = $(wrapStart + `<div class="player soundcloud-player"><div><span>${removeFreshTag(post.title)}</span><img src="${oembedData.thumbnail_url}"><div class="play"></div></div></div>` + wrapEnd);
                                $container.append($newElement);
                                $newElement.find('.soundcloud-player > div').on('click', function() { replaceSoundcloudWithIframe(oembedData.html, this); });
                            }
                         });
                         
                    } else {
                        
                        // Spotify API access to get album artwork requires user authorization
                        // Bandcamp, Datpiff, iTunes no public APIs but could scrape with server side code (if there was any)
                        
                        // Reddit embeds for everything else (these are much more expensive)
                        const $newElement = $(`<div class="grid-item" ${getScoreDataAttr(post)}><blockquote class="reddit-card" data-card-created="${Math.floor(Date.now() / 1000)}"><a href="https://www.reddit.com${post.permalink}?ref=share&ref_source=embed"></a></blockquote></div>`);
                        $container.append($newElement);
                        
                    }
                });
                $('.spinner').remove();
                isPopulating = false;
            });
        } else {
            console.log('Request for daily/' + yyyymmdd + '.json failed');
            const $dayContainer = $(`<div class="day-container"><h2 id="${yyyymmdd}">End of archived posts</h2></div>`);
            $container.append($dayContainer);
            // $('.spinner').remove();
        }
    });
}

findFirstYYYYMMDD().then(yyyymmdd => {
    firstYYYYMMDD = yyyymmdd;
    if (window.location.hash && window.location.hash.substr(1) !== firstYYYYMMDD) {
        yyyymmdd = window.location.hash.substr(1);
        //TODO: add back button to load previous page
    }
    populatePage(yyyymmdd);
});

$(window).scroll(function() {
    if(!isPopulating && $(window).scrollTop() + $(window).height() > $(document).height() - 400) {
        let yyyymmdd = lastYYYYMMDD.fromYYYYMMDDtoDate().addDays(-1).toYYYYMMDD();
        populatePage(yyyymmdd);
    }
   
   // Set hash based on which header we are below, don't add to history
    var st = window.pageYOffset || document.documentElement.scrollTop;
    var dayTops = $('.day-container > h2').map(function(){ return { top: $(this).offset().top, id: $(this).attr('id') }}).get();
    for(let i = 0, len = dayTops.length; i < len; i++) {
        if (i == 0 && st < dayTops[0].top) {
            if (window.location.hash !== '') {
                history.replaceState(null, null, ' ');
            }
            break;
        } else if (i == len - 1 || st > dayTops[i].top && st < dayTops[i + 1].top) {
            if (window.location.hash !== '#' + dayTops[i].id) {
                history.replaceState(null, null, '#' + dayTops[i].id);
            }
            break;
        }
    }
});