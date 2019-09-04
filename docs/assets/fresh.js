//TODO: check if media is available and don't add card if not
//TODO: unload previous days after some number of posts? (windowing)
//TODO: remember last visit and provide link to that day?
//TODO: skip loading of JSON for days that are seen if hideSeen option selected
//TODO: if hideSeen disabled show hidden days (load back in if previous TODO implemented first)

/*global fetch*/
/*global history*/
/*global Cookies*/
/*global $*/
/*global localStorage*/

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
    // matches:
    // https://m.youtube.com/watch?v=88H9gvfVfIU
    // https://youtu.be/uH9m5CVqAiE?t=1
    // https://youtu.be/4cSsBkp7ziw
    // https://www.youtube.com/watch?v=xgC3MdDvJy4&feature=youtu.be
    // https://www.youtube.com/watch?v=RQI2K5B9sTc
    // https://www.youtube.com/watch?time_continue=1&v=Izb8iXWqHTs
    // https://www.youtube.com/watch?v=2-VWwF2yn_U&frags=pl%2Cwn
    // https://www.youtube.com/watch?v=fzV_QZODisQ&ab_channel=LilPeep
    // https://www.youtube.com/watch?v=LOBv-1-6cNw&fbclid=IwAR2zPvBp8suY16QKDmsIkvHWk1pUmarxOTqI0S_FDA-z-MdITOXxcxlF6Ps
    // https://www.youtube.com/watch?t=0s&v=dDpkiptRHAw&list=PL2vg1YHilh9DxS9KFyTV_A5Hf0c6cEGfk&index=5
    // https://m.youtube.com/watch?v=11k_oYjTP2k#menu
    // https://www.youtube.com/attribution_link?a=XwwV8HCz3YU&u=%2Fwatch%3Fv%3D2Y6COHwwTQc%26feature%3Dshare

    var regExp = /^.*youtu(?:be\.com|\.be)\/(?:.*(?:&|\?)[va]=([^&#]*)|([^?#]*)).*$/;
    var match = url.match(regExp);
    if (!match || (match[1] || match[2]).length !== 11) {
        console.log('Failed to extract Youtube ID from ' + url);
        return false;
    }
    return match[1] || match[2];
}

function getYoutubePlaylist(url) {
    var regExp = /^.*youtu(?:be\.com|\.be)\/.*(?:&|\?)list=([^&#]*).*$/;
    var match = url.match(regExp);
    if (!match) {
        return false;
    }
    return match[1];
}

function getScoreDataAttr(post) {
    return `data-score="${post.score}"${post.score < minScore ? ' style="display: none;"' : ''}`;
}

function replaceYoutubeWithIFrame(e, wrapper, url) {
    if (e.which == 2) {
        window.open(url);
    } else if (e.which == 1) {
        const iframe = document.createElement("iframe");
        let embed = `https://www.youtube.com/embed/${wrapper.dataset.id}?autoplay=1`;
        const playlist = getYoutubePlaylist(url);
        if (playlist) {
            embed += '&list=' + playlist;
        }
        iframe.setAttribute("src", embed);
        iframe.setAttribute("frameborder", "0");
        iframe.setAttribute("allowfullscreen", "1");
        wrapper.parentNode.style.backgroundColor = 'transparent';
        wrapper.parentNode.replaceChild(iframe, wrapper);
    }
}

function replaceSoundcloudWithIframe(e, newHTML, wrapper, url) {
    if (e.which == 2) {
        window.open(url);
    } else if (e.which == 1) {
        wrapper.parentNode.style.backgroundColor = 'transparent';
        $(wrapper).replaceWith($(newHTML));
    }
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


let hideSeen = Cookies.get('hideSeen') === "true" || false;
$('#hide-seen-checkbox').prop('checked', hideSeen);
$('#hide-seen-checkbox').change(function() {
    hideSeen = this.checked;
    Cookies.set('hideSeen', hideSeen);
});

let isPopulating = false;
function populatePage(yyyymmdd, prepend) {
    isPopulating = true;
    $container.append($('<div class="spinner-container"><div class="spinner"><div class="bounce1"></div><div class="bounce2"></div><div class="bounce3"></div></div></div>'));
    fetch('daily/' + yyyymmdd + '.json').then(res => {
        if (res.ok) {
            res.json().then(json => {
                lastYYYYMMDD = yyyymmdd;

                const dateString = yyyymmdd.fromYYYYMMDDtoDate().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
                const $dayContainer = $(`<div class="day-container"><h2 id="${yyyymmdd}">${dateString}</h2></div>`);
                if (prepend) {
                    $container.prepend($dayContainer);
                } else {
                    $container.append($dayContainer);
                }
                
                // Hide this container if the option is selected and it has already been seen
                if (hideSeen && localStorage.getItem('#' + yyyymmdd)) {
                    $dayContainer.hide();
                } else {
                    json.forEach(post => {
                        //TODO: if wrapper fails add reddit embed
                        const wrapStart = `<div class="grid-item" ${getScoreDataAttr(post)}><div class="embedly-card"><div class="embedly-card-hug">`;
                        const wrapEnd = '</div></div></div>';
    
                        if (post.url.includes('youtube.com') || post.url.includes('youtu.be')) {
    
                            // YouTube embeds
                            //TODO: if fetch on thumbnail fails don't add to list
                            const ytID = getYoutubeID(post.url);
                            const $newElement = $(wrapStart + `<div class="player youtube-player" data-id="${ytID}"><div data-id="${ytID}"><span>${removeFreshTag(post.title)}</span><img src="https://i.ytimg.com/vi/${ytID}/hqdefault.jpg"><div class="play"></div></div></div>` + wrapEnd);
                            $dayContainer.append($newElement);
                            $newElement.find('.youtube-player > div').on('mousedown', function(e) { replaceYoutubeWithIFrame(e, this, post.url); });
    
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
                                            $dayContainer.append($newElement);
                                            $newElement.find('.soundcloud-player > div').on('mousedown', function(e) { replaceSoundcloudWithIframe(e, oembedData.html, this, post.url); });
                                        });
                                    });
                                } else {
                                    const $newElement = $(wrapStart + `<div class="player soundcloud-player"><div><span>${removeFreshTag(post.title)}</span><img src="${oembedData.thumbnail_url}"><div class="play"></div></div></div>` + wrapEnd);
                                    $dayContainer.append($newElement);
                                    $newElement.find('.soundcloud-player > div').on('mousedown', function(e) { replaceSoundcloudWithIframe(e, oembedData.html, this, post.url); });
                                }
                             });
    
                        } else {
    
                            // Spotify API access to get album artwork requires user authorization
                            // Bandcamp, Datpiff, iTunes no public APIs but could scrape with server side code (if there was any)
    
                            // Reddit embeds for everything else (these are much more expensive since they typically embed reddit and then a third party site as well)
                            const $newElement = $(`<div class="grid-item" ${getScoreDataAttr(post)}><blockquote class="reddit-card" data-card-created="${Math.floor(Date.now() / 1000)}"><a href="https://www.reddit.com${post.permalink}?ref=share&ref_source=embed"></a></blockquote></div>`);
                            $dayContainer.append($newElement);
    
                        }
                    });
                }
                $('.spinner').remove();
                isPopulating = false;
                // If there is no scroll bar go ahead and explicitly trigger a scroll to load the next day
                if (!prepend && $(document).height() <= $(window).height()) {
                    // Trigger the scroll event
                    $(window).scroll();
                }
            });
        } else {
            console.log('Request for ' + yyyymmdd + '.json failed');
            const $dayContainer = $(`<div class="day-container"><h2 id="${yyyymmdd}">End of archived posts</h2></div>`);
            if (prepend) {
                $container.prepend($dayContainer);
            } else {
                $container.append($dayContainer);
            }
            $('.spinner').remove();
        }
    });
}

findFirstYYYYMMDD().then(yyyymmdd => {
    firstYYYYMMDD = yyyymmdd;
    if (window.location.hash && window.location.hash.substr(1) !== firstYYYYMMDD) {
        yyyymmdd = window.location.hash.substr(1);
        const $button = $('<div class="back-btn-wrapper"><button class="btn back-btn">Load up</button></div>');
        $('#main-wrapper').prepend($button);
        $button.on('click', function() {
            const currentFirstYYYYMMDD = $('.day-container > h2')[0].id;
            const yyyymmddForward = currentFirstYYYYMMDD.fromYYYYMMDDtoDate().addDays(1).toYYYYMMDD();
            this.firstChild.blur();
            if (yyyymmddForward === firstYYYYMMDD) {
                $(this).remove();
            }
            populatePage(yyyymmddForward, true);
        });
    }
    populatePage(yyyymmdd);
});

$(window).scroll(function() {
    if (!isPopulating && $(window).scrollTop() + $(window).height() > $(document).height() - 400) {
        let yyyymmdd = lastYYYYMMDD.fromYYYYMMDDtoDate().addDays(-1).toYYYYMMDD();
        populatePage(yyyymmdd);
    }

   // Set hash based on which header we are below, don't add to history
    var st = window.pageYOffset || document.documentElement.scrollTop;
    var dayTops = $('.day-container > h2').map(function(){ return { top: $(this).offset().top, id: $(this).attr('id') }}).get();
    for (let i = 0, len = dayTops.length; i < len; i++) {
        if (i == 0 && st < dayTops[0].top) {
            if (window.location.hash !== '') {
                localStorage.setItem(window.location.hash, true);
                history.replaceState(null, null, ' ');
            }
            break;
        } else if (i == len - 1 || st > dayTops[i].top && st < dayTops[i + 1].top) {
            if (window.location.hash !== '#' + dayTops[i].id) {
                if (window.location.hash !== '') {
                    localStorage.setItem(window.location.hash, true);
                }
                history.replaceState(null, null, '#' + dayTops[i].id);
            }
            break;
        }
    }
});