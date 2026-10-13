/**
 * Pinterest Ultimate Scraper - Extractors & Parsers
 * High-speed parsing for Pins, Boards, Profiles, Outbound Links, and Video MP4s.
 */

// Helper to extract email addresses
export function extractEmails(text) {
    if (!text || typeof text !== 'string') return [];
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const matches = text.match(emailRegex) || [];
    const ignored = ['pinterest.com', 'pinimg.com', 'example.com'];
    const unique = [...new Set(matches.map(m => m.trim().toLowerCase()))];
    return unique.filter(e => !ignored.some(d => e.endsWith(`@${d}`)));
}

// Helper to extract phone numbers
export function extractPhones(text) {
    if (!text || typeof text !== 'string') return [];
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,5}/g;
    const matches = text.match(phoneRegex) || [];
    const valid = matches
        .map(p => p.trim())
        .filter(p => {
            const digits = p.replace(/\D/g, '');
            return digits.length >= 8 && digits.length <= 15;
        });
    return [...new Set(valid)];
}

// Helper to extract hashtags
export function extractHashtags(text) {
    if (!text || typeof text !== 'string') return [];
    const hashRegex = /#([a-zA-Z0-9_]+)/g;
    const matches = text.match(hashRegex) || [];
    return [...new Set(matches.map(h => h.replace('#', '')))];
}

// Extract Pinterest embedded PWS JSON State
export function extractPwsData(html) {
    if (!html) return null;
    try {
        const pwsMatch = html.match(/<script\s+id="__PWS_DATA__"\s+type="application\/json">([\s\S]*?)<\/script>/i)
            || html.match(/<script\s+data-test-id="relay-response"[^>]*>([\s\S]*?)<\/script>/i);
        if (pwsMatch && pwsMatch[1]) {
            return JSON.parse(pwsMatch[1]);
        }
    } catch (_) {}

    // Fallback: search for window.__INITIAL_DATA__
    try {
        const initMatch = html.match(/window\.__INITIAL_DATA__\s*=\s*({[\s\S]*?});/);
        if (initMatch && initMatch[1]) {
            return JSON.parse(initMatch[1]);
        }
    } catch (_) {}

    return null;
}

// Extract Schema.org JSON-LD blocks
export function extractJsonLd(html) {
    if (!html) return [];
    const blocks = [];
    const regex = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        try {
            const parsed = JSON.parse(match[1]);
            if (Array.isArray(parsed)) blocks.push(...parsed);
            else blocks.push(parsed);
        } catch (_) {}
    }
    return blocks;
}

// Generate best HD original image URL from any pinimg thumbnail
export function getOriginalImageUrl(url) {
    if (!url || typeof url !== 'string') return null;
    // Replace /236x/ or /474x/ or /736x/ with /originals/
    return url.replace(/\/(236x|474x|736x|564x)\//, '/originals/');
}

// Parse a single Pin Object
export function parsePinData(pinObj, rawHtml = '') {
    if (!pinObj || typeof pinObj !== 'object') return null;

    const id = pinObj.id;
    const title = pinObj.title || pinObj.grid_title || '';
    const description = pinObj.description || pinObj.rich_metadata?.description || '';
    const outboundUrl = pinObj.link || pinObj.rich_metadata?.url || null;
    const domain = pinObj.domain || (outboundUrl ? new URL(outboundUrl).hostname : null);

    // Save counts
    let saveCount = pinObj.repin_count
        || pinObj.aggregated_pin_data?.aggregated_stats?.saves
        || pinObj.save_count
        || 0;
    const commentsCount = pinObj.comment_count || 0;

    // Image URLs (HD originals)
    let imageUrl = null;
    const images = {};

    if (pinObj.images) {
        if (pinObj.images.orig?.url) images.original = pinObj.images.orig.url;
        if (pinObj.images['736x']?.url) images.high = pinObj.images['736x'].url;
        if (pinObj.images['474x']?.url) images.medium = pinObj.images['474x'].url;
        if (pinObj.images['236x']?.url) images.thumbnail = pinObj.images['236x'].url;
        imageUrl = images.original || images.high || images.medium || images.thumbnail;
    }

    if (!imageUrl && pinObj.image_large_url) {
        imageUrl = getOriginalImageUrl(pinObj.image_large_url);
        images.original = imageUrl;
    }

    // Video extraction (MP4)
    let isVideo = Boolean(pinObj.is_video || pinObj.videos);
    let videoUrl = null;

    if (pinObj.videos?.video_list) {
        const vList = pinObj.videos.video_list;
        const bestVideo = vList.V_720P || vList.V_HLSV4 || Object.values(vList)[0];
        if (bestVideo?.url) {
            videoUrl = bestVideo.url;
            isVideo = true;
        }
    }

    // Pinner / Creator
    const pinner = pinObj.pinner || pinObj.native_creator || {};
    const author = pinner.username || null;
    const authorName = pinner.full_name || pinner.first_name || author;
    const authorAvatarUrl = pinner.image_large_url || pinner.image_small_url || null;
    const authorFollowers = pinner.follower_count || null;

    // Board
    const board = pinObj.board || {};
    const boardName = board.name || null;
    const boardUrl = board.url ? `https://www.pinterest.com${board.url}` : null;

    // Product & Pricing info
    let price = pinObj.rich_metadata?.price_value || null;
    let currency = pinObj.rich_metadata?.price_currency || null;

    const emails = extractEmails(`${title} ${description}`);
    const phones = extractPhones(`${title} ${description}`);
    const hashtags = extractHashtags(description);

    return {
        type: 'PIN',
        id: String(id),
        url: `https://www.pinterest.com/pin/${id}/`,
        title,
        description,
        imageUrl,
        images,
        isVideo,
        videoUrl,
        outboundUrl,
        domain,
        saveCount,
        commentsCount,
        author,
        authorName,
        authorUrl: author ? `https://www.pinterest.com/${author}/` : null,
        authorAvatarUrl,
        authorFollowers,
        boardName,
        boardUrl,
        price,
        currency,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        email: emails[0] || null,
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        createdAt: pinObj.created_at || null,
        scrapedAt: new Date().toISOString()
    };
}

// Parse Pin from HTML Fallback / JSON-LD
export function parsePinHtmlFallback(html, url) {
    if (!html) return null;

    const idMatch = url.match(/\/pin\/(\d+)/i);
    const pinId = idMatch ? idMatch[1] : null;

    const jsonLds = extractJsonLd(html);
    const pinLd = jsonLds.find(j => j['@type'] === 'SocialMediaPosting' || j['@type'] === 'ImageObject') || {};

    let title = pinLd.headline || pinLd.name || '';
    let description = pinLd.articleBody || pinLd.description || '';
    let imageUrl = pinLd.image || null;

    // Meta tags
    if (!title) {
        title = html.match(/<meta property="og:title" content="([^"]*)"/i)?.[1] || '';
    }
    if (!description) {
        description = html.match(/<meta property="og:description" content="([^"]*)"/i)?.[1] || '';
    }
    if (!imageUrl) {
        imageUrl = html.match(/<meta property="og:image" content="([^"]*)"/i)?.[1] || null;
    }

    if (imageUrl) {
        imageUrl = getOriginalImageUrl(imageUrl);
    }

    // Video check
    const isVideo = html.includes('"video_list"') || html.includes('<video');
    const videoMatch = html.match(/"url":"(https:\/\/[^"]+\.mp4[^"]*)"/);
    const videoUrl = videoMatch ? videoMatch[1].replace(/\\u0026/g, '&') : null;

    // Outbound link
    let outboundUrl = null;
    const linkMatch = html.match(/"link":"(https?:\/\/[^"]+)"/);
    if (linkMatch) {
        outboundUrl = linkMatch[1].replace(/\\u0026/g, '&');
    }

    const emails = extractEmails(`${title} ${description}`);
    const phones = extractPhones(`${title} ${description}`);
    const hashtags = extractHashtags(description);

    return {
        type: 'PIN',
        id: pinId,
        url: `https://www.pinterest.com/pin/${pinId}/`,
        title: title.replace(/\| Pinterest/gi, '').trim(),
        description,
        imageUrl,
        isVideo,
        videoUrl,
        outboundUrl,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        email: emails[0] || null,
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        scrapedAt: new Date().toISOString()
    };
}

// Parse Board Data
export function parseBoardData(html, url) {
    if (!html) return null;

    const titleMatch = html.match(/<meta property="og:title" content="([^"]*)"/i);
    const descMatch = html.match(/<meta property="og:description" content="([^"]*)"/i);
    const imgMatch = html.match(/<meta property="og:image" content="([^"]*)"/i);

    const title = titleMatch ? titleMatch[1].replace(/\| Pinterest/gi, '').trim() : '';
    const description = descMatch ? descMatch[1] : '';
    const coverUrl = imgMatch ? getOriginalImageUrl(imgMatch[1]) : null;

    // Extract pins count if in HTML
    const countMatch = html.match(/(\d[\d,\s]*)\s+Pins?/i);
    const pinsCount = countMatch ? parseInt(countMatch[1].replace(/\D/g, ''), 10) : 0;

    return {
        type: 'BOARD',
        url,
        title,
        description,
        coverUrl,
        boardPinsCount: pinsCount,
        scrapedAt: new Date().toISOString()
    };
}

// Parse Creator Profile Data
export function parseProfileData(html, url) {
    if (!html) return null;

    const userMatch = url.match(/pinterest\.com\/([a-zA-Z0-9_-]+)/i);
    const username = userMatch ? userMatch[1] : null;

    const titleMatch = html.match(/<meta property="og:title" content="([^"]*)"/i);
    const descMatch = html.match(/<meta property="og:description" content="([^"]*)"/i);
    const imgMatch = html.match(/<meta property="og:image" content="([^"]*)"/i);

    const name = titleMatch ? titleMatch[1].split('(')[0].replace(/\| Pinterest/gi, '').trim() : username;
    const bio = descMatch ? descMatch[1] : '';
    const avatarUrl = imgMatch ? imgMatch[1] : null;

    // Monthly views (e.g., "10M+ monthly views")
    const viewsMatch = html.match(/([\d.,]+[KkMmBb]?\+?)\s+monthly views/i);
    const monthlyViews = viewsMatch ? viewsMatch[1] : null;

    // Followers count
    const followersMatch = html.match(/([\d.,]+[KkMmBb]?)\s+followers/i);
    const followers = followersMatch ? followersMatch[1] : null;

    const emails = extractEmails(`${name} ${bio}`);
    const phones = extractPhones(`${name} ${bio}`);

    return {
        type: 'PROFILE',
        id: username,
        author: username,
        authorName: name,
        url: `https://www.pinterest.com/${username}/`,
        description: bio,
        authorAvatarUrl: avatarUrl,
        authorMonthlyViews: monthlyViews,
        authorFollowers: followers,
        email: emails[0] || null,
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        scrapedAt: new Date().toISOString()
    };
}
