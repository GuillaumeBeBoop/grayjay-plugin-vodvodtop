const PLATFORM = "VodVod";
const BASE_URL = "https://vodvod.top";
const API_URL = "https://api.vodvod.top";
// TODO: à confirmer : le Link ("/m3u8/...") est-il servi par api.vodvod.top ou vodvod.top ?
const M3U8_BASE = API_URL;

const RE_CHANNEL = /^https:\/\/vodvod\.top\/channels\/@([^\/?#]+)\/?$/;
const RE_VOD = /^https:\/\/vodvod\.top\/channels\/@([^\/?#]+)\/([0-9a-f-]{36})\/?$/;

let config = {};

source.enable = function (conf) {
    config = conf ?? {};
};

// ---------- Helpers ----------
function httpJson(url) {
    const res = http.GET(url, {}, false);
    if (!res.isOk) throw new ScriptException("Erreur HTTP " + res.code + " sur " + url);
    return JSON.parse(res.body);
}

function channelUrl(login) { return BASE_URL + "/channels/@" + login; }
function vodUrl(login, id) { return channelUrl(login) + "/" + id; }

function validStr(o) { return o && o.Valid ? o.String : ""; }
function validNum(o) { return o && o.Valid ? o.Float64 : 0; }

function authorLink(login, avatar) {
    return new PlatformAuthorLink(
        new PlatformID(PLATFORM, login, config.id), login, channelUrl(login), avatar ?? ""
    );
}

function toChannel(s) {
    const login = s.StreamerLoginAtStart;
    return new PlatformChannel({
        id: new PlatformID(PLATFORM, login, config.id),
        name: login,
        thumbnail: validStr(s.ProfileImageUrlAtStart),
        subscribers: 0,
        description: "",
        url: channelUrl(login),
        links: { Twitch: "https://twitch.tv/" + login }
    });
}

function thumbs(m) {
    const box = validStr(m.BoxArtUrlAtStart).replace("-40x56.", "-285x380.");
    return new Thumbnails(box ? [new Thumbnail(box, 0)] : []);
}

function toVideo(item) {
    const m = item.Metadata;
    const login = m.StreamerLoginAtStart;
    return new PlatformVideo({
        id: new PlatformID(PLATFORM, m.ID, config.id),
        name: m.TitleAtStart || "(sans titre)",
        thumbnails: thumbs(m),
        author: authorLink(login, validStr(m.ProfileImageUrlAtStart)),
        uploadDate: Math.floor(new Date(m.StartTime).getTime() / 1000),
        duration: validNum(m.HlsDurationSeconds),
        viewCount: m.MaxViews ?? 0,
        url: vodUrl(login, m.ID),
        isLive: false
    });
}

function fetchVods(login) {
    return httpJson(API_URL + "/channels/@" + encodeURIComponent(login));
}

// ---------- Pagers ----------
class VodChannelPager extends ChannelPager {
    constructor(results) { super(results, false, {}); }
}
class VodContentPager extends ContentPager {
    constructor(results) { super(results, false, {}); }
}

// ---------- Home / Search ----------
source.getHome = function () {
    return new VodContentPager([]);
};

source.searchSuggestions = function (query) { return []; };

source.getSearchCapabilities = function () {
    return { types: [Type.Feed.Mixed], sorts: [Sort.Chronological], filters: [] };
};

// Le site ne recherche que des streamers
source.search = function (query, type, order, filters) {
    // Le site ne recherche que des streamers : on affiche les VODs du streamer exact,
    // sinon ceux des 3 premiers résultats.
    const streamers = httpJson(API_URL + "/search/" + encodeURIComponent(query));
    const q = query.trim().toLowerCase();
    let picked = streamers.filter(s => s.StreamerLoginAtStart.toLowerCase() === q);
    if (picked.length === 0) picked = streamers.slice(0, 3);

    let videos = [];
    for (const s of picked) {
        try {
            videos = videos.concat(fetchVods(s.StreamerLoginAtStart).map(toVideo));
        } catch (e) {
            log("VodVod: échec pour " + s.StreamerLoginAtStart + " : " + e);
        }
    }
    videos.sort((a, b) => b.uploadDate - a.uploadDate);
    return new VodContentPager(videos);
};

source.searchChannels = function (query) {
    // TODO: confirmer que /search/ est bien sur api.vodvod.top
    const data = httpJson(API_URL + "/search/" + encodeURIComponent(query));
    return new VodChannelPager(data.map(toChannel));
};

// ---------- Channel ----------
source.isChannelUrl = function (url) {
    return RE_CHANNEL.test(url);
};

source.getChannel = function (url) {
    const login = url.match(RE_CHANNEL)[1];
    const vods = fetchVods(login);
    const avatar = vods.map(v => validStr(v.Metadata.ProfileImageUrlAtStart)).find(a => a) ?? "";
    return toChannel({
        StreamerLoginAtStart: login,
        ProfileImageUrlAtStart: { String: avatar, Valid: !!avatar }
    });
};

source.getChannelContents = function (url) {
    const login = url.match(RE_CHANNEL)[1];
    return new VodContentPager(fetchVods(login).map(toVideo));
};

// ---------- Video ----------
source.isContentDetailsUrl = function (url) {
    return RE_VOD.test(url);
};

source.getContentDetails = function (url) {
    const [, login, id] = url.match(RE_VOD);
    const item = fetchVods(login).find(v => v.Metadata.ID === id);
    if (!item) throw new ScriptException("VOD introuvable : " + id);

    const base = toVideo(item);
    const m3u8 = M3U8_BASE + item.Link;
    const m = item.Metadata;

    return new PlatformVideoDetails({
        id: base.id, name: base.name, thumbnails: base.thumbnails,
        author: base.author, uploadDate: base.uploadDate, duration: base.duration,
        viewCount: base.viewCount, url: url, isLive: false,
        description: (m.GameNameAtStart ? "Jeu : " + m.GameNameAtStart + "\n" : "")
                   + "Langue : " + (m.LanguageAtStart ?? "?"),
        video: new VideoSourceDescriptor([
            new HLSSource({ name: "HLS", duration: base.duration, url: m3u8 })
        ])
    });
};
