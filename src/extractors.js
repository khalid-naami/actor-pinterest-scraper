/**
 * Pinterest Ultimate Scraper - Extractors & Parsers
 * High-speed parsing for Pins, Boards, Profiles, Outbound Links, and Video MP4s.
 */

const ENTITY_MAP = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    middot: '·',
};

export function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&([a-zA-Z]+);/g, (full, name) => ENTITY_MAP[name.toLowerCase()] ?? full)
        .replace(/&#(\d+);/g, (full, dec) => {
            const cp = Number.parseInt(dec, 10);
            return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (full, hex) => {
            const cp = Number.parseInt(hex, 16);
            return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
        });
}

export function sanitizeRecord(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => sanitizeRecord(item))
            .filter((item) => item !== null && item !== undefined);
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === null || v === undefined) continue;
            if (Array.isArray(v)) {
                out[k] = sanitizeRecord(v);
            } else if (typeof v === 'object') {
                out[k] = sanitizeRecord(v);
            } else {
                out[k] = v;
            }
        }
        return out;
    }
    return value;
}

export function parseCompactNumber(raw) {
    if (raw === null || raw === undefined) return undefined;
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? Math.trunc(raw) : undefined;
    }
    const str = String(raw).trim().replace(/,/g, '').replace(/\+/g, '');
    if (!str) return undefined;
    const m = str.match(/^(\d+(?:\.\d+)?)\s*([kmb])?$/i);
    if (!m) {
        const digits = str.replace(/[^\d]/g, '');
        return digits ? Number.parseInt(digits, 10) : undefined;
    }
    const base = Number.parseFloat(m[1]);
    if (!Number.isFinite(base)) return undefined;
    const unit = (m[2] || '').toUpperCase();
    const mult = unit === 'B' ? 1e9 : unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1;
    return Math.round(base * mult);
}

export function extractMetaContent(html, key) {
    if (!html || typeof html !== 'string') return undefined;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexes = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
    ];
    for (const re of regexes) {
        const m = html.match(re);
        if (m && m[1]) return decodeHtmlEntities(m[1]).trim();
    }
    return undefined;
}

export function isPinterestBlocked(html, statusCode = 200) {
    if (statusCode === 403 || statusCode === 429) return true;
    if (!html || typeof html !== 'string') return true;
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
    if (/^(?:just a moment\.{0,3}|access denied|attention required|verify you are human)/i.test(title)) {
        return true;
    }
    return false;
}

export function extractEmails(text) {
    if (!text || typeof text !== 'string') return [];
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const matches = text.match(emailRegex) || [];
    const ignored = ['pinterest.com', 'pinimg.com', 'example.com', 'sentry.io'];
    const unique = [...new Set(matches.map((m) => m.trim().toLowerCase()))];
    return unique.filter((e) => !ignored.some((d) => e.endsWith(`@${d}`)));
}

export function extractPhones(text) {
    if (!text || typeof text !== 'string') return [];
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,5}/g;
    const matches = text.match(phoneRegex) || [];
    const valid = matches
        .map((p) => p.trim())
        .filter((p) => {
            const digits = p.replace(/\D/g, '');
            return digits.length >= 8 && digits.length <= 15;
        });
    return [...new Set(valid)];
}

export function extractHashtags(text) {
    if (!text || typeof text !== 'string') return [];
    const hashRegex = /#([a-zA-Z0-9_]+)/g;
    const matches = text.match(hashRegex) || [];
    return [...new Set(matches.map((h) => h.replace('#', '')))];
}

// Extract Pinterest embedded SSR JSON State (__PWS_INITIAL_PROPS__ first, legacy __PWS_DATA__ fallback)
export function extractPwsData(html) {
    if (!html || typeof html !== 'string') return null;

    const scriptPatterns = [
        /<script\s+[^>]*id=["']__PWS_INITIAL_PROPS__["'][^>]*>([\s\S]*?)<\/script>/i,
        /<script\s+[^>]*id=["']__PWS_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
        /<script\s+[^>]*data-test-id=["']relay-response["'][^>]*>([\s\S]*?)<\/script>/i,
    ];

    let mergedReduxState = null;
    for (const re of scriptPatterns) {
        const match = html.match(re);
        if (!match || !match[1]) continue;
        try {
            const parsed = JSON.parse(match[1]);
            const redux = parsed?.initialReduxState || parsed?.props?.initialReduxState;
            if (redux && typeof redux === 'object') {
                mergedReduxState = redux;
                return {
                    ...parsed,
                    initialReduxState: redux,
                    props: { ...(parsed.props || {}), initialReduxState: redux },
                };
            }
        } catch {
            // ignore malformed JSON
        }
    }

    // Fallback: window.__INITIAL_DATA__
    try {
        const initMatch = html.match(/window\.__INITIAL_DATA__\s*=\s*({[\s\S]*?});/);
        if (initMatch && initMatch[1]) {
            const parsed = JSON.parse(initMatch[1]);
            const redux = parsed?.initialReduxState || parsed?.props?.initialReduxState || parsed;
            return {
                ...parsed,
                initialReduxState: redux,
                props: { ...(parsed.props || {}), initialReduxState: redux },
            };
        }
    } catch {
        // ignore
    }

    return mergedReduxState ? { initialReduxState: mergedReduxState } : null;
}

export function getReduxState(pwsData) {
    return pwsData?.initialReduxState || pwsData?.props?.initialReduxState || null;
}

export function extractJsonLd(html) {
    if (!html || typeof html !== 'string') return [];
    const blocks = [];
    const regex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        try {
            const parsed = JSON.parse(match[1]);
            if (Array.isArray(parsed)) blocks.push(...parsed);
            else if (parsed && Array.isArray(parsed['@graph'])) blocks.push(...parsed['@graph']);
            else if (parsed && typeof parsed === 'object') blocks.push(parsed);
        } catch {
            // ignore invalid ld+json
        }
    }
    return blocks;
}

export function getOriginalImageUrl(url) {
    if (!url || typeof url !== 'string') return undefined;
    return url.replace(/\/(236x|474x|736x|564x)\//, '/originals/');
}

function safeDomain(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return undefined;
    try {
        return new URL(urlStr).hostname.replace(/^www\./, '');
    } catch {
        return undefined;
    }
}

// Parse a single Pin Object (from PinResource, BaseSearchResource, BoardFeedResource, UserPinsResource, or SSR Redux)
export function parsePinData(pinObj) {
    if (!pinObj || typeof pinObj !== 'object' || !pinObj.id) return null;

    const id = String(pinObj.id);
    const title = decodeHtmlEntities(
        String(
            pinObj.title?.trim()
            || pinObj.grid_title?.trim()
            || pinObj.rich_metadata?.title?.trim()
            || pinObj.seo_title?.trim()
            || ''
        )
    ).trim();

    const description = decodeHtmlEntities(
        String(
            pinObj.closeup_unified_description?.trim()
            || pinObj.description?.trim()
            || pinObj.rich_metadata?.description?.trim()
            || pinObj.auto_alt_text?.trim()
            || ''
        )
    ).trim();

    const rawOutbound = pinObj.link || pinObj.rich_metadata?.url || undefined;
    const outboundUrl = (rawOutbound && /^https?:\/\//i.test(rawOutbound)) ? rawOutbound : undefined;
    const domain = (pinObj.domain && pinObj.domain !== 'Uploaded by user' ? String(pinObj.domain) : undefined)
        || safeDomain(outboundUrl)
        || (pinObj.domain ? String(pinObj.domain) : undefined);

    const rawSaves = pinObj.repin_count
        || pinObj.aggregated_pin_data?.aggregated_stats?.saves
        || pinObj.save_count
        || 0;
    const saveCount = parseCompactNumber(rawSaves) ?? 0;
    const commentsCount = parseCompactNumber(
        pinObj.comment_count ?? pinObj.aggregated_pin_data?.comment_count ?? 0
    ) ?? 0;

    let imageUrl;
    const images = {};

    if (pinObj.images && typeof pinObj.images === 'object') {
        if (pinObj.images.orig?.url) images.original = pinObj.images.orig.url;
        if (pinObj.images['736x']?.url) images.high = pinObj.images['736x'].url;
        if (pinObj.images['474x']?.url) images.medium = pinObj.images['474x'].url;
        if (pinObj.images['236x']?.url) images.thumbnail = pinObj.images['236x'].url;
        imageUrl = images.original || images.high || images.medium || images.thumbnail;
    }

    if (!imageUrl && pinObj.image_large_url) {
        imageUrl = getOriginalImageUrl(pinObj.image_large_url);
        if (imageUrl) images.original = imageUrl;
    }

    let isVideo = Boolean(pinObj.is_video || (pinObj.videos && typeof pinObj.videos === 'object'));
    let videoUrl;

    const vList = pinObj.videos?.video_list || pinObj.story_pin_data?.pages?.[0]?.blocks?.[0]?.video?.video_list;
    if (vList && typeof vList === 'object') {
        const mp4Candidates = Object.values(vList).filter((v) => v?.url && String(v.url).includes('.mp4'));
        const bestVideo = vList.V_720P || mp4Candidates[0] || vList.V_EXP7 || vList.V_HLSV4 || Object.values(vList)[0];
        if (bestVideo?.url) {
            videoUrl = bestVideo.url;
            isVideo = true;
        }
    }

    const pinner = pinObj.pinner || pinObj.native_creator || {};
    const author = pinner.username ? String(pinner.username) : undefined;
    const authorName = pinner.full_name || pinner.first_name || author || undefined;
    const authorAvatarUrl = pinner.image_large_url || pinner.image_medium_url || pinner.image_small_url || undefined;
    const authorFollowers = parseCompactNumber(pinner.follower_count);

    const board = pinObj.board || {};
    const boardName = board.name ? decodeHtmlEntities(String(board.name)) : undefined;
    const boardUrl = board.url
        ? (String(board.url).startsWith('http') ? board.url : `https://www.pinterest.com${board.url}`)
        : undefined;
    const boardPinsCount = parseCompactNumber(board.pin_count);

    const price = pinObj.rich_metadata?.price_value !== null && pinObj.rich_metadata?.price_value !== undefined
        ? String(pinObj.rich_metadata.price_value)
        : undefined;
    const currency = pinObj.rich_metadata?.price_currency ? String(pinObj.rich_metadata.price_currency) : undefined;

    const emails = extractEmails(`${title} ${description}`);
    const phones = extractPhones(`${title} ${description}`);
    const hashtags = extractHashtags(description);

    return sanitizeRecord({
        type: 'PIN',
        id,
        url: `https://www.pinterest.com/pin/${id}/`,
        title: title || undefined,
        description: description || undefined,
        imageUrl,
        images: Object.keys(images).length > 0 ? images : undefined,
        isVideo,
        videoUrl,
        outboundUrl,
        domain,
        saveCount,
        commentsCount,
        author,
        authorName,
        authorUrl: author ? `https://www.pinterest.com/${author}/` : undefined,
        authorAvatarUrl,
        authorFollowers,
        boardName,
        boardUrl,
        boardPinsCount,
        price,
        currency,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        email: emails[0],
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        createdAt: pinObj.created_at ? String(pinObj.created_at) : undefined,
        scrapedAt: new Date().toISOString(),
    });
}

// Parse Pin from HTML Fallback (SocialMediaPosting JSON-LD + Relay hydration + meta tags)
export function parsePinHtmlFallback(html, url = '') {
    if (!html || isPinterestBlocked(html)) return null;

    const idMatch = url.match(/\/pin\/(?:[^/]*?-)?(\d+)/i);
    const pinId = idMatch ? idMatch[1] : undefined;
    if (!pinId) return null;

    const jsonLds = extractJsonLd(html);
    const pinLd = jsonLds.find((j) => j?.['@type'] === 'SocialMediaPosting' || j?.['@type'] === 'ImageObject') || {};

    let title = decodeHtmlEntities(String(pinLd.headline || pinLd.name || '')).trim();
    let description = decodeHtmlEntities(String(pinLd.articleBody || pinLd.description || '')).trim();
    let imageUrl = typeof pinLd.image === 'string' ? pinLd.image : pinLd.image?.contentUrl;

    if (!title) {
        const rawTitle = extractMetaContent(html, 'og:title')
            || decodeHtmlEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
        title = rawTitle.replace(/\s*\|\s*Pinterest.*$/i, '').trim();
    }
    if (!description) {
        description = extractMetaContent(html, 'og:description') || extractMetaContent(html, 'description') || '';
    }
    if (!imageUrl) {
        imageUrl = extractMetaContent(html, 'og:image');
    }

    if (imageUrl) {
        imageUrl = getOriginalImageUrl(imageUrl);
    }

    // Extract stats from JSON-LD interactionStatistic or Relay hydrated JSON
    let saveCount = 0;
    const statsArr = Array.isArray(pinLd.interactionStatistic)
        ? pinLd.interactionStatistic
        : (pinLd.interactionStatistic ? [pinLd.interactionStatistic] : []);
    const likeStat = statsArr.find((s) => String(s?.name || '').includes('Like') || String(s?.description || '').includes('Save'));
    if (likeStat?.userInteractionCount !== undefined) {
        saveCount = parseCompactNumber(likeStat.userInteractionCount) ?? 0;
    } else {
        const savesMatch = html.match(/"aggregatedStats"\s*:\s*\{\s*"saves"\s*:\s*(\d+)/);
        if (savesMatch) saveCount = Number.parseInt(savesMatch[1], 10);
    }

    const commentMatch = html.match(/"commentCount"\s*:\s*(\d+)/);
    const commentsCount = commentMatch ? Number.parseInt(commentMatch[1], 10) : 0;

    // Video check
    const videoMatch = html.match(/"url"\s*:\s*"(https:\/\/[^"]+\.mp4[^"]*)"/);
    const videoUrl = videoMatch ? videoMatch[1].replace(/\\u0026/g, '&') : undefined;
    const isVideo = Boolean(videoUrl || html.includes('"video_list"'));

    // Outbound link
    let outboundUrl = pinLd.sharedContent?.url ? decodeHtmlEntities(String(pinLd.sharedContent.url)) : undefined;
    if (!outboundUrl) {
        const linkMatch = html.match(/"link"\s*:\s*"(https?:\/\/[^"]+)"/);
        if (linkMatch && !linkMatch[1].includes('pinterest.com')) {
            outboundUrl = linkMatch[1].replace(/\\u0026/g, '&');
        }
    }
    const domain = safeDomain(outboundUrl);

    const authorName = pinLd.author?.name ? decodeHtmlEntities(String(pinLd.author.name)).trim() : undefined;
    const author = pinLd.author?.alternateName ? String(pinLd.author.alternateName).trim() : undefined;
    const authorUrl = pinLd.author?.url || (author ? `https://www.pinterest.com/${author}/` : undefined);

    const emails = extractEmails(`${title} ${description}`);
    const phones = extractPhones(`${title} ${description}`);
    const hashtags = extractHashtags(description);

    return sanitizeRecord({
        type: 'PIN',
        id: pinId,
        url: `https://www.pinterest.com/pin/${pinId}/`,
        title: title || undefined,
        description: description || undefined,
        imageUrl,
        isVideo,
        videoUrl,
        outboundUrl,
        domain,
        saveCount,
        commentsCount,
        author,
        authorName,
        authorUrl,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        email: emails[0],
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        createdAt: pinLd.datePublished ? String(pinLd.datePublished) : undefined,
        scrapedAt: new Date().toISOString(),
    });
}

// Parse Board Data (uses PWS initialReduxState.boards / BoardResource first, HTML meta fallback)
export function parseBoardData(html, url = '', pwsData = null) {
    if (!html || isPinterestBlocked(html)) return null;

    const redux = getReduxState(pwsData);
    const boardFromRedux = Object.values(redux?.boards || {}).find((b) => b && b.id) || {};
    const boardResourceVal = Object.values(redux?.resources?.BoardResource || {})[0]?.data || {};
    const boardObj = boardFromRedux.id ? boardFromRedux : boardResourceVal;

    const pathMatch = url.match(/pinterest\.com\/([^/?#]+)\/([^/?#]+)/i);
    const fallbackSlug = pathMatch ? `${pathMatch[1]}/${pathMatch[2]}` : undefined;

    const id = boardObj.id ? String(boardObj.id) : fallbackSlug;
    let title = boardObj.name
        ? decodeHtmlEntities(String(boardObj.name)).trim()
        : (extractMetaContent(html, 'og:title') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    title = title.replace(/\s*\|\s*Pinterest.*$/i, '').trim();

    const description = boardObj.description
        ? decodeHtmlEntities(String(boardObj.description)).trim()
        : (extractMetaContent(html, 'og:description') || extractMetaContent(html, 'description') || '');

    const rawCover = boardObj.image_cover_hd_url
        || boardObj.image_cover_url
        || boardObj.image_thumbnail_url
        || extractMetaContent(html, 'og:image');
    const coverUrl = getOriginalImageUrl(rawCover);

    const countMatch = html.match(/(\d[\d,\s]*)\s+Pins?/i);
    const pinsCount = parseCompactNumber(boardObj.pin_count)
        ?? (countMatch ? parseCompactNumber(countMatch[1]) : undefined)
        ?? 0;

    const owner = boardObj.owner || {};
    const author = owner.username || pathMatch?.[1] || undefined;
    const authorName = owner.full_name || author;
    const authorFollowers = parseCompactNumber(owner.follower_count);

    if (!id && !title) return null;

    return sanitizeRecord({
        type: 'BOARD',
        id,
        url,
        title: title || fallbackSlug,
        boardName: title || fallbackSlug,
        description: description || undefined,
        coverUrl,
        imageUrl: coverUrl,
        boardPinsCount: pinsCount,
        author,
        authorName,
        authorUrl: author ? `https://www.pinterest.com/${author}/` : undefined,
        authorFollowers,
        scrapedAt: new Date().toISOString(),
    });
}

// Parse Creator Profile Data (uses PWS initialReduxState.users / UserResource & ProfilePage JSON-LD first)
export function parseProfileData(html, url = '', pwsData = null) {
    if (!html || isPinterestBlocked(html)) return null;

    const userMatch = url.match(/pinterest\.com\/([a-zA-Z0-9_.-]+)/i);
    const usernameFromUrl = userMatch ? userMatch[1] : undefined;

    const redux = getReduxState(pwsData);
    const usersList = Object.values(redux?.users || {}).filter((u) => u && u.id && u.username);
    const userResourceVal = Object.values(redux?.resources?.UserResource || {})[0]?.data;
    const userObj = (userResourceVal && userResourceVal.username ? userResourceVal : usersList[0]) || {};

    const jsonLds = extractJsonLd(html);
    const profilePage = jsonLds.find((j) => j?.['@type'] === 'ProfilePage')?.mainEntity || {};

    const username = userObj.username || profilePage.alternateName || usernameFromUrl;
    if (!username) return null;

    const rawTitle = extractMetaContent(html, 'og:title')
        || decodeHtmlEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const name = decodeHtmlEntities(
        String(
            userObj.full_name
            || profilePage.name
            || rawTitle.split('(')[0].replace(/\s*\|\s*Pinterest.*$/i, '').trim()
            || username
        )
    ).trim();

    const bio = decodeHtmlEntities(
        String(
            userObj.about
            || profilePage.description
            || extractMetaContent(html, 'og:description')
            || extractMetaContent(html, 'description')
            || ''
        )
    ).trim();

    const avatarUrl = userObj.image_xlarge_url
        || userObj.image_medium_url
        || profilePage.image?.contentUrl
        || extractMetaContent(html, 'og:image')
        || undefined;

    const viewsMatch = html.match(/([\d.,]+[KkMmBb]?\+?)\s+monthly views/i);
    const monthlyViews = userObj.profile_reach
        ? String(userObj.profile_reach)
        : (viewsMatch ? viewsMatch[1] : undefined);

    const followersMatch = html.match(/([\d.,]+[KkMmBb]?)\s+followers/i);
    const followers = parseCompactNumber(
        userObj.follower_count
        ?? profilePage.interactionStatistic?.userInteractionCount
        ?? (followersMatch ? followersMatch[1] : undefined)
    );

    const outboundUrl = userObj.website_url
        || (Array.isArray(profilePage.sameAs) ? profilePage.sameAs[0] : profilePage.sameAs)
        || undefined;
    const domain = userObj.domain_url || safeDomain(outboundUrl);

    const emails = extractEmails(`${name} ${bio}`);
    const phones = extractPhones(`${name} ${bio}`);

    return sanitizeRecord({
        type: 'PROFILE',
        id: username,
        title: name,
        author: username,
        authorName: name,
        url: `https://www.pinterest.com/${username}/`,
        authorUrl: `https://www.pinterest.com/${username}/`,
        description: bio || undefined,
        authorAvatarUrl: avatarUrl,
        imageUrl: avatarUrl,
        authorMonthlyViews: monthlyViews,
        authorFollowers: followers,
        outboundUrl,
        domain,
        email: emails[0],
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        createdAt: userObj.created_at ? String(userObj.created_at) : undefined,
        scrapedAt: new Date().toISOString(),
    });
}
